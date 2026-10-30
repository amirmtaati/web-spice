/**
 * EngineSession (E4, SPEC §4.3/§4.4): the stateful engine side of the
 * protocol, driven over a scripted message/reply channel. Live runs use an
 * injected manual clock — ticks advance deterministically, no real timers.
 */
import { describe, expect, test } from "bun:test";

import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";

import { EngineSession, hostClock } from "../src/session.ts";

/** Collect replies from a session; ids map replies to requests. */
class Script {
  readonly replies: EngineToClient[] = [];
  send(session: EngineSession, message: ClientToEngine): void {
    session.handle(message, (m) => this.replies.push(m));
  }
  for(id: string): EngineToClient[] {
    return this.replies.filter((m) => m.id === id);
  }
  clear(): void {
    this.replies.length = 0;
  }
}

/** Deterministic manual clock: tests move time and run due callbacks. */
class ManualClock {
  private nowMs = 1_000_000;
  private jobs: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  schedule(fn: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.jobs.push({ at: this.nowMs + delayMs, fn, id });
    return id;
  }

  cancel(handle: unknown): void {
    this.jobs = this.jobs.filter((j) => j.id !== handle);
  }

  /** Advance wall time; run every due callback in order. */
  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      const due = this.jobs.filter((j) => j.at <= target).sort((a, b) => a.at - b.at);
      if (due.length === 0) {
        break;
      }
      const job = due[0] as { at: number; fn: () => void; id: number };
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
      this.nowMs = job.at;
      job.fn();
    }
    this.nowMs = target;
  }

  get pending(): number {
    return this.jobs.length;
  }
}

const RC_NETLIST = `session fixture
V1 in 0 DC 5
R1 in out 1k
C1 out 0 1u
.tran 100u 5m
.end
`;

function session(): { s: EngineSession; clock: ManualClock; script: Script } {
  const clock = new ManualClock();
  const s = new EngineSession({ clock, chunkMs: 16, maxSamplesPerTick: 512 });
  return { s, clock, script: new Script() };
}

describe("EngineSession — handshake and loading", () => {
  test("hello → ready with real capabilities", () => {
    const { s, script } = session();
    script.send(s, { id: "h1", type: "hello", payload: { protocol: "0.2.0" } });
    const ready = script.for("h1")[0];
    expect(ready?.type).toBe("ready");
    if (ready?.type === "ready") {
      expect(ready.payload.engineVersion).toContain("core");
      expect(ready.payload.capabilities.analyses).toContain("ac");
      expect(ready.payload.capabilities.liveParamMode).toBe(true);
      expect(ready.payload.capabilities.streaming).toContain("live");
    }
  });

  test("loadSpice compiles and returns node/branch tables", () => {
    const { s, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    const load = script.for("l1")[0];
    expect(load?.type).toBe("loadResult");
    if (load?.type === "loadResult") {
      const names = load.payload.nodeTable.map((n) => n.name);
      expect(names).toContain("in");
      expect(names).toContain("out");
      expect(load.payload.branchTable.some((b) => b.name === "V1")).toBe(true);
      expect(load.payload.warnings.length).toBe(0);
    }
  });

  test("bad netlist → typed error, circuit not replaced", () => {
    const { s, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    script.clear();
    script.send(s, { id: "l2", type: "loadSpice", payload: { text: "R1 a\n" } });
    const err = script.for("l2")[0];
    expect(err?.type).toBe("error");
    if (err?.type === "error") {
      expect(err.payload.code).toBe("E_FLOATING_NODE");
    }
    // The previously loaded circuit still runs.
    script.send(s, { id: "r1", type: "run", payload: { analysis: { kind: "op" } } });
    expect(script.for("r1").some((m) => m.type === "done")).toBe(true);
  });

  test("run without load → typed error", () => {
    const { s, script } = session();
    script.send(s, { id: "r0", type: "run", payload: { analysis: { kind: "op" } } });
    const err = script.for("r0")[0];
    expect(err?.type).toBe("error");
  });
});

describe("EngineSession — buffered runs", () => {
  test("run emits runAccepted → data → done with the engine-run id", () => {
    const { s, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    script.clear();
    script.send(s, {
      id: "r1",
      type: "run",
      payload: {
        analysis: { kind: "tran", tstep: 100e-6, tstop: 5e-3, uic: true },
      },
    });
    const replies = script.for("r1");
    expect(replies[0]?.type).toBe("runAccepted");
    const data = replies.find((m) => m.type === "data");
    const done = replies.find((m) => m.type === "done");
    expect(data).toBeDefined();
    expect(done).toBeDefined();
    if (data?.type === "data" && done?.type === "done") {
      expect(data.payload.runId).toBe("run-1");
      expect(done.payload.runId).toBe("run-1");
      const vout = data.payload.chunk.find((c) => c.name === "v(out)");
      expect(vout).toBeDefined();
      // RC charges toward 5 V: last sample close to (1 − e^{−5})·5 ≈ 4.966.
      const samples = vout?.samples ?? [];
      expect(samples.length).toBe(51);
      expect(samples[samples.length - 1]).toBeCloseTo(5 * (1 - Math.exp(-5)), 2);
      expect(done.payload.stats.timesteps).toBeGreaterThan(0);
    }
  });

  test("evaluate and exportSpice round trip", () => {
    const { s, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    script.send(s, {
      id: "e1",
      type: "evaluate",
      payload: { expr: "2 * v(out) + gain", context: { "v(out)": 1.5, gain: 1 } },
    });
    const ev = script.for("e1")[0];
    expect(ev?.type).toBe("evaluateResult");
    if (ev?.type === "evaluateResult") {
      expect(ev.payload.value).toBe(4);
    }
    script.send(s, { id: "x1", type: "exportSpice" });
    const sp = script.for("x1")[0];
    expect(sp?.type).toBe("spice");
    if (sp?.type === "spice") {
      expect(sp.payload.text.toLowerCase()).toContain("r1");
    }
  });
});

describe("EngineSession — live runs (manual clock)", () => {
  test("ticks stream chunks in wall time; stop finishes with stats", () => {
    const { s, clock, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    script.clear();
    script.send(s, {
      id: "r1",
      type: "run",
      payload: {
        analysis: { kind: "tran", tstep: 100e-6, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1 },
      },
    });
    const accepted = script.for("r1")[0];
    expect(accepted?.type).toBe("runAccepted");
    const runId = accepted?.type === "runAccepted" ? accepted.payload.runId : "";

    // One tick = 16 ms wall at ×1 realtime → 16 ms of sim time → 160 samples
    // capped at 512, but the chunk cadence emits every accepted grid point.
    script.clear();
    clock.advance(16);
    const data = script.replies.filter((m) => m.type === "data");
    expect(data.length).toBe(1);
    const first = data[0];
    if (first?.type === "data") {
      // 16 ms / 0.1 ms = 160 grid samples + the initial t=0 already sent.
      expect(first.payload.chunk[0]?.samples.length).toBe(160);
    }
    // Progress events accompany every chunk.
    expect(script.replies.some((m) => m.type === "progress")).toBe(true);

    // Pause freezes the simulation but keeps the session alive.
    script.clear();
    script.send(s, { id: "c1", type: "control", payload: { runId, op: "pause" } });
    expect(script.for("c1").some((m) => m.type === "ack")).toBe(true);
    clock.advance(100);
    expect(script.replies.filter((m) => m.type === "data").length).toBe(0);

    // Resume → data flows again.
    script.send(s, { id: "c2", type: "control", payload: { runId, op: "resume" } });
    clock.advance(16);
    expect(script.replies.filter((m) => m.type === "data").length).toBe(1);

    // Step while paused: exactly one output-grid step.
    script.send(s, { id: "c3", type: "control", payload: { runId, op: "pause" } });
    script.clear();
    script.send(s, { id: "c4", type: "control", payload: { runId, op: "step" } });
    const stepData = script.replies.filter((m) => m.type === "data");
    expect(stepData.length).toBe(1);
    if (stepData[0]?.type === "data") {
      expect(stepData[0].payload.chunk[0]?.samples.length).toBe(1);
    }

    // Stop → done with stats; further control reports an error.
    script.clear();
    script.send(s, { id: "c5", type: "control", payload: { runId, op: "stop" } });
    expect(script.replies.some((m) => m.type === "done")).toBe(true);
    script.send(s, { id: "c6", type: "control", payload: { runId, op: "resume" } });
    expect(script.for("c6")[0]?.type).toBe("error");
    expect(clock.pending).toBe(0);
  });

  test("setParam mid-run applies without a phase glitch", () => {
    const net = `live phase
V1 in 0 SIN(0 1 1k)
R1 in out 10k
C1 out 0 1u
.tran 50u 1
.end
`;
    const { s, clock, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: net } });
    script.clear();
    script.send(s, {
      id: "r1",
      type: "run",
      payload: {
        analysis: { kind: "tran", tstep: 50e-6, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1 },
      },
    });
    const runId =
      script.for("r1")[0]?.type === "runAccepted"
        ? (script.for("r1")[0] as { payload: { runId: string } }).payload.runId
        : "";

    // Run 100 ms of sim time, then retune the source 1 kHz → 500 Hz.
    clock.advance(100);
    script.clear();
    script.send(s, {
      id: "p1",
      type: "setParam",
      payload: { runId, target: { elementName: "V1", property: "frequency" }, value: 500 },
    });
    const ack = script.for("p1")[0];
    expect(ack?.type).toBe("ack");

    // Collect v(in) across the change and check continuity at the boundary:
    // the largest adjacent-sample jump stays at the smooth-slew bound.
    script.clear();
    clock.advance(20);
    const vin: { t: number; v: number }[] = [];
    for (const m of script.replies) {
      if (m.type !== "data") {
        continue;
      }
      const idx = m.payload.signals.findIndex((si) => si.name === "v(in)");
      const samples = m.payload.chunk[idx]?.samples ?? [];
      const n = samples.length;
      const t0 = m.payload.tStart;
      const step = 50e-6;
      for (let k = 0; k < n; k++) {
        vin.push({ t: t0 + k * step, v: samples[k] ?? 0 });
      }
    }
    let maxJump = 0;
    for (let k = 1; k < vin.length; k++) {
      maxJump = Math.max(maxJump, Math.abs((vin[k]?.v ?? 0) - (vin[k - 1]?.v ?? 0)));
    }
    // Slew bound for 1 kHz, 50 µs samples: 2π·1000·50e-6 ≈ 0.314 V.
    expect(maxJump).toBeLessThan(0.33);
    // Stop the run and drain timers.
    script.send(s, { id: "c1", type: "control", payload: { runId, op: "stop" } });
    expect(clock.pending).toBe(0);
  });

  test("setExternal drives an EXTERNAL source channel", () => {
    const net = `external channel
V1 in 0 EXTERNAL(gen)
R1 in out 1k
Rl out 0 1k
.tran 100u 1
.end
`;
    const { s, clock, script } = session();
    script.send(s, { id: "l1", type: "loadSpice", payload: { text: net } });
    script.clear();
    script.send(s, {
      id: "r1",
      type: "run",
      payload: {
        analysis: { kind: "tran", tstep: 100e-6, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1000 },
      },
    });
    const runId =
      script.for("r1")[0]?.type === "runAccepted"
        ? (script.for("r1")[0] as { payload: { runId: string } }).payload.runId
        : "";
    script.clear();
    // Drive the channel to 2.5 V; at ×1000 realtime one 16 ms tick ≈ 16 ms sim.
    script.send(s, {
      id: "se1",
      type: "setExternal",
      payload: { runId, channel: "gen", value: 2.5 },
    });
    clock.advance(16);
    const data = [...script.replies].reverse().find((m) => m.type === "data");
    if (data?.type === "data") {
      const vout = data.payload.chunk.find((c) => c.name === "v(out)");
      const samples = vout?.samples ?? [];
      expect(samples.length).toBeGreaterThan(0);
      // ZOH: v(out) tracks the driven value through the divider (1k/1k → /2).
      expect(samples[samples.length - 1]).toBeCloseTo(1.25, 3);
    } else {
      throw new Error("no data chunk after setExternal");
    }
    script.send(s, { id: "c1", type: "control", payload: { runId, op: "stop" } });
  });

  test("live run requires a scheduler and .tran", () => {
    const noClock = new EngineSession(); // no clock injected
    const script = new Script();
    script.send(noClock, { id: "l1", type: "loadSpice", payload: { text: RC_NETLIST } });
    script.send(noClock, {
      id: "r1",
      type: "run",
      payload: {
        analysis: { kind: "tran", tstep: 1e-6, tstop: 1e9 },
        stream: { mode: "live" },
      },
    });
    expect(script.for("r1")[0]?.type).toBe("error");
  });
});

describe("EngineSession — hostClock", () => {
  test("schedules with environment timers", async () => {
    const clock = hostClock();
    expect(clock.now()).toBeGreaterThan(0);
    const done = new Promise<void>((resolve) => {
      clock.schedule(resolve, 1);
    });
    await done;
  });
});
