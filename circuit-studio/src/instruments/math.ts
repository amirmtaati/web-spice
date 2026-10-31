/**
 * Scope math channels (UX3-T5, UI-UX-SPEC §6.7.1): A±B, A×B, ∫A dt, dA/dt —
 * pure transforms over aligned sample windows (resultStore guarantees one
 * shared grid, AGENTS.md §5.1). Custom expressions go through the engine's
 * `evaluate` at cursor/last-sample context (see `custom-eval.ts` — the
 * engine is per-point, not per-sample, by contract AGENTS.md §6.3).
 *
 * Allocation discipline: each transform writes into a caller-provided
 * `Float64Array` and returns the count (frame path may call this every
 * frame while a math channel is visible).
 */

export type MathOp =
  | { readonly kind: "add"; readonly a: string; readonly b: string }
  | { readonly kind: "sub"; readonly a: string; readonly b: string }
  | { readonly kind: "mul"; readonly a: string; readonly b: string }
  | { readonly kind: "int"; readonly a: string }
  | { readonly kind: "deriv"; readonly a: string };

export function describeMathOp(op: MathOp): string {
  switch (op.kind) {
    case "add":
      return `${op.a}+${op.b}`;
    case "sub":
      return `${op.a}−${op.b}`;
    case "mul":
      return `${op.a}·${op.b}`;
    case "int":
      return `∫${op.a}dt`;
    case "deriv":
      return `d${op.a}/dt`;
  }
}

/** Elementwise binary ops. `b` may be shorter — missing samples are NaN. */
function binary(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  f: (x: number, y: number) => number,
  out: Float64Array,
): number {
  const n = Math.min(a.length, out.length);
  for (let k = 0; k < n; k++) {
    const x = a[k];
    const y = b[k];
    out[k] = x === undefined || y === undefined ? Number.NaN : f(x, y);
  }
  return n;
}

/**
 * Trapezoidal running integral over the window; the first valid sample is
 * the integration origin (integral = 0 there). NaN gaps break the run and
 * re-zero at the next valid sample (documented: integral of the visible
 * window, units = signal·axis).
 */
export function integral(a: ArrayLike<number>, dt: number, out: Float64Array): number {
  const n = Math.min(a.length, out.length);
  let acc = 0;
  let prev = Number.NaN;
  for (let k = 0; k < n; k++) {
    const v = a[k];
    if (v === undefined || Number.isNaN(v)) {
      out[k] = Number.NaN;
      prev = Number.NaN;
      continue;
    }
    if (Number.isNaN(prev)) {
      // Integration origin: trapezoid has no area before the first sample.
      out[k] = 0;
      prev = v;
      continue;
    }
    acc += ((prev + v) / 2) * dt;
    prev = v;
    out[k] = acc;
  }
  return n;
}

/** Central-difference derivative (forward at the start, backward at the
 * end). Units: V/s. NaN input propagates as NaN. */
export function derivative(a: ArrayLike<number>, dt: number, out: Float64Array): number {
  const n = Math.min(a.length, out.length);
  if (dt <= 0) {
    out.fill(Number.NaN, 0, n);
    return n;
  }
  for (let k = 0; k < n; k++) {
    const vm = k > 0 ? a[k - 1] : undefined;
    const v0 = a[k];
    const vp = k + 1 < a.length ? a[k + 1] : undefined;
    if (v0 === undefined) {
      out[k] = Number.NaN;
      continue;
    }
    if (
      vp !== undefined &&
      !Number.isNaN(v0) &&
      !Number.isNaN(vp) &&
      (k === 0 || vm === undefined)
    ) {
      out[k] = (vp - v0) / dt; // forward at the first sample
      continue;
    }
    if (vm !== undefined && vp !== undefined && !Number.isNaN(vm) && !Number.isNaN(vp)) {
      out[k] = (vp - vm) / (2 * dt); // central
      continue;
    }
    if (vm !== undefined && !Number.isNaN(vm) && !Number.isNaN(v0)) {
      out[k] = (v0 - vm) / dt; // backward at the last sample
      continue;
    }
    out[k] = Number.NaN;
  }
  return n;
}

/** Dispatch a math op over window buffers; returns samples written. */
export function applyMath(
  op: MathOp,
  get: (name: string) => ArrayLike<number> | undefined,
  dt: number,
  out: Float64Array,
): number {
  const a = get(op.a);
  if (a === undefined) {
    return 0;
  }
  switch (op.kind) {
    case "add":
    case "sub":
    case "mul": {
      const b = get(op.b);
      if (b === undefined) {
        return 0;
      }
      const f =
        op.kind === "add"
          ? (x: number, y: number) => x + y
          : op.kind === "sub"
            ? (x: number, y: number) => x - y
            : (x: number, y: number) => x * y;
      return binary(a, b, f, out);
    }
    case "int":
      return integral(a, dt, out);
    case "deriv":
      return derivative(a, dt, out);
  }
}
