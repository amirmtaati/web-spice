/**
 * Scope data pipeline (UX3-T1/T2/T3, UI-UX-SPEC §6.7.1/§7): the React-free
 * per-frame engine between resultStore ring buffers and uPlot. Runs inside
 * the rAF frame loop (`useInstrumentFrame`); React never re-renders per data
 * chunk — the legend/measurements read caches at 4 Hz.
 *
 * Per frame: window selection (triggered / free-run / roll) → strided window
 * copy (transform: invert/offset) → aligned min-max decimation when zoomed
 * out → `u.setData()` on reused typed arrays (no data copying; only subarray
 * view objects churn). Trigger search is deterministic (trigger.ts, recorded
 * streams in tests).
 */
import type uPlot from "uplot";
import { getSimController } from "../../sim/controller.ts";
import { resultStore } from "../../stores/result-store.ts";
import { applyMath } from "../math.ts";
import { alignedBinX, decimateAlignedY } from "./decimate.ts";
import { DecimatorHost } from "./decimator.ts";
import { type MeasurementRow, measureAll } from "./measure.ts";
import { MAX_CHANNELS, measurementCache, type ScopeChannel, useScopeStore } from "./scope-store.ts";
import { findTrigger, resolveAnchor, type TriggerConfig } from "./trigger.ts";

/** Window scratch cap per channel (strided beyond this — documented limit). */
const WINDOW_CAP = 1 << 17;
/** Decimated path capacity: bins ≤ 4096 → 2·bins points. */
const DECIMATED_POINTS = 8192;
/** Raw path threshold: at or below this many visible samples, draw raw. */
const RAW_FACTOR = 2;
/** Measurement/eval refresh cadence (§6.7.1: throttled to 4 Hz). */
const READOUT_MS = 250;
/** Measurements run on a ≤ 8 k-point reduction of the window (4 Hz × 8 ch). */
const MEASURE_CAP = 8192;
/** Ghost series slots for the run-history overlay (UX3-T8, "last 5"). */
export const GHOST_SLOTS = 5;
const GHOST_BINS = 512;

export interface ScopeView {
  valid: boolean;
  /** Absolute sample index of the window start. */
  startIdx: number;
  /** Window length in samples (after stride clamping). */
  count: number;
  /** Axis value of window start; per-point sample step (stride ≥ 1). */
  x0: number;
  dt: number;
  stride: number;
  /** Total samples in the run. */
  total: number;
  triggered: boolean;
}

/** Custom-evaluate readout cache (legend, §6.7.1 math channels). */
export const customEvalCache: { expr: string | null; value: number | null; error: string | null } =
  {
    expr: null,
    value: null,
    error: null,
  };

export class ScopePipeline {
  private u: uPlot | null = null;
  private width = 0;

  /** Worker decimator (UX3-T2) — inline fallback inside the host. */
  readonly decimator = new DecimatorHost();

  private windows = new Map<string, Float64Array>();
  private ghostX = new Float64Array(GHOST_BINS);
  private ghosts: Float64Array[] = [];
  private historyKey = "";
  private axisScratch = new Float64Array(MEASURE_CAP);
  private xBuf = new Float64Array(DECIMATED_POINTS);
  /** uPlot aligned data — view objects refreshed per frame, buffers reused. */
  data: unknown[] = [];

  view: ScopeView = {
    valid: false,
    startIdx: 0,
    count: 0,
    x0: 0,
    dt: 0,
    stride: 1,
    total: 0,
    triggered: false,
  };

  /** Absolute index of the last accepted trigger (holdoff + single state). */
  private lastAccepted = -1;
  private lastAnchor: number | null = null;
  /** ms timestamp until which the trigger glyph flashes. */
  triggerFlashUntil = 0;
  private lastMeasureAt = 0;
  private lastScopeRef: unknown = null;
  private lastRunId: string | null = null;

  attach(u: uPlot): void {
    this.u = u;
    this.lastScopeRef = null; // force series resync on next frame
  }

  detach(): void {
    this.u = null;
  }

  resize(width: number): void {
    this.width = width;
  }

  // ─── frame ─────────────────────────────────────────────────────────────────

  frame(now: number): void {
    const scope = useScopeStore.getState();
    const total = resultStore.sampleCount;
    const analysis = resultStore.currentAnalysis;
    const runId = resultStore.currentRunId;

    const configChanged = scope !== this.lastScopeRef || runId !== this.lastRunId;
    if (configChanged) {
      this.lastScopeRef = scope;
      this.lastRunId = runId;
    }

    if (
      this.u === null ||
      scope.channels.length === 0 ||
      total === 0 ||
      analysis === null ||
      analysis.kind !== "tran" ||
      !(analysis.tstep > 0)
    ) {
      this.invalidate();
      return;
    }
    const dt = analysis.tstep;

    // ── window selection ───────────────────────────────────────────────
    const span = scope.secPerDiv * 10;
    const wantedCount = Math.max(8, Math.round(span / dt));
    const stride = Math.max(1, Math.ceil(wantedCount / WINDOW_CAP));
    const count = Math.min(wantedCount, WINDOW_CAP);
    const minAnchor = Math.ceil(scope.position * count);
    const maxAnchor = total - Math.ceil((1 - scope.position) * count);

    let startIdx: number;
    let triggered = false;
    const rollActive = scope.roll && resultStore.isRunning;
    const sourceName = rollActive ? null : (scope.trigger.source ?? realChannelOf(scope.channels));

    if (sourceName !== null) {
      const cfg: TriggerConfig = {
        level: scope.trigger.level,
        edge: scope.trigger.edge,
        holdoffSamples: Math.max(0, Math.round(scope.trigger.holdoffSec / dt)),
      };
      const lo = Math.max(1, minAnchor);
      const hi = Math.min(total - 1, maxAnchor);
      const singleFrozen =
        scope.trigger.mode === "single" && !scope.trigger.armed && this.lastAccepted >= 0;
      let found: number | null = null;
      if (!singleFrozen && hi >= lo) {
        const buf = this.scratch("__trigger__", hi - lo + 1);
        const got = resultStore.readWindowInto(sourceName, lo, hi - lo + 1, buf);
        const relFound =
          got > 1
            ? findTrigger(
                buf,
                cfg,
                1,
                got - 1,
                this.lastAccepted >= lo ? this.lastAccepted - lo : -1,
              )
            : null;
        found = relFound !== null ? lo + relFound : null;
      }
      const res = resolveAnchor(scope.trigger.mode, found, this.lastAnchor);
      if (res.accepted !== null && res.accepted !== this.lastAccepted) {
        this.lastAccepted = res.accepted;
        this.triggerFlashUntil = now + 150;
        if (scope.trigger.mode === "single" && scope.trigger.armed) {
          useScopeStore.setState((s) => ({ trigger: { ...s.trigger, armed: false } }));
        }
      }
      this.lastAnchor = res.anchor;
      if (res.anchor !== null) {
        triggered = res.triggered;
        startIdx = res.anchor - Math.round(scope.position * count);
      } else {
        // Auto free-run: window hugs the newest data, position applies.
        startIdx = total - count - Math.round((1 - scope.position) * count);
      }
    } else {
      // Roll mode (live) or no triggerable channel: scrolling newest window.
      startIdx = total - count;
    }

    startIdx = Math.max(0, Math.min(startIdx, total - 1));
    const visible = Math.min(count, total - startIdx);
    if (visible < 2) {
      this.invalidate();
      return;
    }

    this.view = {
      valid: true,
      startIdx,
      count: visible,
      x0: resultStore.firstAxisValue + startIdx * dt,
      dt: dt * stride,
      stride,
      total,
      triggered,
    };

    // ── data assembly ──────────────────────────────────────────────────
    const px = this.width > 0 ? this.width : 800;
    const rawThreshold = Math.max(64, px * RAW_FACTOR);
    const decimated = visible > rawThreshold;
    const bins = decimated ? Math.max(64, Math.min(4096, Math.floor(px / 2))) : 0;
    const points = decimated ? bins * 2 : visible;

    if (this.xBuf.length < points) {
      this.xBuf = new Float64Array(points);
    }
    if (decimated) {
      alignedBinX(this.view.x0, this.view.dt, visible, bins, this.xBuf);
    } else {
      for (let k = 0; k < visible; k++) {
        this.xBuf[k] = this.view.x0 + k * this.view.dt;
      }
    }

    let slot = 1;
    for (const ch of scope.channels) {
      if (!ch.visible) {
        continue;
      }
      const values = this.channelWindow(ch, startIdx, visible, stride);
      const out = this.slotBuffer(slot, points);
      if (decimated && bins > 0) {
        const sig = { startIdx, count: visible, bins };
        const fresh = this.decimator.take(ch.id, sig);
        if (fresh !== null && fresh.length === points) {
          out.set(fresh);
        } else {
          // Inline this frame (worker result lands next frame — one-frame
          // display latency is invisible at scope refresh rates).
          decimateAlignedY(values, 0, visible, bins, out);
          this.decimator.submit(ch.id, sig, values, bins);
        }
      } else {
        out.set(values.subarray(0, Math.min(visible, out.length)));
      }
      slot += 1;
    }

    this.u.setData(this.assembleData(scope, points) as uPlot.AlignedData);

    // ── readouts (4 Hz) ────────────────────────────────────────────────
    if (now - this.lastMeasureAt >= READOUT_MS) {
      this.lastMeasureAt = now;
      if (scope.showMeasurements) {
        this.measure(scope);
      }
      if (scope.showHistory) {
        this.refreshGhosts();
      }
      void this.evaluateCustom(scope);
    }
  }

  private invalidate(): void {
    if (this.u !== null && this.view.valid) {
      this.u.setData([this.xBuf.subarray(0, 0)]);
    }
    if (this.view.valid || this.view.count !== 0) {
      this.view = { ...this.view, valid: false, triggered: false, count: 0 };
    }
  }

  // ─── buffers ───────────────────────────────────────────────────────────────

  private scratch(id: string, n: number): Float64Array {
    const existing = this.windows.get(id);
    if (existing !== undefined && existing.length >= n) {
      return existing;
    }
    const buf = new Float64Array(Math.max(n, 1024));
    this.windows.set(id, buf);
    return buf;
  }

  /** Window copy for a real signal (strided beyond WINDOW_CAP). */
  private windowOf(name: string, startIdx: number, count: number, stride: number): Float64Array {
    const n = Math.ceil(count / stride);
    const buf = this.scratch(name, n);
    resultStore.readWindowInto(name, startIdx, count, buf, stride);
    return buf;
  }

  /** Channel window with math resolution + invert/offset applied. */
  private channelWindow(
    ch: ScopeChannel,
    startIdx: number,
    count: number,
    stride: number,
  ): Float64Array {
    let values: Float64Array;
    if (ch.math !== undefined) {
      const n = Math.ceil(count / stride);
      values = this.scratch(ch.id, n);
      const byId = channelIndex(useScopeStore.getState().channels);
      applyMath(
        ch.math,
        (name) => {
          const target = byId.get(name);
          if (target === undefined || target.math !== undefined) {
            return undefined; // math operands are real signals only (v1 rule)
          }
          return this.windowOf(target.id, startIdx, count, stride);
        },
        this.view.dt * stride,
        values,
      );
    } else {
      values = this.windowOf(ch.id, startIdx, count, stride);
    }
    const sign = ch.invert ? -1 : 1;
    if (ch.invert || ch.offset !== 0) {
      for (let k = 0; k < values.length; k++) {
        const v = values[k];
        if (v === undefined || Number.isNaN(v)) {
          continue;
        }
        values[k] = v * sign + ch.offset;
      }
    }
    return values;
  }

  private slotBuffer(slot: number, points: number): Float64Array {
    const buf = this.scratch(`__slot${slot}`, points);
    return buf.subarray(0, points);
  }

  /** Series data views: [x, ch1…ch8, ghost1…ghost5] — fixed 14 slots so
   * uPlot's series array never mismatches the data array count. */
  private assembleData(
    scope: ReturnType<typeof useScopeStore.getState>,
    points: number,
  ): unknown[] {
    const data: unknown[] = [this.xBuf.subarray(0, points)];
    let slot = 1;
    for (const ch of scope.channels) {
      if (!ch.visible) {
        continue;
      }
      data.push(this.slotBuffer(slot, points));
      slot += 1;
    }
    const empty = this.scratch("__empty", 1);
    while (slot <= MAX_CHANNELS) {
      data.push(empty.subarray(0, 0));
      slot += 1;
    }
    for (let g = 0; g < GHOST_SLOTS; g++) {
      const ghost = this.ghosts[g];
      data.push(
        scope.showHistory && ghost !== undefined
          ? ghost
          : this.scratch(`__ghostEmpty${g}`, 1).subarray(0, 0),
      );
    }
    return data;
  }

  /** Run-history ghosts (4 Hz): newest run's axis span, one trace per run. */
  private refreshGhosts(): void {
    const history = resultStore.getSnapshot().history;
    const key = history
      .slice(0, GHOST_SLOTS)
      .map((r) => r.id)
      .join("|");
    if (key === this.historyKey) {
      return;
    }
    this.historyKey = key;
    this.ghosts = [];
    const first = history[0];
    if (
      first === undefined ||
      !Number.isFinite(first.axisStart) ||
      !Number.isFinite(first.axisEnd)
    ) {
      return;
    }
    const span = first.axisEnd - first.axisStart;
    if (!(span > 0)) {
      return;
    }
    for (let b = 0; b < GHOST_BINS; b++) {
      this.ghostX[b] = first.axisStart + (span * b) / (GHOST_BINS - 1);
    }
    for (const run of history.slice(0, GHOST_SLOTS)) {
      const sig = run.signals[0];
      if (sig === undefined || sig.envelope.length < 2) {
        continue;
      }
      const g = new Float64Array(GHOST_BINS);
      const pairs = sig.envelope.length / 2;
      const runSpan = run.axisEnd - run.axisStart;
      for (let b = 0; b < GHOST_BINS; b++) {
        const t = first.axisStart + (span * b) / (GHOST_BINS - 1);
        const u = runSpan > 0 ? (t - run.axisStart) / runSpan : 0;
        const idx = Math.min(pairs - 1, Math.max(0, Math.floor(u * pairs))) * 2;
        const lo = sig.envelope[idx] ?? Number.NaN;
        const hi = sig.envelope[idx + 1] ?? Number.NaN;
        g[b] = Number.isNaN(lo) ? hi : Number.isNaN(hi) ? lo : (lo + hi) / 2;
      }
      this.ghosts.push(g);
    }
  }

  // ─── readouts ──────────────────────────────────────────────────────────────

  private measure(scope: ReturnType<typeof useScopeStore.getState>): void {
    const { startIdx, count, stride, dt, x0 } = this.view;
    for (const ch of scope.channels) {
      if (ch.math !== undefined) {
        continue; // math channels mirror their operands' statistics
      }
      const mStride = Math.max(stride, Math.ceil(count / MEASURE_CAP));
      const n = Math.ceil(count / mStride);
      const values = this.scratch(`__measure__${ch.id}`, n);
      resultStore.readWindowInto(ch.id, startIdx, count, values, mStride);
      const axis = this.axisScratch;
      const mdt = dt * (mStride / stride);
      for (let k = 0; k < n; k++) {
        axis[k] = x0 + k * mdt;
      }
      const row: MeasurementRow = measureAll(axis, values, 0, n);
      measurementCache.set(ch.id, row);
    }
  }

  /** Custom expression via engine `evaluate` at the last-sample context. */
  private async evaluateCustom(scope: ReturnType<typeof useScopeStore.getState>): Promise<void> {
    const expr = scope.customExpr;
    customEvalCache.expr = expr;
    if (expr === null || expr.length === 0) {
      customEvalCache.value = null;
      customEvalCache.error = null;
      return;
    }
    const context: Record<string, number> = {};
    for (const name of resultStore.signalNames) {
      context[name] = resultStore.lastValue(name);
    }
    try {
      const result = await getSimController().evaluate(expr, context);
      if (useScopeStore.getState().customExpr !== expr) {
        return; // expression changed mid-flight
      }
      if (result.ok) {
        customEvalCache.value = result.value;
        customEvalCache.error = null;
      } else {
        customEvalCache.value = null;
        customEvalCache.error = result.error;
      }
    } catch (err: unknown) {
      customEvalCache.value = null;
      customEvalCache.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ─── coordinate mapping (cursor overlay) ───────────────────────────────────

  toPxX(xSec: number): number {
    return this.u !== null && this.view.valid ? this.u.valToPos(xSec, "x", true) : Number.NaN;
  }

  toDataX(px: number): number {
    return this.u !== null && this.view.valid ? this.u.posToVal(px, "x", true) : Number.NaN;
  }

  toPxY(v: number): number {
    return this.u !== null && this.view.valid ? this.u.valToPos(v, "y", true) : Number.NaN;
  }

  toDataY(px: number): number {
    return this.u !== null && this.view.valid ? this.u.posToVal(px, "y", true) : Number.NaN;
  }

  /** Plot-area geometry (px) for the cursor overlay. */
  geometry(): { left: number; top: number; width: number; height: number } {
    const u = this.u;
    if (u === null) {
      return { left: 0, top: 0, width: this.width, height: 0 };
    }
    return {
      left: u.bbox.left,
      top: u.bbox.top,
      width: u.bbox.width,
      height: u.bbox.height,
    };
  }

  /** Window values of a channel for cursor tracking (no copy). */
  valuesOf(id: string): Float64Array | null {
    return this.windows.get(id) ?? null;
  }

  /** Full-run export snapshot (CSV): axis + every retained signal. */
  exportData(): {
    axis: Float64Array;
    signals: { name: string; unit: string; values: Float64Array }[];
  } {
    const names = resultStore.signalNames;
    const n = resultStore.sampleCount;
    const axis = new Float64Array(n);
    resultStore.readAxisInto(n, axis);
    return {
      axis,
      signals: names.map((name) => ({
        name,
        unit: resultStore.unitOf(name),
        values: resultStore.readSignal(name),
      })),
    };
  }

  /** Test/diagnostic reset. */
  resetForTests(): void {
    this.windows.clear();
    this.ghosts = [];
    this.historyKey = "";
    this.lastAccepted = -1;
    this.lastAnchor = null;
    this.view = {
      valid: false,
      startIdx: 0,
      count: 0,
      x0: 0,
      dt: 0,
      stride: 1,
      total: 0,
      triggered: false,
    };
  }
}

function realChannelOf(channels: readonly ScopeChannel[]): string | null {
  for (const c of channels) {
    if (c.math === undefined) {
      return c.id;
    }
  }
  return null;
}

function channelIndex(channels: readonly ScopeChannel[]): Map<string, ScopeChannel> {
  const m = new Map<string, ScopeChannel>();
  for (const c of channels) {
    m.set(c.id, c);
  }
  return m;
}

/** App-wide pipeline singleton (owned by the ScopePanel). */
export const scopePipeline = new ScopePipeline();
