/**
 * Spectrum analysis (UX3-T6, UI-UX-SPEC §6.7.1/§6.7 "spectrum"): iterative
 * radix-2 Cooley–Tukey FFT, taper windows, THD. Zero-dependency (same call
 * as ADR-003: our DSP is small, typed, and fully unit-tested against
 * analytic single-bin fixtures).
 *
 * The FFT is in-place over re/im parts; magnitudes come back as a half
 * spectrum (bins 0…N/2) normalized to amplitude (|X|·2/N, DC un-doubled).
 */

/** Zero-pad to the next power of two (radix-2 requirement). */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) {
    p *= 2;
  }
  return p;
}

/** In-place iterative radix-2 FFT (decimation in time). n = re.length = 2^k. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || re.length !== im.length) {
    throw new Error(`fftInPlace requires re/im of equal power-of-two length ≥ 2, got ${n}`);
  }
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      const ti = im[i] ?? 0;
      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = tr;
      im[j] = ti;
    }
  }
  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k] ?? 0;
        const ui = im[i + k] ?? 0;
        const vr = (re[i + k + len / 2] ?? 0) * cr - (im[i + k + len / 2] ?? 0) * ci;
        const vi = (re[i + k + len / 2] ?? 0) * ci + (im[i + k + len / 2] ?? 0) * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export type WindowFn = "rect" | "hann" | "hamming" | "blackman";

/** Taper window value at k of n (no precompute — applied on the fly). */
export function windowValue(fn: WindowFn, k: number, n: number): number {
  switch (fn) {
    case "rect":
      return 1;
    case "hann":
      return 0.5 * (1 - Math.cos((2 * Math.PI * k) / (n - 1)));
    case "hamming":
      return 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (n - 1));
    case "blackman":
      return (
        0.42 -
        0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) +
        0.08 * Math.cos((4 * Math.PI * k) / (n - 1))
      );
  }
}

/** One-sided amplitude spectrum of `samples` (uniform grid, spacing `dt`).
 * Zero-padded to a power of two; windowed with coherent-gain correction so
 * a full-scale sine reads its true amplitude at any window. */
export function spectrum(
  samples: ArrayLike<number>,
  dt: number,
  win: WindowFn = "hann",
): { freq: Float64Array; mag: Float64Array; binHz: number } {
  const n0 = samples.length;
  const n = Math.max(4, nextPow2(n0));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const v = k < n0 ? samples[k] : 0;
    if (v === undefined || Number.isNaN(v)) {
      continue;
    }
    re[k] = v * windowValue(win, k, n0);
  }
  const g = coherentGain(win, n0);
  fftInPlace(re, im);
  const half = n >> 1;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    // One-sided amplitude: DC and (even-length) Nyquist are un-doubled.
    const scale = k === 0 || (k === half && n % 2 === 0) ? n : n / 2;
    mag[k] = Math.hypot(re[k] ?? 0, im[k] ?? 0) / (scale * g);
  }
  const binHz = 1 / (n * dt);
  const freq = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    freq[k] = k * binHz;
  }
  return { freq, mag, binHz };
}

/** Mean window value over `n` samples (coherent-gain correction). */
function coherentGain(win: WindowFn, n: number): number {
  if (n < 2) {
    return 1;
  }
  let s = 0;
  for (let k = 0; k < n; k++) {
    s += windowValue(win, k, n);
  }
  return s / n;
}

/**
 * Total harmonic distortion (%) from a one-sided amplitude spectrum:
 * √(Σ V_h², h=2…H)/V₁·100 with H = 10 (scope convention). Returns NaN when
 * the fundamental is absent.
 */
export function thd(mag: ArrayLike<number>, fundamentalBin: number, harmonics = 10): number {
  const v1 = mag[fundamentalBin];
  if (v1 === undefined || !(v1 > 0)) {
    return Number.NaN;
  }
  let sumSq = 0;
  for (let h = 2; h <= harmonics; h++) {
    const bin = fundamentalBin * h;
    const v = mag[bin];
    if (v === undefined) {
      break;
    }
    sumSq += v * v;
  }
  return (Math.sqrt(sumSq) / v1) * 100;
}

/** Index of the largest spectral bin above `minBin` (fundamental search). */
export function peakBin(mag: ArrayLike<number>, minBin = 1): number {
  let best = -1;
  let bestV = 0;
  for (let k = minBin; k < mag.length; k++) {
    const v = mag[k] ?? 0;
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best;
}
