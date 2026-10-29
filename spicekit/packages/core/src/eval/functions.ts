/**
 * Builtin function and constant tables for the expression evaluator
 * (SPEC §5.6). Every entry routes through `core/math`; arity is checked at
 * compile time so evaluation never branches on argument count.
 */

import * as m from "../math/index.ts";
import type { EvalContext } from "./context.ts";
import { ExpressionError } from "./tokenizer.ts";

export type EvalFn = (ctx: EvalContext) => number;

export const CONSTANTS: Readonly<Record<string, (ctx: EvalContext) => number>> = {
  pi: () => Math.PI,
  e: () => Math.E,
  q: () => m.CHARGE,
  k: () => m.BOLTZMANN,
  // Spec lists `T` as a constant: temperature in kelvin (matches kT/q usage).
  t: (ctx) => ctx.tempC + m.KELVIN,
  // ngspice-style alias, in °C, kept distinct from `T`.
  temp: (ctx) => ctx.tempC,
};

interface Fixed1 {
  arity: 1;
  fn: (a: number) => number;
}
interface Fixed2 {
  arity: 2;
  fn: (a: number, b: number) => number;
}
interface Fixed3 {
  arity: 3;
  fn: (a: number, b: number, c: number) => number;
}
interface Variadic {
  arity: "variadic";
  minArgs: number;
  maxArgs: number;
  fn(args: number[]): number;
}
/** table(x, x1, y1, ...) is special: odd arg count, ≥ 3. */
interface TableFn {
  arity: "table";
}

type Builtin = Fixed1 | Fixed2 | Fixed3 | Variadic | TableFn;

export const FUNCTIONS: Readonly<Record<string, Builtin>> = {
  sin: { arity: 1, fn: m.sin },
  cos: { arity: 1, fn: m.cos },
  tan: { arity: 1, fn: m.tan },
  asin: { arity: 1, fn: m.asin },
  acos: { arity: 1, fn: m.acos },
  atan: { arity: 1, fn: m.atan },
  atan2: { arity: 2, fn: m.atan2 },
  sinh: { arity: 1, fn: m.sinh },
  cosh: { arity: 1, fn: m.cosh },
  tanh: { arity: 1, fn: m.tanh },
  exp: { arity: 1, fn: m.exp },
  ln: { arity: 1, fn: m.ln },
  log: { arity: 1, fn: m.log },
  log10: { arity: 1, fn: m.log10 },
  sqrt: { arity: 1, fn: m.sqrt },
  abs: { arity: 1, fn: m.abs },
  pow: { arity: 2, fn: m.pow },
  floor: { arity: 1, fn: m.floor },
  ceil: { arity: 1, fn: m.ceil },
  int: { arity: 1, fn: m.int },
  sgn: { arity: 1, fn: m.sgn },
  u: { arity: 1, fn: m.u },
  uramp: { arity: 1, fn: m.uramp },
  min: { arity: "variadic", minArgs: 1, maxArgs: 16, fn: variadicMin },
  max: { arity: "variadic", minArgs: 1, maxArgs: 16, fn: variadicMax },
  limit: { arity: 3, fn: (x: number, lo: number, hi: number): number => m.limit(x, lo, hi) },
  if: {
    arity: 3,
    fn: (cond: number, thenValue: number, elseValue: number): number =>
      cond !== 0 ? thenValue : elseValue,
  },
  table: { arity: "table" },
};

function variadicMin(args: number[]): number {
  let best = args[0] as number;
  for (let i = 1; i < args.length; i++) {
    const v = args[i] as number;
    if (v < best) {
      best = v;
    }
  }
  return best;
}

function variadicMax(args: number[]): number {
  let best = args[0] as number;
  for (let i = 1; i < args.length; i++) {
    const v = args[i] as number;
    if (v > best) {
      best = v;
    }
  }
  return best;
}

/** Compile a call to a known builtin into a closure; throws on bad arity. */
export function compileCall(name: string, args: EvalFn[], pos: number): EvalFn {
  const lower = name.toLowerCase();
  const builtin = FUNCTIONS[lower];
  if (builtin === undefined) {
    throw new ExpressionError(`Unknown function "${name}"`, pos);
  }
  if (builtin.arity === "table") {
    return compileTable(lower, args, pos);
  }
  if (builtin.arity === "variadic") {
    if (args.length < builtin.minArgs || args.length > builtin.maxArgs) {
      throw new ExpressionError(
        `${lower}() expects ${builtin.minArgs}..${builtin.maxArgs} arguments`,
        pos,
      );
    }
    const scratch: number[] = new Array<number>(args.length).fill(0);
    return (ctx) => {
      for (let i = 0; i < args.length; i++) {
        scratch[i] = (args[i] as EvalFn)(ctx);
      }
      return builtin.fn(scratch);
    };
  }
  if (args.length !== builtin.arity) {
    throw new ExpressionError(
      `${lower}() expects ${builtin.arity} argument(s), got ${args.length}`,
      pos,
    );
  }
  if (builtin.arity === 1) {
    const a = args[0] as EvalFn;
    const fn = builtin.fn;
    return (ctx) => fn(a(ctx));
  }
  if (builtin.arity === 2) {
    const a = args[0] as EvalFn;
    const b = args[1] as EvalFn;
    const fn = builtin.fn;
    return (ctx) => fn(a(ctx), b(ctx));
  }
  const a = args[0] as EvalFn;
  const b = args[1] as EvalFn;
  const c = args[2] as EvalFn;
  const fn = builtin.fn;
  return (ctx) => fn(a(ctx), b(ctx), c(ctx));
}

/**
 * table(x, x1, y1, x2, y2, ...): piecewise linear with clamping at the ends
 * (ngspice semantics). Requires an odd argument count ≥ 3 (x plus pairs).
 */
function compileTable(name: string, args: EvalFn[], pos: number): EvalFn {
  if (args.length < 3 || args.length % 2 === 0) {
    throw new ExpressionError(`${name}() expects table(x, x1, y1, x2, y2, ...)`, pos);
  }
  const x = args[0] as EvalFn;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < args.length; i += 2) {
    xs.push(Number.NaN);
    ys.push(Number.NaN);
  }
  return (ctx) => {
    // Table coordinates are constants in practice; evaluate once lazily.
    if (Number.isNaN(xs[0] ?? Number.NaN)) {
      for (let i = 1, j = 0; i < args.length; i += 2, j++) {
        const xfn = args[i];
        const yfn = args[i + 1];
        if (xfn === undefined || yfn === undefined) {
          break;
        }
        xs[j] = xfn(ctx);
        ys[j] = yfn(ctx);
      }
    }
    const xv = x(ctx);
    const last = xs.length - 1;
    if (xv <= (xs[0] as number)) {
      return ys[0] as number;
    }
    if (xv >= (xs[last] as number)) {
      return ys[last] as number;
    }
    for (let i = 1; i < xs.length; i++) {
      const x1 = xs[i - 1] as number;
      const x2 = xs[i] as number;
      if (xv <= x2) {
        const y1 = ys[i - 1] as number;
        const y2 = ys[i] as number;
        return y1 + ((xv - x1) / (x2 - x1)) * (y2 - y1);
      }
    }
    return ys[last] as number;
  };
}
