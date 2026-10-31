/**
 * Axis reconstruction (UX2-T2, AGENTS.md §5.2): the engine does NOT transmit
 * the axis array — data chunks carry per-signal samples plus `tStart` (first
 * axis value of the chunk) and always sit on the analysis's own grid, so the
 * UI rebuilds x from the request. Chunks are contiguous by engine guarantee;
 * concatenate by index arithmetic, never by matching sample values.
 *
 * One function (`buildAxis`) so a protocol bump (explicit axis column) touches
 * exactly one file (AGENTS.md §13 known gap).
 */
import type { AnalysisRequest } from "./types.ts";

/**
 * Rebuild the axis for `n` samples of `analysis` whose first sample sits at
 * axis value `tStart`. For buffered runs the first chunk's `tStart` equals the
 * analysis start (0 for tran unless `tstart` given); for live tran chunks
 * `tStart` continues the uniform `tstep` grid.
 */
export function buildAxis(analysis: AnalysisRequest, tStart: number, n: number): Float64Array {
  const out = new Float64Array(Math.max(0, n));
  switch (analysis.kind) {
    case "op":
    case "tf":
      // Single-sample analyses: the axis is nominal (0).
      for (let k = 0; k < out.length; k++) out[k] = 0;
      return out;
    case "dc":
      return uniform(out, tStart, analysis.step);
    case "tran":
      return uniform(out, tStart, analysis.tstep);
    case "ac":
    case "noise":
      return logAxis(out, analysis, tStart);
  }
}

/** `x[k] = tStart + k·step` (dc sweeps and tran output grids). */
function uniform(out: Float64Array, tStart: number, step: number): Float64Array {
  for (let k = 0; k < out.length; k++) {
    out[k] = tStart + k * step;
  }
  return out;
}

/** AC/noise sweeps: dec/oct are geometric, lin is uniform (§5.2). */
function logAxis(
  out: Float64Array,
  analysis: Extract<AnalysisRequest, { kind: "ac" | "noise" }>,
  tStart: number,
): Float64Array {
  const { sweep, points, fstart, fstop } = analysis;
  switch (sweep) {
    case "dec": {
      // fstart · 10^(k/points) — the chunk's tStart is fstart·10^(j/points)
      // for the j-th global sample, so scale relative to fstart.
      const base = tStart > 0 ? tStart / fstart : 1;
      for (let k = 0; k < out.length; k++) {
        out[k] = fstart * base * 10 ** (k / points);
      }
      return out;
    }
    case "oct": {
      const base = tStart > 0 ? tStart / fstart : 1;
      for (let k = 0; k < out.length; k++) {
        out[k] = fstart * base * 2 ** (k / points);
      }
      return out;
    }
    case "lin": {
      // fstart + k·(fstop−fstart)/(points−1); single point → fstart.
      const span = points > 1 ? (fstop - fstart) / (points - 1) : 0;
      return uniform(out, tStart, span);
    }
  }
}

/** Human label for the axis of an analysis (plot x-title). */
export function axisLabel(analysis: AnalysisRequest): string {
  switch (analysis.kind) {
    case "op":
    case "tf":
      return "point";
    case "dc":
      return `${analysis.source} (V)`;
    case "tran":
      return "time (s)";
    case "ac":
    case "noise":
      return "frequency (Hz)";
  }
}

/** Unit string for the axis (format.ts `formatUnit` consumers). */
export function axisUnit(analysis: AnalysisRequest): string {
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

/** Total points a full (buffered) run of this analysis will produce. */
export function axisPointCount(analysis: AnalysisRequest): number | null {
  switch (analysis.kind) {
    case "op":
    case "tf":
      return 1;
    case "tran": {
      const t0 = analysis.tstart ?? 0;
      if (analysis.tstep <= 0) {
        return null;
      }
      return Math.max(1, Math.floor((analysis.tstop - t0) / analysis.tstep) + 1);
    }
    case "dc":
      return analysis.step > 0
        ? Math.max(1, Math.floor((analysis.stop - analysis.start) / analysis.step) + 1)
        : null;
    case "ac":
    case "noise":
      return analysis.points > 0 ? analysis.points : null;
  }
}

/**
 * Short summary used by run chips/history ("tran 1µ·10m", "ac dec 20 1…1M").
 * Deliberately compact — the full request is shown in tooltips/options.
 */
export function describeAnalysis(analysis: AnalysisRequest): string {
  switch (analysis.kind) {
    case "op":
      return "OP";
    case "tf":
      return `TF ${analysis.output} ← ${analysis.source}`;
    case "dc":
      return `DC ${analysis.source} ${analysis.start}→${analysis.stop}`;
    case "tran": {
      return `Tran ${(analysis.tstart ?? 0) > 0 ? `${analysis.tstart}…` : ""}${analysis.tstop}`;
    }
    case "ac":
      return `AC ${analysis.sweep} ${analysis.points} ${analysis.fstart}…${analysis.fstop}`;
    case "noise":
      return `Noise ${analysis.fstart}…${analysis.fstop}`;
  }
}
