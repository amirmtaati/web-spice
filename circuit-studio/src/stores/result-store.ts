/**
 * resultStore (UX2-T2, UI-UX-SPEC §7): signal registry + per-signal ring
 * buffers + decimation caches + run history. The hot path (`appendChunk`) is
 * O(1) per sample with zero allocation — React never sees it. React-facing
 * consumers (tables, chips) subscribe to a snapshot `version` that bumps at
 * most every 100 ms while streaming (§7 rule 2); instruments read buffers
 * directly inside rAF via `useInstrumentFrame`.
 *
 * Axis values are not stored — rebuilt lazily per AGENTS.md §5.2 via
 * `buildAxis` from the analysis request + first chunk tStart (uniform grids,
 * engine guarantee).
 */
import { buildAxis, describeAnalysis } from "../sim/axis.ts";
import { decimateRingMinMax, RingBuffer, snapCapacity } from "../sim/ringbuffer.ts";
import type { AnalysisRequest, DataChunk, RunMode, RunStats, SignalInfo } from "../sim/types.ts";

/** Samples retained per signal (Float64 ≈ 8 MiB + Float32 display 4 MiB). */
export const SIGNAL_CAPACITY = 1 << 20;
/** Run history length (overlay compare, §6.7 "last 5"). */
export const RUN_HISTORY_MAX = 5;
/** History envelope bins per signal (min/max pairs). */
export const HISTORY_BINS = 1000;
/** React snapshot throttle while streaming (§7: ≥ 100 ms). */
export const VERSION_THROTTLE_MS = 100;

interface SignalChannel {
  readonly name: string;
  readonly unit: SignalInfo["unit"];
  readonly kind: SignalInfo["kind"];
  readonly f64: RingBuffer;
  /** Display copy (plots read this; window-aligned with the f64 ring). */
  readonly f32: Float32Array;
  f32Count: number;
}

/** A finished run kept for overlay/compare (decimated, bounded memory). */
export interface RunSummary {
  readonly id: string;
  readonly label: string;
  readonly analysis: AnalysisRequest;
  readonly mode: RunMode;
  readonly axisUnit: string;
  /** Axis window [start, end] actually received (NaN when empty). */
  readonly axisStart: number;
  readonly axisEnd: number;
  readonly points: number;
  readonly stats: RunStats | null;
  readonly signals: readonly {
    readonly name: string;
    readonly unit: string;
    /** min/max pairs over HISTORY_BINS bins (x-aligned with axisStart…axisEnd). */
    readonly envelope: Float64Array;
  }[];
}

export interface ResultSnapshot {
  /** Monotonic version — bump throttled; React consumers compare identity. */
  readonly version: number;
  readonly runId: string | null;
  readonly mode: RunMode | null;
  readonly running: boolean;
  readonly signalNames: readonly string[];
  readonly sampleCount: number;
  readonly axisStart: number;
  readonly axisEnd: number;
  readonly history: readonly RunSummary[];
  readonly lastError: string | null;
}

type Listener = () => void;

class ResultStoreImpl {
  private channels = new Map<string, SignalChannel>();
  private order: string[] = [];
  private analysis: AnalysisRequest | null = null;
  private mode: RunMode = "buffered";
  private runId: string | null = null;
  private running = false;
  private axisStart = Number.NaN;
  private count = 0;
  private lastError: string | null = null;
  private readonly history: RunSummary[] = [];

  private version = 0;
  private versionDirty = false;
  private versionTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  /** Start a run: replaces the live buffers, keeps history. */
  beginRun(runId: string, analysis: AnalysisRequest, mode: RunMode): void {
    this.runId = runId;
    this.analysis = analysis;
    this.mode = mode;
    this.running = true;
    this.axisStart = Number.NaN;
    this.count = 0;
    this.lastError = null;
    this.channels.clear();
    this.order = [];
    this.bumpVersion();
  }

  /** Register the run's signals (from runAccepted/data SignalInfo[]). */
  setSignals(signals: readonly SignalInfo[]): void {
    if (!this.running) {
      return;
    }
    for (const info of signals) {
      if (this.channels.has(info.name)) {
        continue;
      }
      this.channels.set(info.name, {
        name: info.name,
        unit: info.unit,
        kind: info.kind,
        f64: new RingBuffer(SIGNAL_CAPACITY),
        f32: new Float32Array(snapCapacity(SIGNAL_CAPACITY)),
        f32Count: 0,
      });
      this.order.push(info.name);
    }
  }

  /**
   * Re-point the active run id (controller call on the data path): the
   * client's handle id is the request id until `runAccepted` promotes the
   * engine-assigned runId — chunks carry the engine id, so retarget before
   * appending (AGENTS.md §5.1 routing invariant).
   */
  retargetRunId(runId: string): void {
    if (this.running && this.runId !== runId) {
      this.runId = runId;
    }
  }

  /**
   * The data path (AGENTS.md §5.3): O(1) per sample, nothing heavier.
   * Chunks arrive contiguous on the analysis grid; `tStart` of the first
   * chunk seeds axis reconstruction.
   */
  appendChunk(chunk: DataChunk): void {
    if (!this.running || this.runId !== chunk.runId) {
      return;
    }
    if (Number.isNaN(this.axisStart)) {
      this.axisStart = chunk.tStart;
    }
    this.setSignals(chunk.signals);
    // Contract: one entry per signal, all the same length (AGENTS.md §5.1).
    const n = chunk.chunk[0]?.samples.length ?? 0;
    if (n === 0) {
      return;
    }
    for (const { name, samples } of chunk.chunk) {
      const ch = this.channels.get(name);
      if (ch === undefined) {
        continue;
      }
      ch.f64.appendBlock(samples);
      // Float32 display copy — drop-oldest window aligned with the f64 ring.
      const cap = ch.f32.length;
      if (n >= cap) {
        for (let k = 0; k < cap; k++) {
          const v = samples[n - cap + k];
          if (v !== undefined) {
            ch.f32[k] = v;
          }
        }
        ch.f32Count = cap;
      } else if (ch.f32Count + n <= cap) {
        ch.f32.set(samples, ch.f32Count);
        ch.f32Count += n;
      } else {
        const drop = ch.f32Count + n - cap;
        ch.f32.copyWithin(0, drop, ch.f32Count);
        ch.f32.set(samples, cap - n);
        ch.f32Count = cap;
      }
    }
    this.count += n;
    this.markDirty();
  }

  /** Finish a run: snapshot into history (decimated envelope). */
  endRun(stats: RunStats | null, error: string | null = null): void {
    this.running = false;
    this.lastError = error;
    if (this.analysis !== null && this.count > 0) {
      this.history.unshift(this.summarize(stats));
      if (this.history.length > RUN_HISTORY_MAX) {
        this.history.pop();
      }
    }
    this.bumpVersion();
  }

  private summarize(stats: RunStats | null): RunSummary {
    const analysis = this.analysis;
    if (analysis === null) {
      throw new Error("summarize without analysis");
    }
    return {
      id: this.runId ?? "?",
      label: describeAnalysis(analysis),
      analysis,
      mode: this.mode,
      axisUnit: axisUnitOf(analysis),
      axisStart: this.axisStart,
      axisEnd: Number.isNaN(this.axisStart)
        ? Number.NaN
        : axisValueAt(analysis, this.axisStart, this.count - 1),
      points: this.count,
      stats,
      signals: this.order.map((name) => {
        const ch = this.channels.get(name);
        const envelope =
          ch === undefined
            ? new Float64Array(0)
            : decimateRingMinMax(ch.f64, ch.f64.length, HISTORY_BINS);
        return { name, unit: unitString(ch?.unit), envelope };
      }),
    };
  }

  // ─── reads (instruments, rAF) ──────────────────────────────────────────────

  get signalNames(): readonly string[] {
    return this.order;
  }

  get sampleCount(): number {
    return this.count;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentRunId(): string | null {
    return this.runId;
  }

  get firstAxisValue(): number {
    return this.axisStart;
  }

  /** Last received axis value (NaN before data; cheap — no allocation). */
  get axisEnd(): number {
    if (this.analysis === null || Number.isNaN(this.axisStart) || this.count === 0) {
      return Number.NaN;
    }
    return axisValueAt(this.analysis, this.axisStart, this.count - 1);
  }

  get currentAnalysis(): AnalysisRequest | null {
    return this.analysis;
  }

  /** Retained samples for one signal (chronological, copies). */
  readSignal(name: string): Float64Array {
    return this.channels.get(name)?.f64.toArray() ?? new Float64Array(0);
  }

  /**
   * Read the last `count` samples of a signal into `out` (chronological).
   * Returns samples written. No allocation on the hot path.
   */
  readLastInto(name: string, count: number, out: Float64Array): number {
    return this.channels.get(name)?.f64.readLast(count, out) ?? 0;
  }

  /** Display (Float32) window of a signal — same order as the f64 ring. */
  readDisplay(name: string): Float32Array {
    const ch = this.channels.get(name);
    if (ch === undefined || ch.f32Count === 0) {
      return new Float32Array(0);
    }
    return ch.f32.slice(0, ch.f32Count);
  }

  /** Rebuild the axis for the last `count` samples into `out` (§5.2). */
  readAxisInto(count: number, out: Float64Array): number {
    if (this.analysis === null || Number.isNaN(this.axisStart) || this.count === 0) {
      return 0;
    }
    const n = Math.min(count, this.count, out.length);
    const windowStart = axisValueAt(this.analysis, this.axisStart, this.count - n);
    const axis = buildAxis(this.analysis, windowStart, n);
    out.set(axis);
    return n;
  }

  /** Last value of a signal (cross-probe/meters). NaN when unknown. */
  lastValue(name: string): number {
    const ch = this.channels.get(name);
    if (ch === undefined || ch.f64.length === 0) {
      return Number.NaN;
    }
    return ch.f64.at(ch.f64.length - 1);
  }

  /** Unit string for a signal name (chunk registry). */
  unitOf(name: string): string {
    return unitString(this.channels.get(name)?.unit);
  }

  // ─── React-facing snapshot (throttled) ─────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test isolation: clears all state including pending throttle timers. */
  resetForTests(): void {
    if (this.versionTimer !== null) {
      globalThis.clearTimeout(this.versionTimer);
      this.versionTimer = null;
    }
    this.versionDirty = false;
    this.listeners.clear();
    this.channels.clear();
    this.order = [];
    this.history.length = 0;
    this.analysis = null;
    this.runId = null;
    this.running = false;
    this.axisStart = Number.NaN;
    this.count = 0;
    this.lastError = null;
  }

  getSnapshot(): ResultSnapshot {
    return {
      version: this.version,
      runId: this.runId,
      mode: this.mode,
      running: this.running,
      signalNames: [...this.order],
      sampleCount: this.count,
      axisStart: this.axisStart,
      axisEnd: Number.isNaN(this.axisStart) ? Number.NaN : this.axisEnd,
      history: [...this.history],
      lastError: this.lastError,
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private markDirty(): void {
    if (this.versionTimer !== null) {
      this.versionDirty = true;
      return;
    }
    this.bumpVersion();
    this.versionTimer = globalThis.setTimeout(() => {
      this.versionTimer = null;
      if (this.versionDirty) {
        this.versionDirty = false;
        this.markDirty();
      }
    }, VERSION_THROTTLE_MS);
  }

  private bumpVersion(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Axis value of global sample `index` given the run's first axis value. */
function axisValueAt(analysis: AnalysisRequest, axisStart: number, index: number): number {
  switch (analysis.kind) {
    case "op":
    case "tf":
      return 0;
    case "tran":
      return axisStart + index * analysis.tstep;
    case "dc":
      return axisStart + index * analysis.step;
    case "ac":
    case "noise":
      // Geometric grids: index arithmetic per §5.2 (axisStart = fstart·base⁰).
      if (analysis.sweep === "dec") {
        return analysis.fstart * 10 ** (index / analysis.points);
      }
      if (analysis.sweep === "oct") {
        return analysis.fstart * 2 ** (index / analysis.points);
      }
      return (
        analysis.fstart +
        (index * (analysis.fstop - analysis.fstart)) / Math.max(1, analysis.points - 1)
      );
  }
}

function unitString(unit: SignalInfo["unit"] | undefined): string {
  switch (unit) {
    case "v":
      return "V";
    case "a":
      return "A";
    case "w":
      return "W";
    case "hz":
      return "Hz";
    case "db":
      return "dB";
    case undefined:
      return "";
  }
}

function axisUnitOf(analysis: AnalysisRequest): string {
  switch (analysis.kind) {
    case "tran":
      return "s";
    case "ac":
    case "noise":
      return "Hz";
    case "dc":
      return "V";
    case "op":
    case "tf":
      return "";
  }
}

/** App-wide singleton (SPEC §8.1 stores). */
export const resultStore = new ResultStoreImpl();

/** Diagnostics/debug handle (§6.6 drawer; also used by e2e journeys). */
export function attachResultStoreDebug(target: Record<string, unknown>): void {
  target.resultStore = resultStore;
}
