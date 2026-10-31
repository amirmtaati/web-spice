/**
 * Min-max envelope decimation (UX3-T2, UI-UX-SPEC §6.7.1): reduces a window
 * of `n` samples to at most `bins` min/max PAIRS so fast edges and spikes
 * survive zoom-out (a plain min+max envelope would hide which came first).
 *
 * Emission order keeps x strictly increasing, which uPlot requires: within a
 * bin the min is stamped at the bin's start x and the max at the bin's
 * midpoint x (both derive from `x0 + k·dt`, no per-point x array needed).
 *
 * Worker-safe: pure typed-array math, no DOM/React/Node imports. Runs either
 * in the decimation worker (`decimate.worker.ts`) or inline as the fallback
 * (`decimator.ts`); the perf gate (§10) is asserted in `decimate.test.ts`.
 */

/**
 * Decimate `src[i0…i1)` (sample k has axis value `x0 + (i0 + k)·dt`) into
 * min/max pairs. Writes interleaved [x, y, x, y, …] into `outX`/`outY`
 * (capacity ≥ 2·bins each) and returns the number of points written.
 * NaN samples are skipped; an all-NaN bin emits nothing.
 */
export function decimatePairs(
  src: ArrayLike<number>,
  i0: number,
  i1: number,
  x0: number,
  dt: number,
  bins: number,
  outX: Float64Array,
  outY: Float64Array,
): number {
  const n = i1 - i0;
  if (n <= 0 || bins < 1 || outX.length < bins * 2 || outY.length < bins * 2) {
    return 0;
  }
  const per = n / bins;
  let w = 0;
  for (let b = 0; b < bins; b++) {
    const lo = i0 + Math.floor(b * per);
    const hi = Math.min(i1, i0 + Math.max(lo + 1 - i0, Math.floor((b + 1) * per)));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let k = lo; k < hi; k++) {
      const v = src[k];
      if (v === undefined || Number.isNaN(v)) {
        continue;
      }
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) {
      continue;
    }
    const binX0 = x0 + lo * dt;
    const binXm = x0 + (lo + (hi - lo) / 2) * dt;
    if (min <= max) {
      outX[w] = binX0;
      outY[w] = min;
      w += 1;
      if (max !== min) {
        outX[w] = binXm;
        outY[w] = max;
        w += 1;
      }
    } else {
      outX[w] = binX0;
      outY[w] = max;
      w += 1;
    }
  }
  return w;
}

/** Copy a contiguous source window into `out` (chronological), skip NaN? No —
 * verbatim copy for the raw (non-decimated) path. Returns samples written. */
export function copyWindow(
  src: ArrayLike<number>,
  i0: number,
  i1: number,
  out: Float64Array,
): number {
  const n = Math.min(i1 - i0, out.length);
  for (let k = 0; k < n; k++) {
    const v = src[i0 + k];
    out[k] = v === undefined ? Number.NaN : v;
  }
  return n;
}

// ─── aligned frame decimation (scope pipeline) ───────────────────────────────

/**
 * X slots of the aligned min/max grid: ALWAYS 2·bins points, x strictly
 * increasing (bin start, bin midpoint). Shared by every channel of a frame
 * so uPlot's aligned-data contract holds across channels.
 */
export function alignedBinX(
  x0: number,
  dt: number,
  n: number,
  bins: number,
  outX: Float64Array,
): number {
  if (n <= 0 || bins < 1 || outX.length < bins * 2) {
    return 0;
  }
  const per = n / bins;
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor(b * per);
    const hi = Math.min(n, Math.max(lo + 1, Math.floor((b + 1) * per)));
    outX[b * 2] = x0 + lo * dt;
    outX[b * 2 + 1] = x0 + (lo + (hi - lo) / 2) * dt;
  }
  return bins * 2;
}

/**
 * Aligned min/max decimation of ONE channel into the shared x grid:
 * writes 2·bins y values (min slot, max slot per bin); NaN when the bin has
 * no valid samples. Pairing min→bin-start / max→bin-midpoint preserves spike
 * shape (which extreme came first is approximated by slot order).
 */
export function decimateAlignedY(
  src: ArrayLike<number>,
  i0: number,
  i1: number,
  bins: number,
  outY: Float64Array,
): void {
  const n = i1 - i0;
  if (bins < 1 || n <= 0 || outY.length < bins * 2) {
    return;
  }
  const per = n / bins;
  for (let b = 0; b < bins; b++) {
    const lo = i0 + Math.floor(b * per);
    const hi = Math.min(i1, i0 + Math.max(lo + 1 - i0, Math.floor((b + 1) * per)));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let k = lo; k < hi; k++) {
      const v = src[k];
      if (v === undefined || Number.isNaN(v)) {
        continue;
      }
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Number.POSITIVE_INFINITY) {
      outY[b * 2] = Number.NaN;
      outY[b * 2 + 1] = Number.NaN;
    } else {
      outY[b * 2] = min;
      outY[b * 2 + 1] = max;
    }
  }
}
