/**
 * `.measure` evaluation (E3, "basic .measure"): post-processing over a
 * finished RunResult. Modes (ngspice-compatible subset):
 *
 *   FIND <expr> AT=<x>                          — interpolated value at x
 *   FIND <expr> WHEN <expr2>=<v> [RISE|FALL|CROSS[=n]] — axis at n-th crossing
 *   MAX|MIN <expr> [FROM=<a>] [TO=<b>]          — extreme value in the window
 *   AVG|RMS <expr> [FROM=<a>] [TO=<b>]          — sample mean / root-mean-square
 *   PP <expr> [FROM=<a>] [TO=<b>]               — peak-to-peak
 *   INTEG <expr> [FROM=<a>] [TO=<b>]            — trapezoid ∫expr d(axis)
 *
 * Signal references resolve case-insensitively; on AC results a plain
 * "v(out)" maps to the magnitude series vm(out) (probe-alias semantics).
 * Unmatched conditions report found=false with value NaN.
 */

import type { MeasureResult, MeasureSpec } from "@spicekit/protocol";

import type { RunResult } from "./result.ts";

export function applyMeasures(result: RunResult, specs: MeasureSpec[] | undefined): RunResult {
  if (specs === undefined || specs.length === 0) {
    return result;
  }
  const mine = specs.filter((s) => s.analysis === result.kind);
  if (mine.length === 0) {
    return result;
  }
  const measures: MeasureResult[] = mine.map((spec) => evaluate(spec, result));
  return { ...result, measures };
}

function evaluate(spec: MeasureSpec, result: RunResult): MeasureResult {
  try {
    const axis = result.axis;
    const values = lookupSignal(result, spec.expr);
    if (values === undefined) {
      return { name: spec.name, value: Number.NaN, found: false };
    }
    switch (spec.mode) {
      case "find":
        return findMeasure(spec, axis, values, result);
      case "max":
      case "min":
      case "avg":
      case "rms":
      case "pp":
      case "integ":
        return windowMeasure(spec, axis, values);
    }
  } catch {
    return { name: spec.name, value: Number.NaN, found: false };
  }
}

/** Signal lookup with AC probe-alias fallback (v(x) → vm(x)). */
function lookupSignal(result: RunResult, ref: string): Float64Array | undefined {
  const lower = ref.toLowerCase();
  const direct = result.signals.find((s) => s.name === lower);
  if (direct !== undefined) {
    return direct.values;
  }
  const m = /^v\((.+)\)$/.exec(lower);
  if (m !== null) {
    const mag = result.signals.find((s) => s.name === `vm(${m[1] as string})`);
    if (mag !== undefined) {
      return mag.values;
    }
  }
  const mi = /^i\((.+)\)$/.exec(lower);
  if (mi !== null) {
    const mag = result.signals.find((s) => s.name === `im(${mi[1] as string})`);
    if (mag !== undefined) {
      return mag.values;
    }
  }
  return undefined;
}

/** Window [from, to] clamped to the axis; defaults to the whole range. */
function windowIndices(
  axis: Float64Array,
  from: number | undefined,
  to: number | undefined,
): [number, number] {
  const n = axis.length;
  let lo = 0;
  let hi = n - 1;
  if (from !== undefined) {
    while (lo < n && (axis[lo] as number) < from) {
      lo += 1;
    }
  }
  if (to !== undefined) {
    hi = lo;
    while (hi < n && (axis[hi] as number) <= to) {
      hi += 1;
    }
    hi -= 1;
  }
  return [lo, Math.max(hi, lo)];
}

function interpolate(axis: Float64Array, values: Float64Array, x: number): number {
  const n = axis.length;
  if (n === 0) {
    return Number.NaN;
  }
  if (x <= (axis[0] as number)) {
    return values[0] as number;
  }
  if (x >= (axis[n - 1] as number)) {
    return values[n - 1] as number;
  }
  for (let k = 1; k < n; k++) {
    const x1 = axis[k - 1] as number;
    const x2 = axis[k] as number;
    if (x <= x2) {
      const y1 = values[k - 1] as number;
      const y2 = values[k] as number;
      return x2 === x1 ? y1 : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
    }
  }
  return values[n - 1] as number;
}

function findMeasure(
  spec: MeasureSpec,
  axis: Float64Array,
  values: Float64Array,
  result: RunResult,
): MeasureResult {
  if (spec.when === undefined) {
    if (spec.at === undefined) {
      return { name: spec.name, value: Number.NaN, found: false };
    }
    return { name: spec.name, value: interpolate(axis, values, spec.at), found: true };
  }
  // WHEN: n-th crossing of (values − target) with the requested edge.
  const when = spec.when;
  const target = when.value;
  const wValues = lookupSignal(result, when.expr) ?? values;
  const [lo, hi] = windowIndices(axis, spec.from, spec.to);
  let crossings = 0;
  for (let k = lo + 1; k <= hi; k++) {
    const a = (wValues[k - 1] as number) - target;
    const b = (wValues[k] as number) - target;
    if (a === b || !Number.isFinite(a) || !Number.isFinite(b)) {
      continue;
    }
    const rising = a < 0 && b >= 0;
    const falling = a > 0 && b <= 0;
    const isCross = rising || falling;
    const matched = when.edge === "cross" ? isCross : when.edge === "rise" ? rising : falling;
    if (!matched) {
      continue;
    }
    crossings += 1;
    if (crossings === when.count) {
      // The measured value is the axis location (time/frequency) of the
      // n-th crossing, linearly interpolated within the bracketing interval.
      const x1 = axis[k - 1] as number;
      const x2 = axis[k] as number;
      const t = a === b ? 0 : a / (a - b);
      return { name: spec.name, value: x1 + t * (x2 - x1), found: true };
    }
  }
  return { name: spec.name, value: Number.NaN, found: false };
}

function windowMeasure(spec: MeasureSpec, axis: Float64Array, values: Float64Array): MeasureResult {
  const [lo, hi] = windowIndices(axis, spec.from, spec.to);
  if (hi < lo) {
    return { name: spec.name, value: Number.NaN, found: false };
  }
  let sum = 0;
  let sq = 0;
  let min = values[lo] as number;
  let max = min;
  let integral = 0;
  for (let k = lo; k <= hi; k++) {
    const v = values[k] as number;
    sum += v;
    sq += v * v;
    if (v > max) {
      max = v;
    }
    if (v < min) {
      min = v;
    }
    if (k > lo) {
      integral +=
        0.5 * (v + (values[k - 1] as number)) * ((axis[k] as number) - (axis[k - 1] as number));
    }
  }
  const count = hi - lo + 1;
  switch (spec.mode) {
    case "max":
      return { name: spec.name, value: max, found: true };
    case "min":
      return { name: spec.name, value: min, found: true };
    case "avg":
      return { name: spec.name, value: sum / count, found: true };
    case "rms":
      return { name: spec.name, value: Math.sqrt(sq / count), found: true };
    case "pp":
      return { name: spec.name, value: max - min, found: true };
    case "integ":
      return { name: spec.name, value: integral, found: true };
    default:
      return { name: spec.name, value: Number.NaN, found: false };
  }
}
