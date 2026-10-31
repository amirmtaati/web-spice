/**
 * Scope measurement suite (UX3-T4, UI-UX-SPEC §6.7.1). Pure functions over a
 * window of samples — no DOM, no React, allocation-light (readouts run in the
 * frame path at 4 Hz). All statistics are computed over the visible window
 * exactly as a bench scope would: mean-crossing frequency with hysteresis,
 * 10–90 % rise/fall averaged over edges, overshoot relative to the step.
 *
 * Numeric conventions (unit-tested against synthetic waveforms with exact
 * analytic values): `NaN` means "not measurable in this window" (e.g. fewer
 * than two crossings for frequency) — the legend renders "—".
 */

/** Basic amplitude statistics over `y[i0…i1)` (Vpp/Vmax/Vmin/Vavg/Vrms). */
export interface AmplitudeStats {
  readonly max: number;
  readonly min: number;
  readonly vpp: number;
  readonly avg: number;
  readonly rms: number;
}

export function amplitude(y: ArrayLike<number>, i0: number, i1: number): AmplitudeStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    if (v === undefined || Number.isNaN(v)) {
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
    n += 1;
  }
  if (n === 0) {
    return { max: Number.NaN, min: Number.NaN, vpp: Number.NaN, avg: Number.NaN, rms: Number.NaN };
  }
  return {
    max,
    min,
    vpp: max - min,
    avg: sum / n,
    rms: Math.sqrt(sumSq / n),
  };
}

/**
 * Linear interpolation of the crossing time of `level` between samples
 * `i − 1` and `i` (axis value at sample `i`). Requires a real crossing.
 */
function crossingTime(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i: number,
  level: number,
): number {
  const y1 = y[i - 1] ?? Number.NaN;
  const y0 = y[i] ?? Number.NaN;
  const denom = y0 - y1;
  if (!Number.isFinite(denom) || denom === 0) {
    return axis[i] ?? Number.NaN;
  }
  const frac = (level - y1) / denom;
  return (
    (axis[i - 1] ?? Number.NaN) + frac * ((axis[i] ?? Number.NaN) - (axis[i - 1] ?? Number.NaN))
  );
}

/** Edge state machine boundary — 10 % of Vpp above min by default. */
const HYST_FRACTION = 0.1;

/**
 * Mean-crossing edges with hysteresis (10 % of Vpp): a rising edge is
 * recorded when the signal leaves the low band and crosses the midpoint.
 * Returns interpolated mid-crossing times, ascending.
 */
function midCrossings(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  edge: "rise" | "fall",
): number[] {
  const stats = amplitude(y, i0, i1);
  if (!Number.isFinite(stats.vpp) || stats.vpp <= 0) {
    return [];
  }
  const mid = (stats.max + stats.min) / 2;
  const hyst = HYST_FRACTION * stats.vpp;
  const times: number[] = [];
  // state: -1 = low band, +1 = high band, 0 = undecided (inside hysteresis).
  let state = 0;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    if (v === undefined || Number.isNaN(v)) {
      continue;
    }
    if (state <= 0 && v > mid + hyst) {
      if (edge === "rise" && state === -1) {
        times.push(crossingTime(axis, y, i, mid));
      }
      state = 1;
    } else if (state >= 0 && v < mid - hyst) {
      if (edge === "fall" && state === 1) {
        times.push(crossingTime(axis, y, i, mid));
      }
      state = -1;
    }
  }
  return times;
}

/**
 * Frequency from mean-crossings (Hz). Needs ≥ 2 edges; uses the first and
 * last crossing so cycle-boundary effects cancel: f = (n−1)/(t_last−t_first).
 */
export function frequency(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): number {
  const times = midCrossings(axis, y, i0, i1, "rise");
  if (times.length < 2) {
    return Number.NaN;
  }
  const span = (times[times.length - 1] ?? Number.NaN) - (times[0] ?? Number.NaN);
  if (!(span > 0)) {
    return Number.NaN;
  }
  return (times.length - 1) / span;
}

/** Period (s) = 1/frequency; NaN when frequency is not measurable. */
export function period(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): number {
  const f = frequency(axis, y, i0, i1);
  return f > 0 ? 1 / f : Number.NaN;
}

/**
 * Duty cycle (%) — fraction of time above the midpoint measured between the
 * first and last rising crossing (whole cycles only).
 */
export function duty(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): number {
  const stats = amplitude(y, i0, i1);
  if (!Number.isFinite(stats.vpp) || stats.vpp <= 0) {
    return Number.NaN;
  }
  const mid = (stats.max + stats.min) / 2;
  const rises = midCrossings(axis, y, i0, i1, "rise");
  if (rises.length < 2) {
    return Number.NaN;
  }
  const t0 = rises[0] ?? Number.NaN;
  const t1 = rises[rises.length - 1] ?? Number.NaN;
  let above = 0;
  let total = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const ta = axis[i - 1];
    const tb = axis[i];
    const va = y[i - 1];
    const vb = y[i];
    if (ta === undefined || tb === undefined || va === undefined || vb === undefined) {
      continue;
    }
    if (tb <= t0 || ta >= t1) {
      continue;
    }
    // Segment ∩ [t0, t1] — clamp, then accumulate time above mid (linear).
    const lo = Math.max(ta, t0);
    const hi = Math.min(tb, t1);
    if (!(hi > lo)) {
      continue;
    }
    total += hi - lo;
    const vaAbove = va > mid;
    const vbAbove = vb > mid;
    if (vaAbove && vbAbove) {
      above += hi - lo;
    } else if (vaAbove !== vbAbove) {
      const denom = vb - va;
      const tcross = denom === 0 ? ta : ta + ((mid - va) / denom) * (tb - ta);
      const abovePart = vaAbove ? Math.min(hi, tcross) - lo : hi - Math.max(lo, tcross);
      above += Math.max(0, abovePart);
    }
  }
  if (!(total > 0)) {
    return Number.NaN;
  }
  return (above / total) * 100;
}

/** Average 10→90 % rise time (s) across rising edges; NaN without an edge. */
export function riseTime(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): number {
  return edgeTime(axis, y, i0, i1, "rise");
}

/** Average 90→10 % fall time (s) across falling edges; NaN without an edge. */
export function fallTime(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): number {
  return edgeTime(axis, y, i0, i1, "fall");
}

function edgeTime(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  edge: "rise" | "fall",
): number {
  const stats = amplitude(y, i0, i1);
  if (!Number.isFinite(stats.vpp) || stats.vpp <= 0) {
    return Number.NaN;
  }
  const { min, vpp } = stats;
  // 2 % re-arm hysteresis: the signal must RETURN near the base before the
  // next edge is counted (a bench scope's edge re-arm rule).
  const hyst = 0.02 * vpp;
  const l10 = min + 0.1 * vpp;
  const l90 = min + 0.9 * vpp;
  let sum = 0;
  let n = 0;
  let armed = false;
  let started = false;
  let tStart = Number.NaN;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    if (v === undefined || Number.isNaN(v)) {
      continue;
    }
    if (edge === "rise") {
      if (!armed) {
        if (v < l10 - hyst) {
          armed = true;
          started = false;
        }
        continue;
      }
      if (!started) {
        if (v >= l10) {
          tStart = crossingTime(axis, y, i, l10);
          started = true;
        }
        continue;
      }
      if (v >= l90) {
        const tEnd = crossingTime(axis, y, i, l90);
        if (Number.isFinite(tStart) && tEnd > tStart) {
          sum += tEnd - tStart;
          n += 1;
        }
        armed = false;
        started = false;
      }
    } else {
      // Fall: arm above the 90 % line, start crossing down through 90 %,
      // end crossing down through 10 %.
      if (!armed) {
        if (v > l90 + hyst) {
          armed = true;
          started = false;
        }
        continue;
      }
      if (!started) {
        if (v <= l90) {
          tStart = crossingTime(axis, y, i, l90);
          started = true;
        }
        continue;
      }
      if (v <= l10) {
        const tEnd = crossingTime(axis, y, i, l10);
        if (Number.isFinite(tStart) && tEnd > tStart) {
          sum += tEnd - tStart;
          n += 1;
        }
        armed = false;
        started = false;
      }
    }
  }
  return n > 0 ? sum / n : Number.NaN;
}

/**
 * Overshoot (%) of a step response: (peak − final)/|final − initial|·100.
 * `final` = mean of the last 5 % of the window, `initial` = mean of the
 * first 5 %. For monotone steps this is ≈ 0; the RLC experiment expects a
 * known positive value (§6.7.4).
 */
export function overshoot(y: ArrayLike<number>, i0: number, i1: number): number {
  const n = i1 - i0;
  if (n < 8) {
    return Number.NaN;
  }
  const tail = Math.max(1, Math.floor(n * 0.05));
  const headA = amplitude(y, i0, i0 + tail);
  const tailA = amplitude(y, i1 - tail, i1);
  const initial = headA.avg;
  const final = tailA.avg;
  const span = final - initial;
  if (!Number.isFinite(span) || Math.abs(span) < Number.EPSILON) {
    return Number.NaN;
  }
  const stats = amplitude(y, i0, i1);
  const peak = span > 0 ? stats.max : stats.min;
  return ((peak - final) / Math.abs(span)) * 100;
}

/** The full per-channel readout row (legend measurement column). */
export interface MeasurementRow {
  readonly vpp: number;
  readonly vmax: number;
  readonly vmin: number;
  readonly vavg: number;
  readonly vrms: number;
  readonly freq: number;
  readonly period: number;
  readonly duty: number;
  readonly rise: number;
  readonly fall: number;
  readonly overshoot: number;
}

export function measureAll(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): MeasurementRow {
  const a = amplitude(y, i0, i1);
  return {
    vpp: a.vpp,
    vmax: a.max,
    vmin: a.min,
    vavg: a.avg,
    vrms: a.rms,
    freq: frequency(axis, y, i0, i1),
    period: period(axis, y, i0, i1),
    duty: duty(axis, y, i0, i1),
    rise: riseTime(axis, y, i0, i1),
    fall: fallTime(axis, y, i0, i1),
    overshoot: overshoot(y, i0, i1),
  };
}
