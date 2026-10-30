/**
 * E4 live-engine primitives (SPEC §4.4): phase-continuous SIN retuning,
 * EXTERNAL channels, device live parameters, and TranStepper resume
 * equivalence (chunked advance == single batch run).
 */
import { describe, expect, test } from "bun:test";

import { runAnalysis, TranStepper } from "../src/analyses/index.ts";
import { runOp } from "../src/analyses/op.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { Workspace } from "../src/analyses/workspace.ts";
import { type CompiledCircuit, compile } from "../src/compiler/index.ts";
import type { ExternalChannels } from "../src/devices/index.ts";
import { createWaveEval, resolveWave } from "../src/devices/waveform.ts";
import { ParamScope } from "../src/eval/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

const SCOPE = new ParamScope({}, 27, 0);

describe("SIN live retune — phase continuity (SPEC §4.4)", () => {
  const wave = resolveWave({ kind: "SIN", offset: 0, amp: 1, freq: 1e6 }, SCOPE);

  test("valueAt matches the classic form with no retune", () => {
    const w = createWaveEval(wave);
    for (const t of [0, 1e-7, 2.5e-7, 1e-6, 1.7e-6]) {
      expect(w.valueAt(t)).toBeCloseTo(Math.sin(2 * Math.PI * 1e6 * t), 12);
    }
  });

  test("frequency retune at t keeps the value continuous", () => {
    const w = createWaveEval(wave);
    const tChange = 3.7e-7;
    const before = w.valueAt(tChange);
    w.retune?.("frequency", 2e6, tChange);
    // Continuous by construction at the change point.
    expect(Math.abs(w.valueAt(tChange) - before)).toBeLessThan(1e-12);
    // The new 2 MHz wave: a quarter-period after the change the phase is
    // refPhase + π/2 → cos(refPhase); a half-period later it inverts.
    expect(w.valueAt(tChange + 1.25e-7)).toBeCloseTo(Math.cos(2 * Math.PI * 1e6 * tChange), 6);
    expect(Math.abs(w.valueAt(tChange + 2.5e-7) + before)).toBeLessThan(1e-6);
    // Continuity holds across a second retune as well.
    const t2 = 9.1e-7;
    const v2 = w.valueAt(t2);
    w.retune?.("frequency", 5e5, t2);
    expect(Math.abs(w.valueAt(t2) - v2)).toBeLessThan(1e-12);
  });

  test("amplitude and offset retune apply immediately", () => {
    const w = createWaveEval(wave);
    w.retune?.("amplitude", 2, 0);
    w.retune?.("offset", 0.5, 0);
    expect(w.valueAt(0.25e-6)).toBeCloseTo(0.5 + 2 * Math.sin(2 * Math.PI * 1e6 * 0.25e-6), 12);
  });

  test("unknown property and non-positive frequency throw", () => {
    const w = createWaveEval(wave);
    expect(() => w.retune?.("dutyCycle", 0.5, 0)).toThrow();
    expect(() => w.retune?.("frequency", -1, 0)).toThrow();
  });
});

describe("EXTERNAL channels (SPEC §4.4 setExternal)", () => {
  test("zero-order hold from the registry", () => {
    let v = 0;
    const registry: ExternalChannels = {
      value: () => v,
      setSeries: () => {},
    };
    const w = createWaveEval({ kind: "EXTERNAL", channel: "gen" }, registry);
    expect(w.valueAt(0)).toBe(0);
    v = 2.5;
    expect(w.valueAt(1e-6)).toBe(2.5);
    // Case-insensitive channel keys.
    const w2 = createWaveEval({ kind: "EXTERNAL", channel: "GEN" }, registry);
    expect(w2.valueAt(0)).toBe(2.5);
  });

  test("no registry entry reads 0 (default externals)", () => {
    const w = createWaveEval({ kind: "EXTERNAL", channel: "x" });
    expect(w.valueAt(5)).toBe(0);
    expect(w.nextBreakpoint(0)).toBeUndefined();
  });
});

describe("device setLiveParam (SPEC §4.4)", () => {
  test("resistor value change alters the operating point", () => {
    const net = `live r
V1 a 0 1
R1 a 0 1k
.end
`;
    const compiled = compile(parseNetlist(net));
    const ws1 = new Workspace(compiled);
    runOp(ws1, DEFAULT_OPTIONS, 0);
    const i1 = ws1.x[absBranch(compiled, "v1")] as number;

    const ws2 = new Workspace(compiled);
    const r = ws2.devices.find((d) => d.name === "R1");
    expect(r?.setLiveParam).toBeDefined();
    r?.setLiveParam?.("value", 2e3, 0);
    runOp(ws2, DEFAULT_OPTIONS, 0);
    const i2 = ws2.x[absBranch(compiled, "v1")] as number;
    expect(Math.abs(i1)).toBeCloseTo(1e-3, 15);
    expect(Math.abs(i2)).toBeCloseTo(5e-4, 15);
    expect(() => r?.setLiveParam?.("frequency", 1, 0)).toThrow();
  });

  test("RC circuit with a live capacitor change matches the new τ", () => {
    // Discharge setup: cap precharged to 1 V (uic), source 0 V →
    // v(out) = e^{−t/RC}. Live-retuning C to 2 µF doubles τ.
    const net = `live c
V1 in 0 0
R1 in out 1k
C1 out 0 1u ic=1
.tran 1u 10m uic
.end
`;
    const compiled = compile(parseNetlist(net));
    const outIdx = nodeIndex(compiled, "out");

    // Reference: C = 1 µF (as compiled) → v(1 ms) = e^{−1}.
    const batch1 = runAnalysis(compiled, {
      kind: "tran",
      tstep: 1e-6,
      tstop: 10e-3,
      uic: true,
    });
    const v1 = signalAt(batch1, "v(out)", 1e-3, 1e-6);
    expect(v1).toBeCloseTo(Math.exp(-1), 3);

    // Live: C retuned to 2 µF before stepping → v(1 ms) = e^{−1/2}.
    const ws2 = new Workspace(compiled);
    const c = ws2.devices.find((d) => d.name === "C1");
    c?.setLiveParam?.("value", 2e-6, 0);
    const stepper = new TranStepper(ws2, compiled.options, {
      tstep: 1e-6,
      tstop: 10e-3,
      uic: true,
    });
    const samples = new Map<number, number>();
    stepper.advance(10e-3, (t, x) => {
      samples.set(t, x[outIdx] as number);
    });
    const v2 = nearestSample(samples, 1e-3);
    expect(v2).toBeCloseTo(Math.exp(-0.5), 3);
    expect(Math.abs(v2 - v1)).toBeGreaterThan(0.05);
  });

  test("switch state override forces ON despite a below-threshold control", () => {
    const net = `live switch
V1 a 0 5
S1 a out nc 0 SW1
Rl out 0 1k
Vc nc 0 0
.model SW1 SW(VT=1 VH=0.2 RON=1 ROFF=1e12)
.end
`;
    const compiled = compile(parseNetlist(net));
    const ws = new Workspace(compiled);
    const sw = ws.devices.find((d) => d.name === "S1");
    expect(sw?.setLiveParam).toBeDefined();
    sw?.setLiveParam?.("switchState", 1, 0);
    runOp(ws, DEFAULT_OPTIONS, 0);
    // Forced ON (1 Ω) + 1 kΩ load → divider ≈ 5·1000/1001.
    const vout = ws.x[nodeIndex(compiled, "out")] as number;
    expect(vout).toBeGreaterThan(4.99);
  });
});

describe("TranStepper resume equivalence (E4)", () => {
  const net = `resume equivalence
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 100n
.tran 10u 5m
.end
`;

  test("chunked advance produces the same samples as one batch run", () => {
    const compiled = compile(parseNetlist(net));
    const outIdx = nodeIndex(compiled, "out");

    // Batch reference (one advance over the whole horizon).
    const ws1 = new Workspace(compiled);
    const batch = collect(
      new TranStepper(ws1, compiled.options, { tstep: 1e-5, tstop: 5e-3 }),
      5e-3,
      outIdx,
    );

    // Chunked: 0.5 ms slices on a fresh workspace.
    const ws2 = new Workspace(compiled);
    const stepper = new TranStepper(ws2, compiled.options, { tstep: 1e-5, tstop: 5e-3 });
    const times: number[] = [];
    const values: number[] = [];
    for (let end = 5e-4; end <= 5e-3 + 1e-12; end += 5e-4) {
      stepper.advance(end, (t, x) => {
        times.push(t);
        values.push(x[outIdx] as number);
      });
    }
    expect(times.length).toBe(batch.times.length);
    expect(values.length).toBe(batch.values.length);
    for (let k = 0; k < times.length; k++) {
      expect(times[k]).toBeCloseTo(batch.times[k] as number, 12);
      expect(values[k]).toBeCloseTo(batch.values[k] as number, 12);
    }
  });

  test("insertBreakpoint + resetOrder restart the integrator safely", () => {
    const compiled = compile(parseNetlist(net));
    const ws = new Workspace(compiled);
    const stepper = new TranStepper(ws, compiled.options, { tstep: 1e-5, tstop: 2e-3 });
    stepper.start();
    stepper.advance(1e-3);
    expect(stepper.time).toBeCloseTo(1e-3, 9);
    stepper.insertBreakpoint(stepper.time);
    stepper.resetOrder();
    stepper.advance(2e-3);
    expect(stepper.time).toBeCloseTo(2e-3, 9);
    expect(stepper.acceptedSteps).toBeGreaterThan(0);
  });

  test("live frequency change shows no phase glitch (acceptance)", () => {
    // RC low-pass driven by a 1 kHz SIN; the source frequency is retuned
    // to 500 Hz mid-run. The driven waveform must stay continuous across
    // the change: the largest sample-to-sample jump remains the smooth
    // slew bound (2π·f·tstep·A), never a discontinuity of order A.
    const net = `live retune
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 1u
.tran 10u 4m
.end
`;
    const compiled = compile(parseNetlist(net));
    const inIdx = nodeIndex(compiled, "in");
    const ws = new Workspace(compiled);
    const stepper = new TranStepper(ws, compiled.options, { tstep: 1e-5, tstop: 4e-3 });
    const vin: { t: number; v: number }[] = [];
    stepper.advance(2e-3, (t, x) => {
      vin.push({ t, v: x[inIdx] as number });
    });
    // Retune at t = 2 ms (what the session does on setParam frequency).
    const src = ws.devices.find((d) => d.name === "V1");
    src?.setLiveParam?.("frequency", 500, stepper.time);
    stepper.resetOrder();
    stepper.insertBreakpoint(stepper.time);
    stepper.advance(4e-3, (t, x) => {
      vin.push({ t, v: x[inIdx] as number });
    });
    vin.sort((a, b) => a.t - b.t);
    let maxJump = 0;
    for (let k = 1; k < vin.length; k++) {
      maxJump = Math.max(maxJump, Math.abs(vin[k]?.v - vin[k - 1]?.v));
    }
    // Smooth slew for the 1 kHz segment: 2π·1000·1e-5 ≈ 0.063 V/sample.
    expect(maxJump).toBeLessThan(0.07);
    // And the signal really is oscillating at 500 Hz after the change:
    // successive same-direction peaks are 2 ms apart — checked via the
    // zero crossings of the retuned segment.
    const after = vin.filter((p) => p.t >= 2e-3);
    const crossings = after.filter(
      (p, i) => i > 0 && (after[i - 1] as { v: number }).v < 0 && p.v >= 0,
    );
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    if (crossings.length >= 2) {
      const period = (crossings[1] as { t: number }).t - (crossings[0] as { t: number }).t;
      expect(period).toBeCloseTo(2e-3, 3); // 500 Hz → 2 ms
    }
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

import { DEFAULT_SIM_OPTIONS as DEFAULT_OPTIONS } from "@spicekit/protocol";

function nodeIndex(compiled: CompiledCircuit, name: string): number {
  const idx = compiled.nodeNames.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  if (idx < 0) {
    throw new Error(`node ${name} not found`);
  }
  return idx;
}

function branchOf(compiled: CompiledCircuit, name: string): number {
  const br = compiled.branchByName.get(name.toLowerCase()) ?? -1;
  if (br < 0) {
    throw new Error(`branch ${name} not found`);
  }
  return br;
}

/** Absolute MNA offset of a branch unknown (branchByName is node-relative). */
function absBranch(compiled: CompiledCircuit, name: string): number {
  return compiled.nodeCount + branchOf(compiled, name);
}

function collect(
  stepper: TranStepper,
  until: number,
  outIdx: number,
): { times: number[]; values: number[] } {
  const times: number[] = [];
  const values: number[] = [];
  stepper.advance(until, (t, x) => {
    times.push(t);
    values.push(x[outIdx] as number);
  });
  return { times, values };
}

/** Interpolated signal value at time `at` from a batch RunResult. */
function signalAt(r: RunResult, name: string, at: number, tstep: number): number {
  const s = r.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(`signal ${name} not found`);
  }
  const k = Math.round(at / tstep);
  return s.values[k] as number;
}

function nearestSample(samples: Map<number, number>, at: number): number {
  let best = Number.NaN;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [t, v] of samples) {
    const d = Math.abs(t - at);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  if (bestDist > 1e-9) {
    throw new Error(`no sample near t=${at}`);
  }
  return best;
}
