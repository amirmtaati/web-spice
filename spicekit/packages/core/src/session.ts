/**
 * Engine session (E4, SPEC §4.3/§4.4): the stateful engine side of the
 * message protocol. One session per connection (in-process transport,
 * worker, or server WebSocket). Runtime-agnostic — scheduling is injected
 * (default: the environment's `setTimeout`), so the same session runs under
 * Bun, Node, and browsers.
 *
 *  - `loadCircuit`/`loadSpice` compile once; subsequent runs reuse the
 *    compiled circuit.
 *  - Buffered runs execute synchronously and emit runAccepted → data →
 *    done. Every reply carries the originating request id so the client's
 *    correlation works for all transports.
 *  - Live transient runs (`stream.mode = "live"`) advance in wall-clock
 *    chunks (~16 ms), emitting data chunks and progress; circuit state
 *    persists between chunks. `setParam` applies at the next accepted
 *    timestep with an order reset + breakpoint (SPEC §4.4); `setExternal`
 *    feeds EXTERNAL channels; `control` pauses/resumes/steps/stops.
 *
 * Reply contract: the `reply` callback of `handle()` (and of the run request
 * that started a live run) must stay valid for the run's lifetime — all
 * three transports close over a stable send function, so async tick events
 * flow through it after handle() returns.
 */
import {
  type AnalysisRequest,
  type Circuit,
  type ClientToEngine,
  DEFAULT_ENGINE_LIMITS,
  type EngineCapabilities,
  EngineError,
  type EngineErrorPayload,
  type EngineLimits,
  type EngineToClient,
  PROTOCOL_VERSION,
  type RunStats,
} from "@spicekit/protocol";

import { runAnalysis } from "./analyses/index.ts";
import { probeWanted, signalIndex, signalNamesFor } from "./analyses/signals.ts";
import { TranStepper } from "./analyses/tran.ts";
import { Workspace } from "./analyses/workspace.ts";
import { type CompiledCircuit, compile } from "./compiler/index.ts";
import type { ExternalChannels } from "./devices/waveform.ts";
import { evaluateExpression } from "./evaluate.ts";
import { parseNetlist, serializeNetlist } from "./parser/index.ts";

export type EngineReply = (message: EngineToClient) => void;

/**
 * Injectable timing seam. Core stays timer-free (runtime-agnostic): hosts
 * provide the clock — the client transports and the server pass the
 * environment's timers; tests inject a deterministic manual clock.
 */
export interface SessionClock {
  now(): number;
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

/** Default clock for hosts with standard timer globals (Bun/Node/browser). */
export function hostClock(): SessionClock {
  const g = globalThis as unknown as {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  return {
    now: () => Date.now(),
    schedule: (fn, delayMs) => g.setTimeout(fn, delayMs),
    cancel: (handle) => g.clearTimeout(handle),
  };
}

export interface SessionOptions {
  clock?: SessionClock;
  /** Live chunk cadence in wall ms (default 16 — SPEC §4.4 "≈16–33 ms"). */
  chunkMs?: number;
  /** Cap on output samples per live tick (backpressure guard). */
  maxSamplesPerTick?: number;
  limits?: EngineLimits;
}

const CORE_CAPABILITIES: EngineCapabilities = {
  analyses: ["op", "dc", "ac", "tran", "noise", "tf"],
  devices: ["R", "C", "L", "K", "V", "I", "E", "F", "G", "H", "B", "D", "Q", "M", "J", "S", "W"],
  waveforms: ["SIN", "PULSE", "PWL", "EXTERNAL"],
  liveParamMode: true,
  streaming: ["buffered", "live"],
};

/**
 * EXTERNAL channel registry for one run (SPEC §4.4). Scalars are a plain
 * zero-order hold; series play sample k from tStart + k·tStep and hold the
 * last value. `value(channel, t)` is pure — safe under step retries.
 */
class ExternalRegistry implements ExternalChannels {
  private readonly values = new Map<string, number>();
  private readonly series = new Map<
    string,
    { samples: number[] | Float64Array; tStart: number; tStep: number }
  >();

  value(channel: string, t = 0): number {
    const key = channel.toLowerCase();
    const s = this.series.get(key);
    if (s !== undefined) {
      const idx = Math.min(s.samples.length - 1, Math.max(0, Math.floor((t - s.tStart) / s.tStep)));
      return s.samples[idx] ?? 0;
    }
    return this.values.get(key) ?? 0;
  }

  setScalar(channel: string, v: number): void {
    this.series.delete(channel.toLowerCase());
    this.values.set(channel.toLowerCase(), v);
  }

  setSeries(
    channel: string,
    samples: number[] | Float64Array,
    tStart: number,
    tStep: number,
  ): void {
    if (!(tStep > 0) || samples.length === 0) {
      throw new EngineError({
        code: "E_PARSE",
        message: `setExternal: series for "${channel}" needs tStep > 0 and at least one sample`,
      });
    }
    this.values.delete(channel.toLowerCase());
    this.series.set(channel.toLowerCase(), { samples, tStart, tStep });
  }
}

interface LiveRun {
  /** Stable reply sink captured from the `run` request (see module header). */
  reply: EngineReply;
  /** The scheduler that drives this run's ticks (from SessionOptions). */
  clock: SessionClock;
  runId: string;
  ws: Workspace;
  stepper: TranStepper;
  externals: ExternalRegistry;
  /** Output sample interval (the request's tstep). */
  tstep: number;
  realtimeFactor: number;
  paused: boolean;
  stopped: boolean;
  timer: unknown;
  lastWall: number;
  signalNames: string[];
  chunkMs: number;
  maxSamplesPerTick: number;
  finished: boolean;
}

export class EngineSession {
  readonly engineVersion = `${PROTOCOL_VERSION}+core`;
  readonly limits: EngineLimits;
  /** null = no scheduler injected; live runs then report E_PARSE. */
  private readonly clock: SessionClock | null;
  private readonly chunkMs: number;
  private readonly maxSamplesPerTick: number;
  private loaded: { circuit: Circuit; compiled: CompiledCircuit } | null = null;
  private readonly runs = new Map<string, LiveRun>();
  private runCounter = 0;
  private disposed = false;

  constructor(options: SessionOptions = {}) {
    this.clock = options.clock ?? null;
    this.chunkMs = options.chunkMs ?? 16;
    this.maxSamplesPerTick = options.maxSamplesPerTick ?? 4096;
    this.limits = options.limits ?? DEFAULT_ENGINE_LIMITS;
  }

  /** Stop all runs and release timers. The session is unusable afterwards. */
  dispose(): void {
    this.disposed = true;
    for (const run of this.runs.values()) {
      this.stopTimer(run);
      run.stopped = true;
    }
    this.runs.clear();
  }

  handle(message: ClientToEngine, reply: EngineReply): void {
    if (this.disposed) {
      reply({
        id: message.id,
        type: "error",
        payload: toErrorPayload(
          new EngineError({ code: "E_PROTOCOL_VERSION", message: "Session disposed" }),
        ),
      });
      return;
    }
    try {
      switch (message.type) {
        case "hello":
          reply({
            id: message.id,
            type: "ready",
            payload: {
              engineVersion: this.engineVersion,
              capabilities: CORE_CAPABILITIES,
              limits: this.limits,
            },
          });
          return;
        case "loadCircuit":
          this.load(message.id, message.payload.circuit, reply);
          return;
        case "loadSpice":
          this.loadSpice(message.id, message.payload.text, reply);
          return;
        case "run":
          this.run(message.id, message.payload, reply);
          return;
        case "control":
          this.control(message.id, message.payload.runId, message.payload.op, reply);
          return;
        case "setParam":
          this.setParam(message.id, message.payload, reply);
          return;
        case "setExternal":
          this.setExternal(message.id, message.payload, reply);
          return;
        case "evaluate":
          this.evaluate(message.id, message.payload.expr, message.payload.context, reply);
          return;
        case "exportSpice":
          this.exportSpice(message.id, reply);
          return;
      }
    } catch (error) {
      reply({ id: message.id, type: "error", payload: toErrorPayload(error) });
    }
  }

  // ─── loading / simple messages ────────────────────────────────────────────

  private load(id: string, circuit: Circuit, reply: EngineReply): void {
    const compiled = compile(circuit);
    this.loaded = { circuit, compiled };
    reply({ id, type: "loadResult", payload: loadPayload(compiled) });
  }

  private loadSpice(id: string, text: string, reply: EngineReply): void {
    if (text.length > this.limits.maxNetlistBytes) {
      throw new EngineError({
        code: "E_LIMIT_EXCEEDED",
        message: `Netlist exceeds maxNetlistBytes (${this.limits.maxNetlistBytes})`,
      });
    }
    const circuit = parseNetlist(text);
    const compiled = compile(circuit);
    this.loaded = { circuit, compiled };
    reply({ id, type: "loadResult", payload: loadPayload(compiled) });
  }

  private exportSpice(id: string, reply: EngineReply): void {
    const loaded = this.loaded;
    if (loaded === null) {
      throw new EngineError({ code: "E_PARSE", message: "exportSpice: no circuit loaded" });
    }
    reply({ id, type: "spice", payload: { text: serializeNetlist(loaded.circuit) } });
  }

  private evaluate(
    id: string,
    expr: string,
    context: Record<string, number> | undefined,
    reply: EngineReply,
  ): void {
    const voltages: Record<string, number> = {};
    const currents: Record<string, number> = {};
    const params: Record<string, number> = {};
    for (const [key, value] of Object.entries(context ?? {})) {
      const mv = /^v\((.+)\)$/.exec(key.toLowerCase());
      const mi = /^i\((.+)\)$/.exec(key.toLowerCase());
      if (mv !== null) {
        voltages[(mv[1] as string).toLowerCase()] = value;
      } else if (mi !== null) {
        currents[(mi[1] as string).toLowerCase()] = value;
      } else {
        params[key.toLowerCase()] = value;
      }
    }
    const value = evaluateExpression(expr, { voltages, currents, params });
    reply({ id, type: "evaluateResult", payload: { ok: true, value } });
  }

  // ─── runs ─────────────────────────────────────────────────────────────────

  private run(
    id: string,
    payload: {
      analysis: AnalysisRequest;
      stream?: { mode: "buffered" | "live"; realtimeFactor?: number };
      probes?: { signal: string }[];
    },
    reply: EngineReply,
  ): void {
    const loaded = this.requireLoaded();
    if (payload.stream?.mode === "live") {
      this.startLiveRun(id, loaded.compiled, payload, reply);
      return;
    }
    // Buffered: synchronous full run (bounded by the analysis request).
    this.runCounter += 1;
    const runId = `run-${this.runCounter}`;
    reply({ id, type: "runAccepted", payload: { ok: true, runId } });
    const result = runAnalysis(loaded.compiled, payload.analysis);
    reply({
      id,
      type: "data",
      payload: {
        runId,
        signals: result.signals.map((s) => signalInfoOf(s.name)),
        tStart: result.axis[0] ?? 0,
        chunk: result.signals.map((s) => ({ name: s.name, samples: Array.from(s.values) })),
      },
    });
    reply({
      id,
      type: "done",
      payload: {
        runId,
        stats: {
          timesteps: result.stats.acceptedSteps,
          rejectedSteps: result.stats.rejectedSteps,
          newtonIterations: result.stats.newtonIterations,
          method: result.stats.opMethod,
          fallbackUsed: result.stats.opMethod !== "direct",
        },
      },
    });
  }

  private startLiveRun(
    requestId: string,
    compiled: CompiledCircuit,
    payload: { analysis: AnalysisRequest; stream?: { realtimeFactor?: number } },
    reply: EngineReply,
  ): void {
    if (this.clock === null) {
      throw new EngineError({
        code: "E_PARSE",
        message:
          "live runs need a scheduler: pass SessionOptions.clock (core stays timer-free; hosts inject hostClock())",
      });
    }
    const analysis = payload.analysis;
    if (analysis.kind !== "tran") {
      throw new EngineError({
        code: "E_PARSE",
        message: `live streaming supports .tran only (got "${analysis.kind}")`,
      });
    }
    if (!(analysis.tstep > 0)) {
      throw new EngineError({ code: "E_PARSE", message: "live tran needs tstep > 0" });
    }
    this.runCounter += 1;
    const runId = `run-${this.runCounter}`;
    const externals = new ExternalRegistry();
    const ws = new Workspace(compiled, externals);
    // Live runs are unbounded: tstop is ignored (Infinity does not survive
    // JSON; clients send a large finite value or rely on `stop`).
    const stepper = new TranStepper(ws, compiled.options, {
      tstep: analysis.tstep,
      tstop: Number.POSITIVE_INFINITY,
      ...(analysis.tstart !== undefined ? { tstart: analysis.tstart } : {}),
      ...(analysis.tmax !== undefined ? { tmax: analysis.tmax } : {}),
      ...(analysis.uic !== undefined ? { uic: analysis.uic } : {}),
    });
    const run: LiveRun = {
      reply,
      clock: this.clock,
      runId,
      ws,
      stepper,
      externals,
      tstep: analysis.tstep,
      realtimeFactor: payload.stream?.realtimeFactor ?? 1,
      paused: false,
      stopped: false,
      timer: undefined,
      lastWall: this.clock.now(),
      signalNames: signalNamesFor(ws).filter((n) => {
        const wanted = probeWanted(ws);
        return wanted === undefined || wanted.has(n);
      }),
      chunkMs: this.chunkMs,
      maxSamplesPerTick: this.maxSamplesPerTick,
      finished: false,
    };
    this.runs.set(runId, run);
    reply({ id: requestId, type: "runAccepted", payload: { ok: true, runId } });

    // First chunk: initialize (OP/uic) and record the t = 0 sample through
    // the stepper's own initial-record guard (advance to the same time —
    // no stepping happens, so exactly one sample is emitted).
    try {
      stepper.start();
      this.advanceLive(run, 0);
    } catch (error) {
      this.failLiveRun(run, error);
      return;
    }
    run.lastWall = run.clock.now();
    run.timer = run.clock.schedule(() => this.tick(run), run.chunkMs);
  }

  private tick(run: LiveRun): void {
    if (run.finished || run.stopped || this.disposed) {
      return;
    }
    if (run.paused) {
      run.timer = run.clock.schedule(() => this.tick(run), run.chunkMs);
      return;
    }
    const now = run.clock.now();
    const wallElapsed = Math.max(0, (now - run.lastWall) / 1000);
    run.lastWall = now;
    // Backpressure guard: never produce more than maxSamplesPerTick samples
    // per tick, whatever the wall clock or realtimeFactor asks for.
    const simAdvance = Math.min(
      wallElapsed * run.realtimeFactor,
      run.tstep * run.maxSamplesPerTick,
    );
    try {
      this.advanceLive(run, run.stepper.time + simAdvance);
    } catch (error) {
      this.failLiveRun(run, error);
      return;
    }
    if (run.finished) {
      return;
    }
    run.timer = run.clock.schedule(() => this.tick(run), run.chunkMs);
  }

  /** Advance to `target` and emit one data chunk + progress. */
  private advanceLive(run: LiveRun, target: number): void {
    const times: number[] = [];
    const columns: number[][] = run.signalNames.map(() => []);
    const from = run.stepper.time;
    run.stepper.advance(target, (gt, x) => {
      times.push(gt);
      for (let s = 0; s < run.signalNames.length; s++) {
        const idx = signalIndex(run.signalNames[s] as string, run.ws);
        columns[s]?.push(idx >= 0 ? (x[idx] as number) : Number.NaN);
      }
    });
    if (times.length > 0) {
      this.emitChunk(run, times, columns, from);
    } else {
      run.reply({
        id: run.runId,
        type: "progress",
        payload: { runId: run.runId, fraction: 0, simTime: run.stepper.time },
      });
    }
  }

  /** Emit a data message; `columns`/`from` given, or captured from x at t=0. */
  private emitChunk(run: LiveRun, times: number[], columns?: number[][], from?: number): void {
    const chunk =
      columns !== undefined
        ? run.signalNames.map((name, s) => ({ name, samples: columns[s] ?? [] }))
        : run.signalNames.map((name) => ({
            name,
            samples: times.map(() => {
              const idx = signalIndex(name, run.ws);
              return idx >= 0 ? (run.ws.x[idx] as number) : Number.NaN;
            }),
          }));
    run.reply({
      id: run.runId,
      type: "data",
      payload: {
        runId: run.runId,
        signals: signalsOf(run),
        tStart: from ?? times[0] ?? 0,
        chunk,
      },
    });
    run.reply({
      id: run.runId,
      type: "progress",
      payload: { runId: run.runId, fraction: 0, simTime: run.stepper.time },
    });
  }

  private control(
    id: string,
    runId: string,
    op: "pause" | "resume" | "stop" | "step",
    reply: EngineReply,
  ): void {
    const run = this.requireRun(runId);
    if (run.finished) {
      throw new EngineError({
        code: "E_PARSE",
        message: `control "${op}": run ${runId} already finished`,
      });
    }
    switch (op) {
      case "pause":
        run.paused = true;
        break;
      case "resume":
        run.paused = false;
        run.lastWall = run.clock.now();
        break;
      case "stop":
        this.finishLiveRun(run);
        break;
      case "step":
        // One output-grid step while paused (or pausing now).
        run.paused = true;
        try {
          this.advanceLive(run, run.stepper.time + run.tstep);
        } catch (error) {
          this.failLiveRun(run, error);
          return;
        }
        break;
    }
    reply({ id, type: "ack", payload: { ok: true, op, runId } });
  }

  private setParam(
    id: string,
    payload: { runId: string; target: { elementName: string; property: string }; value: number },
    reply: EngineReply,
  ): void {
    const run = this.requireRun(payload.runId);
    if (payload.target.property === "wiper") {
      throw new EngineError({
        code: "E_PARSE",
        message: `setParam wiper: potentiometers arrive with U3 (SPEC §22); element ${payload.target.elementName}`,
      });
    }
    const device = findDevice(run.ws, payload.target.elementName);
    if (device === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `setParam: unknown element "${payload.target.elementName}"`,
      });
    }
    if (device.setLiveParam === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `setParam: element "${payload.target.elementName}" does not support live parameters`,
      });
    }
    device.setLiveParam(payload.target.property as "value", payload.value, run.stepper.time);
    // SPEC §4.4: safe integrator restart — order reset + breakpoint at now.
    run.stepper.resetOrder();
    run.stepper.insertBreakpoint(run.stepper.time);
    reply({
      id,
      type: "ack",
      payload: { ok: true, op: "setParam", runId: payload.runId },
    });
  }

  private setExternal(
    id: string,
    payload: { runId: string; channel: string; value: number | number[] },
    reply: EngineReply,
  ): void {
    const run = this.requireRun(payload.runId);
    if (typeof payload.value === "number") {
      run.externals.setScalar(payload.channel, payload.value);
    } else {
      run.externals.setSeries(payload.channel, payload.value, run.stepper.time, run.tstep);
    }
    reply({
      id,
      type: "ack",
      payload: { ok: true, op: "setExternal", runId: payload.runId },
    });
  }

  private finishLiveRun(run: LiveRun): void {
    if (run.finished) {
      return;
    }
    run.finished = true;
    run.stopped = true;
    this.stopTimer(run);
    this.runs.delete(run.runId);
    run.reply({
      id: run.runId,
      type: "done",
      payload: { runId: run.runId, stats: liveStats(run) },
    });
  }

  private failLiveRun(run: LiveRun, error: unknown): void {
    if (run.finished) {
      return;
    }
    run.finished = true;
    this.stopTimer(run);
    this.runs.delete(run.runId);
    run.reply({ id: run.runId, type: "error", payload: toErrorPayload(error) });
    run.reply({
      id: run.runId,
      type: "done",
      payload: { runId: run.runId, stats: liveStats(run) },
    });
  }

  private stopTimer(run: LiveRun): void {
    if (run.timer !== undefined) {
      run.clock.cancel(run.timer);
      run.timer = undefined;
    }
  }

  private requireLoaded(): { circuit: Circuit; compiled: CompiledCircuit } {
    if (this.loaded === null) {
      throw new EngineError({
        code: "E_PARSE",
        message: "no circuit loaded (send loadCircuit or loadSpice first)",
      });
    }
    return this.loaded;
  }

  private requireRun(runId: string): LiveRun {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `unknown or finished run "${runId}"`,
      });
    }
    return run;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadPayload(compiled: CompiledCircuit): {
  ok: true;
  nodeTable: { name: string; index: number }[];
  branchTable: { name: string; index: number }[];
  warnings: { code: string; message: string }[];
} {
  return {
    ok: true,
    nodeTable: compiled.nodeNames.map((name, index) => ({ name, index })),
    branchTable: compiled.branchOwners.map((name, index) => ({ name, index })),
    warnings: compiled.warnings.map((w) => ({ code: w.code, message: w.message })),
  };
}

function findDevice(ws: Workspace, elementName: string) {
  const lower = elementName.toLowerCase();
  return ws.devices.find((d) => d.name.toLowerCase() === lower);
}

function signalInfoOf(name: string): {
  name: string;
  unit: "v" | "a";
  kind: "voltage" | "current";
} {
  return {
    name,
    unit: name.startsWith("v(") ? ("v" as const) : ("a" as const),
    kind: name.startsWith("v(") ? ("voltage" as const) : ("current" as const),
  };
}

function signalsOf(run: LiveRun): ReturnType<typeof signalInfoOf>[] {
  return run.signalNames.map(signalInfoOf);
}

function liveStats(run: LiveRun): RunStats {
  return {
    timesteps: run.stepper.acceptedSteps,
    rejectedSteps: run.stepper.rejectedSteps,
    newtonIterations: 0,
    method: run.stepper.opMethod,
    fallbackUsed: false,
  };
}

function toErrorPayload(error: unknown): EngineErrorPayload {
  if (error instanceof EngineError) {
    return error.toJSON();
  }
  return new EngineError({ code: "E_PARSE", message: (error as Error).message }).toJSON();
}
