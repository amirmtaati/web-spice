/**
 * Expression evaluator tests (SPEC §5.6): precedence, functions, constants,
 * accessors, error paths, and the strict number rules.
 */
import { describe, expect, test } from "bun:test";
import type { EvalContext } from "../src/eval/index.ts";
import { ParamScope } from "../src/eval/params.ts";
import { compileExpression } from "../src/eval/parser.ts";
import { ExpressionError } from "../src/eval/tokenizer.ts";

function scope(params: Record<string, number | string> = {}): EvalContext {
  return new ParamScope(params);
}

function evalSrc(src: string, ctx: EvalContext = scope()): number {
  return compileExpression(src)(ctx);
}

describe("expression evaluator — arithmetic", () => {
  test("precedence: * before +", () => {
    expect(evalSrc("2 + 3 * 4")).toBe(14);
  });

  test("parentheses override precedence", () => {
    expect(evalSrc("(2 + 3) * 4")).toBe(20);
  });

  test("unary minus binds looser than power (-2^2 = -4)", () => {
    expect(evalSrc("-2^2")).toBe(-4);
  });

  test("unary minus on the exponent side binds tight (2^-2)", () => {
    expect(evalSrc("2^-2")).toBe(0.25);
  });

  test("power is right associative", () => {
    expect(evalSrc("2^3^2")).toBe(2 ** 9);
  });

  test("** and ^ are aliases", () => {
    expect(evalSrc("2**10")).toBe(1024);
  });

  test("modulo", () => {
    expect(evalSrc("7 % 3")).toBe(1);
  });

  test("engineering suffixes in numbers", () => {
    expect(evalSrc("4.7k * 2")).toBeCloseTo(9400, 10);
    expect(evalSrc("1meg + 1k")).toBe(1_001_000);
    expect(evalSrc("100n")).toBeCloseTo(1e-7, 20);
  });

  test("scientific notation", () => {
    expect(evalSrc("1e3")).toBe(1000);
    expect(evalSrc("2.5E-2")).toBe(0.025);
  });
});

describe("expression evaluator — comparisons and logic", () => {
  test("comparisons yield 1/0", () => {
    expect(evalSrc("3 > 2")).toBe(1);
    expect(evalSrc("2 > 3")).toBe(0);
    expect(evalSrc("2 <= 2")).toBe(1);
    expect(evalSrc("2 == 2")).toBe(1);
    expect(evalSrc("2 != 2")).toBe(0);
  });

  test("&& and || short-circuit semantics via 1/0", () => {
    expect(evalSrc("1 && 0")).toBe(0);
    expect(evalSrc("1 || 0")).toBe(1);
    expect(evalSrc("1 && (0 || 1)")).toBe(1);
  });

  test("ternary picks branch", () => {
    expect(evalSrc("1 ? 10 : 20")).toBe(10);
    expect(evalSrc("0 ? 10 : 20")).toBe(20);
    expect(evalSrc("2 > 1 ? 5 : 6 + 1")).toBe(5);
  });

  test("negation", () => {
    expect(evalSrc("!0")).toBe(1);
    expect(evalSrc("!5")).toBe(0);
  });
});

describe("expression evaluator — functions", () => {
  test("transcendentals route through core/math", () => {
    expect(evalSrc("sin(pi/2)")).toBeCloseTo(1, 12);
    expect(evalSrc("cos(0)")).toBe(1);
    expect(evalSrc("exp(1)")).toBeCloseTo(Math.E, 12);
    expect(evalSrc("ln(e)")).toBeCloseTo(1, 12);
    expect(evalSrc("log10(1000)")).toBeCloseTo(3, 12);
    expect(evalSrc("log(8)")).toBeCloseTo(3, 12);
    expect(evalSrc("sqrt(9)")).toBe(3);
    expect(evalSrc("abs(-3)")).toBe(3);
    expect(evalSrc("pow(2, 5)")).toBe(32);
    expect(evalSrc("atan2(1, 1)")).toBeCloseTo(Math.PI / 4, 12);
    expect(evalSrc("tanh(0)")).toBe(0);
    expect(evalSrc("floor(2.7)")).toBe(2);
    expect(evalSrc("ceil(2.1)")).toBe(3);
    expect(evalSrc("int(-2.7)")).toBe(-2);
    expect(evalSrc("sgn(-5)")).toBe(-1);
  });

  test("u(), uramp(), limit()", () => {
    expect(evalSrc("u(-1)")).toBe(0);
    expect(evalSrc("u(0)")).toBe(1);
    expect(evalSrc("uramp(-2)")).toBe(0);
    expect(evalSrc("uramp(3)")).toBe(3);
    expect(evalSrc("limit(5, 0, 3)")).toBe(3);
    expect(evalSrc("limit(-1, 0, 3)")).toBe(0);
  });

  test("min/max variadic", () => {
    expect(evalSrc("min(3, 1, 2)")).toBe(1);
    expect(evalSrc("max(3, 1, 2)")).toBe(3);
  });

  test("if(cond, a, b)", () => {
    expect(evalSrc("if(1, 4, 9)")).toBe(4);
    expect(evalSrc("if(0, 4, 9)")).toBe(9);
  });

  test("table() interpolates and clamps", () => {
    expect(evalSrc("table(0.5, 0, 0, 1, 10)")).toBeCloseTo(5, 12);
    expect(evalSrc("table(-1, 0, 0, 1, 10)")).toBe(0);
    expect(evalSrc("table(9, 0, 0, 1, 10)")).toBe(10);
  });
});

describe("expression evaluator — variables and accessors", () => {
  test("parameters resolve (case-insensitive)", () => {
    expect(evalSrc("Rload * 2", scope({ rload: 50 }))).toBe(100);
  });

  test("constants pi, e, q, k, T", () => {
    expect(evalSrc("pi")).toBeCloseTo(Math.PI, 15);
    expect(evalSrc("q")).toBeCloseTo(1.602176634e-19, 25);
    expect(evalSrc("k")).toBeCloseTo(1.380649e-23, 30);
    expect(evalSrc("T")).toBeCloseTo(300.15, 3);
    expect(evalSrc("temp")).toBe(27);
  });

  test("time variable", () => {
    const ctx: EvalContext = {
      time: 1.5,
      tempC: 27,
      v: () => 0,
      i: () => 0,
      param: () => undefined,
    };
    expect(compileExpression("time")(ctx)).toBe(1.5);
  });

  test("v()/i() accessors reach the context", () => {
    const ctx: EvalContext = {
      time: 0,
      tempC: 27,
      v: (node) => (node.toLowerCase() === "out" ? 4.2 : 0),
      i: (el) => (el.toLowerCase() === "v1" ? -0.001 : 0),
      param: () => undefined,
    };
    expect(compileExpression("v(out)")(ctx)).toBe(4.2);
    expect(compileExpression("i(V1)")(ctx)).toBe(-0.001);
    expect(compileExpression("v(out) / 1k")(ctx)).toBeCloseTo(0.0042, 15);
  });

  test("nested params resolve lazily", () => {
    expect(evalSrc("c", scope({ a: "1", b: "a + 1", c: "b * 2" }))).toBe(4);
  });
});

describe("expression evaluator — error paths", () => {
  test("unknown function", () => {
    expect(() => evalSrc("frobnicate(1)")).toThrow(ExpressionError);
  });

  test("unknown identifier throws at evaluation", () => {
    expect(() => evalSrc("nosuch + 1")).toThrow(/Unknown identifier/);
  });

  test("unbalanced parens", () => {
    expect(() => evalSrc("(1 + 2")).toThrow(ExpressionError);
    expect(() => evalSrc("1 + 2)")).toThrow(ExpressionError);
  });

  test("trailing garbage", () => {
    expect(() => evalSrc("1 2")).toThrow(ExpressionError);
  });

  test("glued tokens rejected (2pi, 10kohm)", () => {
    expect(() => evalSrc("2pi")).toThrow(ExpressionError);
    expect(() => evalSrc("10kohm")).toThrow(ExpressionError);
  });

  test("arity checked at compile time", () => {
    expect(() => evalSrc("sin(1, 2)")).toThrow(/expects 1 argument/);
    expect(() => evalSrc("min()")).toThrow(/expects/);
  });

  test("param cycles are detected", () => {
    expect(() => evalSrc("a", scope({ a: "b", b: "a" }))).toThrow(/cycle/);
  });

  test("empty expression", () => {
    expect(() => evalSrc("")).toThrow(ExpressionError);
  });
});
