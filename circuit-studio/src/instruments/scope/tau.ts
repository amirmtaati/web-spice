/**
 * "Estimate τ from cursor" (UX3-T7, UI-UX-SPEC §6.7.4): least-squares
 * exponential fit over the X1…X2 cursor span of any first-order response —
 * rising (`v = V∞ − A·e^{−t/τ}`) or decaying (`v = V∞ + A·e^{−t/τ}`).
 *
 * Method (variable projection): for a candidate τ the model
 * `v = C + B·e^{−(t−t₀)/τ}` is LINEAR in (C, B) — solve the 2×2 normal
 * equations exactly, then minimize the SSE over ln τ with golden-section
 * search. This avoids the asymptote bias of naive log-linearization on
 * truncated windows (the fit stays honest even when the span only covers
 * part of the transient).
 *
 * Honesty rule (§6.7.4): the fit reports R²; when the window is not a clean
 * first-order exponential (R² < 0.99) the result is flagged
 * `firstOrder: false` and the UI says so instead of showing a number.
 */

export interface TauFit {
  readonly tau: number;
  /** Time at the fit window start (the model's t₀). */
  readonly t0: number;
  /** Fitted asymptote V∞. */
  readonly vInfinity: number;
  /** Fitted amplitude (B): negative when rising toward V∞. */
  readonly amplitude: number;
  readonly r2: number;
  readonly firstOrder: boolean;
  readonly direction: "rise" | "decay";
  readonly samples: number;
}

const R2_GATE = 0.99;
/** A fit whose exponential component is < 5 % of the span is degenerate. */
const MIN_AMPLITUDE_FRACTION = 0.05;
/** ln τ search bracket, relative to the window span. */
const TAU_MIN_SPANS = 1e-4;
const TAU_MAX_SPANS = 1e3;
const GOLDEN_ITERS = 70;

/** SSE of the best linear (C, B) for v = C + B·E, E = e^{−(t−t₀)/τ}. */
function sseAt(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  t0: number,
  tau: number,
): { sse: number; n: number; sst: number; c: number; b: number } {
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t1 = 0;
  let t2 = 0;
  let n = 0;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    const t = axis[i];
    if (v === undefined || t === undefined || Number.isNaN(v) || Number.isNaN(t)) {
      continue;
    }
    const e = Math.exp(-(t - t0) / tau);
    s11 += 1;
    s12 += e;
    s22 += e * e;
    t1 += v;
    t2 += v * e;
    n += 1;
  }
  const det = s11 * s22 - s12 * s12;
  if (n < 8 || det === 0 || !Number.isFinite(det)) {
    return { sse: Number.POSITIVE_INFINITY, n, sst: 0, c: Number.NaN, b: Number.NaN };
  }
  const c = (t1 * s22 - t2 * s12) / det;
  const b = (s11 * t2 - s12 * t1) / det;
  let sse = 0;
  let sst = 0;
  const mean = t1 / n;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    const t = axis[i];
    if (v === undefined || t === undefined || Number.isNaN(v) || Number.isNaN(t)) {
      continue;
    }
    const e = Math.exp(-(t - t0) / tau);
    const r = v - c - b * e;
    sse += r * r;
    sst += (v - mean) * (v - mean);
  }
  return { sse, n, sst, c, b };
}

export function fitTau(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
): TauFit | null {
  if (i1 - i0 < 8) {
    return null;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let t0 = Number.NaN;
  let tEnd = Number.NaN;
  for (let i = i0; i < i1; i++) {
    const v = y[i];
    const t = axis[i];
    if (v === undefined || t === undefined || Number.isNaN(v) || Number.isNaN(t)) {
      continue;
    }
    if (Number.isNaN(t0)) {
      t0 = t;
    }
    tEnd = t;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || Number.isNaN(t0)) {
    return null;
  }
  const span = tEnd - t0;
  if (!(span > 0)) {
    return null;
  }
  // Golden-section search over ln τ (SSE is unimodal in ln τ for this model
  // family — verified against synthetic fixtures in tau.test.ts).
  const lnMin = Math.log(span * TAU_MIN_SPANS);
  const lnMax = Math.log(span * TAU_MAX_SPANS);
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lnMin;
  let b = lnMax;
  let sseA = sseAt(axis, y, i0, i1, t0, Math.exp(a)).sse;
  let sseB = sseAt(axis, y, i0, i1, t0, Math.exp(b)).sse;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let sseC = sseAt(axis, y, i0, i1, t0, Math.exp(c)).sse;
  let sseD = sseAt(axis, y, i0, i1, t0, Math.exp(d)).sse;
  for (let k = 0; k < GOLDEN_ITERS; k++) {
    if (sseC < sseD) {
      b = d;
      sseB = sseD;
      d = c;
      sseD = sseC;
      c = b - phi * (b - a);
      sseC = sseAt(axis, y, i0, i1, t0, Math.exp(c)).sse;
    } else {
      a = c;
      sseA = sseC;
      c = d;
      sseC = sseD;
      d = a + phi * (b - a);
      sseD = sseAt(axis, y, i0, i1, t0, Math.exp(d)).sse;
    }
    if (sseA === Number.POSITIVE_INFINITY && sseB === Number.POSITIVE_INFINITY) {
      return null;
    }
  }
  const tau = Math.exp((a + b) / 2);
  const fit = sseAt(axis, y, i0, i1, t0, tau);
  if (!Number.isFinite(fit.sse) || fit.sst <= 0) {
    return null;
  }
  const r2 = 1 - fit.sse / fit.sst;
  const dynamicSpan = Math.abs(fit.b) * (1 - Math.exp(-span / tau));
  if (!(dynamicSpan >= MIN_AMPLITUDE_FRACTION * (max - min))) {
    return null; // degenerate: no measurable exponential component
  }
  const direction: "rise" | "decay" = fit.b < 0 ? "rise" : "decay";
  return {
    tau,
    t0,
    vInfinity: fit.c,
    amplitude: fit.b,
    r2,
    firstOrder: r2 >= R2_GATE,
    direction,
    samples: fit.n,
  };
}

/**
 * τ from R_thevenin·C when the recipe declares it (§6.7.4: computed from the
 * OP solve / declared params; displayed with the marker).
 */
export function tauFromRC(r: number, c: number): number {
  return r * c;
}
