/**
 * Forward-mode automatic differentiation with dual numbers (SPEC §5.6:
 * "B-source derivatives by forward-mode automatic differentiation (dual
 * numbers)"). A dual is (value, gradient vector) where gradient[k] is ∂/∂x_k
 * for one of the expression's operands (v(node)/i(element) accesses, in
 * first-sight order). Arithmetic follows the chain rule:
 *
 *   (a, a′) + (b, b′) = (a + b, a′ + b′)
 *   (a, a′) · (b, b′) = (a·b, a′·b + a·b′)
 *   f((a, a′))        = (f(a), f′(a)·a′)
 *
 * Small `Float64Array` allocations per operation are accepted here: B-source
 * expressions are tiny (a handful of operands), and evaluation happens a few
 * times per Newton iteration — unlike the solver, which is strictly
 * allocation-free (SPEC §5.11). All transcendental values route through
 * `core/math` (SPEC §5.10).
 */

import * as m from "../math/index.ts";
import { ExpressionError } from "./tokenizer.ts";

/** Dual number: value plus partial derivatives w.r.t. every operand. */
export interface Dual {
  readonly value: number;
  readonly grads: Float64Array;
}

/** Evaluation context whose v()/i() return duals with seeded gradients. */
export interface DualEvalContext {
  readonly time: number;
  readonly tempC: number;
  /** Node voltage as a dual with gradient 1 in `slot` (others 0). */
  v(node: string, slot: number): Dual;
  /** Element current as a dual with gradient 1 in `slot` (others 0). */
  i(element: string, slot: number): Dual;
  /** Named parameter as a constant dual (no dependence on the operands). */
  param(name: string): Dual;
}

/** Compile-time description of one expression operand. */
export interface DualOperand {
  kind: "v" | "i";
  name: string;
  /** Gradient slot assigned in first-sight order. */
  slot: number;
}

export interface CompiledDualExpression {
  fn: (ctx: DualEvalContext) => Dual;
  /** Distinct v()/i() operands in first-sight order. */
  operands: DualOperand[];
  /** Number of gradient slots (operands; constants/params take none). */
  readonly nSlots: number;
}

// ─── Dual arithmetic primitives ──────────────────────────────────────────────

export function constDual(nSlots: number, value: number): Dual {
  return { value, grads: new Float64Array(nSlots) };
}

export function dualAdd(a: Dual, b: Dual): Dual {
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = (a.grads[k] as number) + (b.grads[k] as number);
  }
  return { value: a.value + b.value, grads };
}

export function dualSub(a: Dual, b: Dual): Dual {
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = (a.grads[k] as number) - (b.grads[k] as number);
  }
  return { value: a.value - b.value, grads };
}

export function dualNeg(a: Dual): Dual {
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = -(a.grads[k] as number);
  }
  return { value: -a.value, grads };
}

export function dualMul(a: Dual, b: Dual): Dual {
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = (a.grads[k] as number) * b.value + a.value * (b.grads[k] as number);
  }
  return { value: a.value * b.value, grads };
}

export function dualDiv(a: Dual, b: Dual): Dual {
  const inv = 1 / b.value;
  const v = a.value * inv;
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = ((a.grads[k] as number) - v * (b.grads[k] as number)) * inv;
  }
  return { value: v, grads };
}

export function dualMod(a: Dual, b: Dual): Dual {
  const q = Math.trunc(a.value / b.value);
  // d(a mod b)/dx ≈ da (the truncation's derivative is 0 a.e.); b's
  // dependence stays implicit, matching ngspice's treatment.
  const grads = new Float64Array(a.grads.length);
  for (let k = 0; k < grads.length; k++) {
    grads[k] = a.grads[k] as number;
  }
  return { value: a.value - q * b.value, grads };
}

export function dualPow(a: Dual, b: Dual): Dual {
  const v = a.value ** b.value;
  const grads = new Float64Array(a.grads.length);
  if (a.value > 0) {
    // dv = v·(b·da/a + ln(a)·db)
    for (let k = 0; k < grads.length; k++) {
      grads[k] =
        v * ((b.value * (a.grads[k] as number)) / a.value + m.ln(a.value) * (b.grads[k] as number));
    }
  } else if (a.value < 0 && Number.isInteger(b.value)) {
    // dv = b·a^(b−1)·da (real power with an integer exponent)
    for (let k = 0; k < grads.length; k++) {
      grads[k] = b.value * a.value ** (b.value - 1) * (a.grads[k] as number);
    }
  }
  // a = 0 (or negative base with non-integer exponent): gradient 0 or NaN
  // value — matching the real-valued semantics.
  return { value: v, grads };
}

// ─── Builtin function derivative table ──────────────────────────────────────

/** Uniform builtin shape: fn(nSlots, ...args) → Dual (table: args array). */
export interface DualBuiltin1 {
  arity: 1;
  fn: (n: number, x: Dual) => Dual;
}
export interface DualBuiltin2 {
  arity: 2;
  fn: (n: number, a: Dual, b: Dual) => Dual;
}
export interface DualBuiltin3 {
  arity: 3;
  fn: (n: number, a: Dual, b: Dual, c: Dual) => Dual;
}
export interface DualBuiltinVariadic {
  arity: "variadic";
  minArgs: number;
  maxArgs: number;
  fn: (n: number, args: Dual[]) => Dual;
}
export interface DualBuiltinTable {
  arity: "table";
}

export type DualBuiltin =
  | DualBuiltin1
  | DualBuiltin2
  | DualBuiltin3
  | DualBuiltinVariadic
  | DualBuiltinTable;

function chain1(f: (x: number) => number, df: (x: number) => number) {
  return (n: number, x: Dual): Dual => {
    const v = f(x.value);
    const grads = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      grads[k] = df(x.value) * (x.grads[k] as number);
    }
    return { value: v, grads };
  };
}

function constOut(f: (x: number) => number) {
  return (n: number, x: Dual): Dual => constDual(n, f(x.value));
}

export const DUAL_FUNCTIONS: Readonly<Record<string, DualBuiltin>> = {
  sin: { arity: 1, fn: chain1(m.sin, m.cos) },
  cos: { arity: 1, fn: chain1(m.cos, (x) => -m.sin(x)) },
  tan: { arity: 1, fn: chain1(m.tan, (x) => 1 + m.tan(x) ** 2) },
  asin: { arity: 1, fn: chain1(m.asin, (x) => 1 / m.sqrt(1 - x * x)) },
  acos: { arity: 1, fn: chain1(m.acos, (x) => -1 / m.sqrt(1 - x * x)) },
  atan: { arity: 1, fn: chain1(m.atan, (x) => 1 / (1 + x * x)) },
  atan2: {
    arity: 2,
    fn: (n, a, b) => {
      const v = m.atan2(a.value, b.value);
      const d = 1 / (a.value * a.value + b.value * b.value);
      const grads = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        grads[k] = d * (b.value * (a.grads[k] as number) - a.value * (b.grads[k] as number));
      }
      return { value: v, grads };
    },
  },
  sinh: { arity: 1, fn: chain1(m.sinh, m.cosh) },
  cosh: { arity: 1, fn: chain1(m.cosh, m.sinh) },
  tanh: { arity: 1, fn: chain1(m.tanh, (x) => 1 - m.tanh(x) ** 2) },
  exp: { arity: 1, fn: chain1(m.exp, m.exp) },
  ln: { arity: 1, fn: chain1(m.ln, (x) => 1 / x) },
  log: { arity: 1, fn: chain1(m.log, (x) => 1 / x) },
  log10: { arity: 1, fn: chain1(m.log10, (x) => 1 / (x * Math.LN10)) },
  sqrt: { arity: 1, fn: chain1(m.sqrt, (x) => 1 / (2 * m.sqrt(x))) },
  abs: { arity: 1, fn: chain1(m.abs, m.sgn) },
  pow: { arity: 2, fn: (_n, a, b) => dualPow(a, b) },
  floor: { arity: 1, fn: constOut(m.floor) },
  ceil: { arity: 1, fn: constOut(m.ceil) },
  int: { arity: 1, fn: constOut(m.int) },
  sgn: { arity: 1, fn: constOut(m.sgn) },
  u: { arity: 1, fn: constOut(m.u) },
  uramp: {
    arity: 1,
    fn: (n, x) => {
      const v = m.uramp(x.value);
      const grads = new Float64Array(n);
      if (x.value > 0) {
        for (let k = 0; k < n; k++) {
          grads[k] = x.grads[k] as number;
        }
      }
      return { value: v, grads };
    },
  },
  min: {
    arity: "variadic",
    minArgs: 1,
    maxArgs: 16,
    fn: (_n, args: Dual[]): Dual => {
      let best = 0;
      for (let i = 1; i < args.length; i++) {
        if ((args[i] as Dual).value < (args[best] as Dual).value) {
          best = i;
        }
      }
      return args[best] as Dual;
    },
  },
  max: {
    arity: "variadic",
    minArgs: 1,
    maxArgs: 16,
    fn: (_n, args: Dual[]): Dual => {
      let best = 0;
      for (let i = 1; i < args.length; i++) {
        if ((args[i] as Dual).value > (args[best] as Dual).value) {
          best = i;
        }
      }
      return args[best] as Dual;
    },
  },
  limit: {
    arity: 3,
    fn: (n, x, lo, hi) => {
      const v = m.limit(x.value, lo.value, hi.value);
      // In range: dx; clamped at either rail: the rail is fixed → 0.
      const grads = new Float64Array(n);
      if (v === x.value) {
        for (let k = 0; k < n; k++) {
          grads[k] = x.grads[k] as number;
        }
      }
      return { value: v, grads };
    },
  },
  if: {
    arity: 3,
    fn: (_n, c, t, e) => (c.value !== 0 ? t : e),
  },
  table: { arity: "table" },
};

/** Dual form of table(x, x1, y1, ...): gradient = active segment slope·dx. */
export function dualTable(nSlots: number, args: Dual[]): Dual {
  const x = args[0] as Dual;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < args.length; i += 2) {
    xs.push((args[i] as Dual).value);
    ys.push((args[i + 1] as Dual).value);
  }
  const last = xs.length - 1;
  let slope = 0;
  let value: number;
  if (x.value <= (xs[0] as number)) {
    value = ys[0] as number;
  } else if (x.value >= (xs[last] as number)) {
    value = ys[last] as number;
  } else {
    value = ys[last] as number;
    for (let i = 1; i < xs.length; i++) {
      const x1 = xs[i - 1] as number;
      const x2 = xs[i] as number;
      if (x.value <= x2) {
        const y1 = ys[i - 1] as number;
        const y2 = ys[i] as number;
        value = y1 + ((x.value - x1) / (x2 - x1)) * (y2 - y1);
        slope = (y2 - y1) / (x2 - x1);
        break;
      }
    }
  }
  const grads = new Float64Array(nSlots);
  for (let k = 0; k < nSlots; k++) {
    grads[k] = slope * (x.grads[k] as number);
  }
  return { value, grads };
}

/** Thrown for unknown functions in B-source expressions (compile time). */
export function unknownDualFunction(name: string, pos: number): ExpressionError {
  return new ExpressionError(`Unknown function "${name}"`, pos);
}
