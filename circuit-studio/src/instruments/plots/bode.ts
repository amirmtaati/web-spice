/**
 * Bode analysis (UX3-T6, UI-UX-SPEC §6.7.2): −3 dB corner, 0 dB crossover,
 * gain margin, phase margin — pure functions over an AC run's magnitude (dB)
 * and phase (deg) columns on an ascending frequency axis (log or lin).
 *
 * All crossing detections interpolate on the working axis (log10 f for the
 * standard Bode geometry) so markers land between grid points.
 */

export interface BodeFeatures {
  /** −3 dB corner (Hz) relative to the band peak; null when never crossed. */
  readonly minus3dB: number | null;
  /** 0 dB (unity-gain) crossover (Hz); null when |H| never crosses 0 dB. */
  readonly crossover: number | null;
  /** Gain margin (dB) at the −180° phase crossing; null when no crossing (infinite margin). */
  readonly gainMargin: number | null;
  /** Phase margin (deg) at the 0 dB crossover; null when no crossover. */
  readonly phaseMargin: number | null;
  /** Peak magnitude (dB) in the band and its frequency. */
  readonly peakDb: number;
  readonly peakFreq: number;
}

function interpX(x0: number, x1: number, y0: number, y1: number, yLevel: number): number {
  const d = y1 - y0;
  if (d === 0) {
    return x0;
  }
  return x0 + ((yLevel - y0) / d) * (x1 - x0);
}

/**
 * First downward crossing of `level` scanning ascending x (null if none).
 * "Downward" = from above to at-or-below.
 */
function firstDownwardCrossing(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  level: number,
): number | null {
  let prevAbove = false;
  let started = false;
  for (let i = 1; i < x.length; i++) {
    const v = y[i];
    const p = y[i - 1];
    if (v === undefined || p === undefined || Number.isNaN(v) || Number.isNaN(p)) {
      continue;
    }
    if (!started) {
      if (p > level) {
        prevAbove = true;
        started = true;
      } else if (v > level) {
        prevAbove = false;
        started = true;
        continue;
      } else {
        continue;
      }
    }
    if (prevAbove && v <= level) {
      const xa = x[i - 1] ?? Number.NaN;
      const xb = x[i] ?? Number.NaN;
      return interpX(xa, xb, p, v, level);
    }
    prevAbove = v > level;
  }
  return null;
}

/** First crossing of `level` in either direction, ascending x. */
function firstCrossing(x: ArrayLike<number>, y: ArrayLike<number>, level: number): number | null {
  for (let i = 1; i < x.length; i++) {
    const v = y[i];
    const p = y[i - 1];
    if (v === undefined || p === undefined || Number.isNaN(v) || Number.isNaN(p)) {
      continue;
    }
    if ((p < level && v >= level) || (p > level && v <= level)) {
      const xa = x[i - 1] ?? Number.NaN;
      const xb = x[i] ?? Number.NaN;
      return interpX(xa, xb, p, v, level);
    }
  }
  return null;
}

/** Signal value at `xTarget` via linear interpolation (NaN outside the axis). */
export function valueAt(x: ArrayLike<number>, y: ArrayLike<number>, xTarget: number): number {
  if (x.length === 0) {
    return Number.NaN;
  }
  for (let i = 1; i < x.length; i++) {
    const xa = x[i - 1] ?? Number.NaN;
    const xb = x[i] ?? Number.NaN;
    if (xTarget >= xa && xTarget <= xb) {
      const ya = y[i - 1] ?? Number.NaN;
      const yb = y[i] ?? Number.NaN;
      const d = xb - xa;
      if (d === 0) {
        return ya;
      }
      return ya + ((xTarget - xa) / d) * (yb - ya);
    }
  }
  return Number.NaN;
}

/**
 * Extract Bode features. `f` ascending (Hz, log or lin), `magDb` same
 * length, `phaseDeg` same length (may be shorter/undefined → margins null).
 */
export function bodeFeatures(
  f: ArrayLike<number>,
  magDb: ArrayLike<number>,
  phaseDeg?: ArrayLike<number>,
): BodeFeatures {
  let peakDb = Number.NEGATIVE_INFINITY;
  let peakFreq = Number.NaN;
  for (let i = 0; i < magDb.length; i++) {
    const v = magDb[i];
    if (v === undefined || Number.isNaN(v)) {
      continue;
    }
    if (v > peakDb) {
      peakDb = v;
      peakFreq = f[i] ?? Number.NaN;
    }
  }
  const minus3dB = Number.isFinite(peakDb) ? firstDownwardCrossing(f, magDb, peakDb - 3) : null;
  const crossover = firstCrossing(f, magDb, 0);
  let phaseMargin: number | null = null;
  if (crossover !== null && phaseDeg !== undefined) {
    const ph = valueAt(f, phaseDeg, crossover);
    if (Number.isFinite(ph)) {
      phaseMargin = ph + 180;
    }
  }
  let gainMargin: number | null = null;
  if (phaseDeg !== undefined) {
    const f180 = firstCrossing(f, phaseDeg, -180);
    if (f180 !== null) {
      const mag = valueAt(f, magDb, f180);
      if (Number.isFinite(mag)) {
        gainMargin = -mag;
      }
    }
  }
  return {
    minus3dB,
    crossover,
    gainMargin,
    phaseMargin,
    peakDb,
    peakFreq,
  };
}

/**
 * Build magnitude/phase columns for an AC run from engine aliases
 * (AGENTS.md: `vm(out)`/`vp(out)`/`vdb(out)`; `im(v1)` for currents).
 * Prefers engine `vdb` when present, else 20·log10(vm).
 */
export function magDbFrom(name: string, values: ArrayLike<number>): Float64Array | null {
  if (name.startsWith("vdb(") || name.startsWith("idb(")) {
    return Float64Array.from(values);
  }
  if (name.startsWith("vm(") || name.startsWith("im(")) {
    const out = new Float64Array(values.length);
    for (let i = 0; i < out.length; i++) {
      const v = values[i];
      out[i] = v === undefined || v <= 0 ? Number.NaN : 20 * Math.log10(v);
    }
    return out;
  }
  return null;
}

export function phaseFrom(name: string, values: ArrayLike<number>): Float64Array | null {
  if (name.startsWith("vp(") || name.startsWith("ip(")) {
    return Float64Array.from(values);
  }
  return null;
}
