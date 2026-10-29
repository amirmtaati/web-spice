/**
 * Recursive-descent expression compiler (SPEC §5.6). Produces closures over
 * an evaluation context — no AST interpretation on the hot path, and never
 * `eval` or `new Function` (SPEC §12.4). Precedence (low → high): ternary,
 * ||, &&, equality, comparison, additive, multiplicative, unary, power
 * (right-assoc). Comparisons yield 1/0 so they compose with arithmetic and
 * ternaries.
 *
 * The grammar is compiled through an `Algebra<T>` strategy: the real algebra
 * yields plain closures (`.param`, `{expr}`, `evaluate` message) and the dual
 * algebra (dual.ts, E3) yields forward-mode-AD closures for B sources. The
 * two share every grammar rule, so behavioral divergence is impossible.
 *
 * Argument lists accept `,`-separated or whitespace-separated items: B-source
 * cards are reconstructed from whitespace-split netlist tokens, so
 * `table(v(a) 0 1 2 3)` must parse like `table(v(a), 0, 1, 2, 3)`.
 */

import * as m from "../math/index.ts";
import type { Dual } from "./dual.ts";
import {
  type CompiledDualExpression,
  constDual,
  DUAL_FUNCTIONS,
  type DualEvalContext,
  type DualOperand,
  dualAdd,
  dualDiv,
  dualMod,
  dualMul,
  dualNeg,
  dualPow,
  dualSub,
  dualTable,
  unknownDualFunction,
} from "./dual.ts";
import { CONSTANTS, compileCall, type EvalFn } from "./functions.ts";
import { ExpressionError, type Token, tokenize } from "./tokenizer.ts";

export function compileExpression(src: string): EvalFn {
  const tokens = tokenize(src);
  const parser = new ExprParser(tokens, src, REAL_ALGEBRA);
  const fn = parser.parseTernary();
  const end = parser.peek();
  if (end.type !== "end") {
    throw new ExpressionError(`Unexpected token "${end.text}"`, end.pos);
  }
  return fn as EvalFn;
}

/**
 * Compile a B-source expression into a dual closure plus the operand table
 * (distinct v()/i() accesses in first-sight order). Same grammar, dual
 * algebra (SPEC §5.6).
 */
export function compileExpressionDual(src: string): CompiledDualExpression {
  const tokens = tokenize(src);
  const dual = new DualAlgebra();
  const parser = new ExprParser(tokens, src, dual);
  const fn = parser.parseTernary();
  const end = parser.peek();
  if (end.type !== "end") {
    throw new ExpressionError(`Unexpected token "${end.text}"`, end.pos);
  }
  return { fn: fn as DualAlgebraFn, operands: dual.operands, nSlots: dual.nSlots };
}

/**
 * The algebra strategy: every grammar rule builds values through these
 * combinators. T = EvalFn (real) or DualAlgebraFn (dual).
 */
export interface Algebra<T> {
  lit(n: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  mod(a: T, b: T): T;
  pow(a: T, b: T): T;
  neg(a: T): T;
  cmp(op: string, a: T, b: T): T;
  and(a: T, b: T): T;
  or(a: T, b: T): T;
  not(a: T): T;
  ternary(c: T, t: T, e: T): T;
  call(name: string, args: T[], pos: number): T;
  v(name: string, pos: number): T;
  i(name: string, pos: number): T;
  /** Named parameter; the algebra throws/defers as it sees fit. */
  param(name: string, original: string, pos: number): T;
  time(): T;
  constant(name: string): T | undefined;
}

const REAL_CMP: Readonly<Record<string, (a: number, b: number) => number>> = {
  "<": (a, b) => (a < b ? 1 : 0),
  "<=": (a, b) => (a <= b ? 1 : 0),
  ">": (a, b) => (a > b ? 1 : 0),
  ">=": (a, b) => (a >= b ? 1 : 0),
  "==": (a, b) => (a === b ? 1 : 0),
  "!=": (a, b) => (a !== b ? 1 : 0),
};

/** The plain-number algebra: identical closures to the pre-E3 compiler. */
const REAL_ALGEBRA: Algebra<EvalFn> = {
  lit: (n) => () => n,
  add: (a, b) => (ctx) => a(ctx) + b(ctx),
  sub: (a, b) => (ctx) => a(ctx) - b(ctx),
  mul: (a, b) => (ctx) => a(ctx) * b(ctx),
  div: (a, b) => (ctx) => a(ctx) / b(ctx),
  mod: (a, b) => (ctx) => a(ctx) % b(ctx),
  pow: (a, b) => (ctx) => a(ctx) ** b(ctx),
  neg: (a) => (ctx) => -a(ctx),
  cmp: (op, a, b) => {
    const fn = REAL_CMP[op];
    return (ctx) => (fn as (x: number, y: number) => number)(a(ctx), b(ctx));
  },
  and: (a, b) => (ctx) => (a(ctx) !== 0 && b(ctx) !== 0 ? 1 : 0),
  or: (a, b) => (ctx) => (a(ctx) !== 0 || b(ctx) !== 0 ? 1 : 0),
  not: (a) => (ctx) => (a(ctx) === 0 ? 1 : 0),
  ternary: (c, t, e) => (ctx) => (c(ctx) !== 0 ? t(ctx) : e(ctx)),
  call: (name, args, pos) => compileCall(name, args, pos),
  v: (name) => (ctx) => ctx.v(name),
  i: (name) => (ctx) => ctx.i(name),
  param: (lower, original) => (ctx) => {
    const value = ctx.param(lower);
    if (value === undefined) {
      throw new Error(`Unknown identifier "${original}" in expression`);
    }
    return value;
  },
  time: () => (ctx) => ctx.time,
  constant: (lower) => CONSTANTS[lower],
};

type DualAlgebraFn = (ctx: DualEvalContext) => Dual;

/** The dual algebra: forward-mode AD over the same grammar. */
class DualAlgebra implements Algebra<DualAlgebraFn> {
  readonly operands: DualOperand[] = [];
  private readonly slots = new Map<string, number>();

  /** Gradient width: one slot per distinct operand (final after parsing). */
  get nSlots(): number {
    return this.operands.length;
  }

  private slot(kind: "v" | "i", name: string): number {
    const key = `${kind}:${name.toLowerCase()}`;
    const existing = this.slots.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const slot = this.operands.length;
    this.slots.set(key, slot);
    this.operands.push({ kind, name, slot });
    return slot;
  }

  lit(n: number): DualAlgebraFn {
    return (_ctx) => constDual(this.nSlots, n);
  }

  add(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualAdd(a(ctx), b(ctx));
  }

  sub(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualSub(a(ctx), b(ctx));
  }

  mul(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualMul(a(ctx), b(ctx));
  }

  div(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualDiv(a(ctx), b(ctx));
  }

  mod(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualMod(a(ctx), b(ctx));
  }

  pow(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualPow(a(ctx), b(ctx));
  }

  neg(a: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => dualNeg(a(ctx));
  }

  cmp(op: string, a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    const fn = REAL_CMP[op];
    return (ctx) => {
      const value = (fn as (x: number, y: number) => number)(a(ctx).value, b(ctx).value);
      return constDual(this.nSlots, value);
    };
  }

  and(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => constDual(this.nSlots, a(ctx).value !== 0 && b(ctx).value !== 0 ? 1 : 0);
  }

  or(a: DualAlgebraFn, b: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => constDual(this.nSlots, a(ctx).value !== 0 || b(ctx).value !== 0 ? 1 : 0);
  }

  not(a: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => constDual(this.nSlots, a(ctx).value === 0 ? 1 : 0);
  }

  ternary(c: DualAlgebraFn, t: DualAlgebraFn, e: DualAlgebraFn): DualAlgebraFn {
    return (ctx) => (c(ctx).value !== 0 ? t(ctx) : e(ctx));
  }

  call(name: string, args: DualAlgebraFn[], pos: number): DualAlgebraFn {
    const lower = name.toLowerCase();
    const builtin = DUAL_FUNCTIONS[lower];
    if (builtin === undefined) {
      throw unknownDualFunction(name, pos);
    }
    if (builtin.arity === "table") {
      if (args.length < 3 || args.length % 2 === 0) {
        throw new ExpressionError(`${lower}() expects table(x, x1, y1, x2, y2, ...)`, pos);
      }
      return (ctx) => {
        const ds = args.map((arg) => arg(ctx));
        return dualTable(this.nSlots, ds);
      };
    }
    if (builtin.arity === "variadic") {
      if (args.length < builtin.minArgs || args.length > builtin.maxArgs) {
        throw new ExpressionError(
          `${lower}() expects ${builtin.minArgs}..${builtin.maxArgs} arguments`,
          pos,
        );
      }
      return (ctx) => {
        const ds = args.map((arg) => arg(ctx));
        return builtin.fn(this.nSlots, ds);
      };
    }
    if (args.length !== builtin.arity) {
      throw new ExpressionError(
        `${lower}() expects ${builtin.arity} argument(s), got ${args.length}`,
        pos,
      );
    }
    // nSlots is read at EVAL time (this.nSlots): operands appearing later in
    // the expression still land in every gradient array.
    if (builtin.arity === 1) {
      const arg = args[0] as DualAlgebraFn;
      return (ctx) => builtin.fn(this.nSlots, arg(ctx));
    }
    if (builtin.arity === 2) {
      const a = args[0] as DualAlgebraFn;
      const b = args[1] as DualAlgebraFn;
      return (ctx) => builtin.fn(this.nSlots, a(ctx), b(ctx));
    }
    const a = args[0] as DualAlgebraFn;
    const b = args[1] as DualAlgebraFn;
    const c = args[2] as DualAlgebraFn;
    return (ctx) => builtin.fn(this.nSlots, a(ctx), b(ctx), c(ctx));
  }

  v(name: string, _pos: number): DualAlgebraFn {
    const slot = this.slot("v", name);
    return (ctx) => ctx.v(name, slot);
  }

  i(name: string, _pos: number): DualAlgebraFn {
    const slot = this.slot("i", name);
    return (ctx) => ctx.i(name, slot);
  }

  param(lower: string, _original: string, _pos: number): DualAlgebraFn {
    return (ctx) => ctx.param(lower);
  }

  time(): DualAlgebraFn {
    return (ctx) => constDual(this.nSlots, ctx.time);
  }

  constant(lower: string): DualAlgebraFn | undefined {
    // The math constants from the real algebra (CONSTANTS table), as duals.
    switch (lower) {
      case "pi":
        return (_ctx) => constDual(this.nSlots, Math.PI);
      case "e":
        return (_ctx) => constDual(this.nSlots, Math.E);
      case "q":
        return (_ctx) => constDual(this.nSlots, m.CHARGE);
      case "k":
        return (_ctx) => constDual(this.nSlots, m.BOLTZMANN);
      case "t":
        return (ctx) => constDual(this.nSlots, ctx.tempC + m.KELVIN);
      case "temp":
        return (ctx) => constDual(this.nSlots, ctx.tempC);
      default:
        return undefined;
    }
  }
}

class ExprParser<T> {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
    private readonly alg: Algebra<T>,
  ) {}

  peek(): Token {
    return this.tokens[this.index] as Token;
  }

  next(): Token {
    const token = this.tokens[this.index] as Token;
    this.index += 1;
    return token;
  }

  expectOp(op: string): void {
    const token = this.next();
    if (token.type !== "op" || token.text !== op) {
      throw new ExpressionError(`Expected "${op}"`, token.pos);
    }
  }

  parseTernary(): T {
    const condition = this.parseOr();
    if (this.peek().type === "op" && this.peek().text === "?") {
      this.next();
      const thenFn = this.parseTernary();
      this.expectOp(":");
      const elseFn = this.parseTernary();
      return this.alg.ternary(condition, thenFn, elseFn);
    }
    return condition;
  }

  private parseBinary(
    operand: (p: ExprParser<T>) => T,
    ops: Readonly<Record<string, string>>,
    combine: (op: string, a: T, b: T) => T,
  ): T {
    let left = operand(this);
    for (;;) {
      const token = this.peek();
      if (token.type === "op" && ops[token.text] !== undefined) {
        this.next();
        const right = operand(this);
        left = combine(token.text, left, right);
        continue;
      }
      return left;
    }
  }

  private parseOr(): T {
    return this.parseBinary(
      (p) => p.parseAnd(),
      { "||": "||" },
      (op, a, b) => {
        void op;
        return this.alg.or(a, b);
      },
    );
  }

  private parseAnd(): T {
    return this.parseBinary(
      (p) => p.parseEquality(),
      { "&&": "&&" },
      (_op, a, b) => this.alg.and(a, b),
    );
  }

  private parseEquality(): T {
    return this.parseBinary(
      (p) => p.parseCompare(),
      { "==": "==", "!=": "!=" },
      (op, a, b) => this.alg.cmp(op, a, b),
    );
  }

  private parseCompare(): T {
    return this.parseBinary(
      (p) => p.parseAdditive(),
      { "<": "<", "<=": "<=", ">": ">", ">=": ">=" },
      (op, a, b) => this.alg.cmp(op, a, b),
    );
  }

  private parseAdditive(): T {
    return this.parseBinary(
      (p) => p.parseMultiplicative(),
      { "+": "+", "-": "-" },
      (op, a, b) => (op === "+" ? this.alg.add(a, b) : this.alg.sub(a, b)),
    );
  }

  private parseMultiplicative(): T {
    return this.parseBinary(
      (p) => p.parseUnary(),
      { "*": "*", "/": "/", "%": "%" },
      (op, a, b) => {
        if (op === "*") {
          return this.alg.mul(a, b);
        }
        if (op === "/") {
          return this.alg.div(a, b);
        }
        return this.alg.mod(a, b);
      },
    );
  }

  private parseUnary(): T {
    const token = this.peek();
    if (token.type === "op" && (token.text === "-" || token.text === "+" || token.text === "!")) {
      this.next();
      const operand = this.parseUnary();
      if (token.text === "-") {
        return this.alg.neg(operand);
      }
      if (token.text === "+") {
        return operand;
      }
      return this.alg.not(operand);
    }
    return this.parsePower();
  }

  /** Power binds tighter than unary minus on the left, looser on the right. */
  private parsePower(): T {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token.type === "op" && (token.text === "^" || token.text === "**")) {
      this.next();
      const exponent = this.parseUnary();
      return this.alg.pow(base, exponent);
    }
    return base;
  }

  private parsePrimary(): T {
    const token = this.next();
    switch (token.type) {
      case "number": {
        const value = token.value;
        return this.alg.lit(value);
      }
      case "lparen": {
        const inner = this.parseTernary();
        const close = this.next();
        if (close.type !== "rparen") {
          throw new ExpressionError("Expected ')'", close.pos);
        }
        return inner;
      }
      case "ident": {
        return this.parseIdentifier(token);
      }
      case "end":
        throw new ExpressionError(`Unexpected end of expression: "${this.src}"`, token.pos);
      case "comma":
      case "op":
      case "rparen":
        throw new ExpressionError(`Unexpected token "${token.text}"`, token.pos);
      default:
        throw new ExpressionError("Unexpected token type", token.pos);
    }
  }

  private parseIdentifier(token: Token): T {
    const name = token.text;
    const lower = name.toLowerCase();
    if (this.peek().type === "lparen") {
      this.next(); // consume '('
      if (lower === "v" || lower === "i") {
        return this.parseAccess(lower, token.pos);
      }
      const args: T[] = [];
      if (this.peek().type !== "rparen") {
        // Whitespace acts as an implicit argument separator (B-source cards
        // rejoin whitespace-split tokens; see file header).
        args.push(this.parseTernary());
        for (;;) {
          const t = this.peek();
          if (t.type === "comma") {
            this.next();
            args.push(this.parseTernary());
            continue;
          }
          if (t.type === "rparen" || t.type === "end") {
            break;
          }
          // A fresh expression start (number/ident/etc.) without a comma.
          args.push(this.parseTernary());
        }
      }
      const close = this.next();
      if (close.type !== "rparen") {
        throw new ExpressionError(`Expected ')' after ${name}(...)`, close.pos);
      }
      return this.alg.call(name, args, token.pos);
    }
    const constant = this.alg.constant(lower);
    if (constant !== undefined) {
      return constant;
    }
    if (lower === "time") {
      return this.alg.time();
    }
    // Bare identifier: a named parameter (case-insensitive).
    return this.alg.param(lower, name, token.pos);
  }

  /**
   * v(node)/i(element): the target is captured as a raw name token at parse
   * time (node names may be numeric — "v(1)" — so expression parsing cannot
   * produce them). Case handling is delegated to the context lookup.
   */
  private parseAccess(lower: string, pos: number): T {
    const target = this.next();
    if (target.type !== "ident" && target.type !== "number") {
      throw new ExpressionError(`${lower}() expects a node/element name`, pos);
    }
    const close = this.next();
    if (close.type !== "rparen") {
      throw new ExpressionError(`Expected ')' after ${lower}(${target.text}`, close.pos);
    }
    const name = target.text;
    return lower === "v" ? this.alg.v(name, pos) : this.alg.i(name, pos);
  }
}
