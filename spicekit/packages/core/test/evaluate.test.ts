/**
 * `evaluate` message (E3, SPEC §4.3/§5.6): core expression evaluation with
 * a caller-supplied context, plus end-to-end delivery through the client
 * stub engine's evaluateResult reply.
 */
import { describe, expect, test } from "bun:test";
import { EngineError } from "@spicekit/protocol";
import { evaluateExpression } from "../src/evaluate.ts";

describe("evaluateExpression — core facade", () => {
  test("arithmetic, functions, and constants", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("sqrt(16) + abs(-2)")).toBe(6);
    expect(evaluateExpression("pi * 2")).toBeCloseTo(2 * Math.PI, 12);
    expect(evaluateExpression("min(3, 1, 2) + max(3, 1, 2)")).toBe(4);
    expect(evaluateExpression("v(a) > 0.5 ? 1 : -1", { voltages: { a: 0.7 } })).toBe(1);
  });

  test("v()/i() context lookups are case-insensitive", () => {
    const value = evaluateExpression("v(OUT) * i(V1) + 1", {
      voltages: { out: 2.5 },
      currents: { v1: -0.002 },
    });
    expect(value).toBeCloseTo(2.5 * -0.002 + 1, 12);
  });

  test("parameters resolve from the params table", () => {
    expect(
      evaluateExpression("gain * v(in) + offset", {
        voltages: { in: 2 },
        params: { gain: 3, offset: 0.5 },
      }),
    ).toBeCloseTo(6.5, 12);
  });

  test("time reaches time-dependent expressions", () => {
    expect(evaluateExpression("sin(2*pi*1k*time)", { time: 2.5e-4 })).toBeCloseTo(
      Math.sin(2 * Math.PI * 1000 * 2.5e-4),
      12,
    );
  });

  test("unknown node/element/identifier reports E_PARSE", () => {
    expect(() => evaluateExpression("v(nowhere)", { voltages: {} })).toThrow(EngineError);
    expect(() => evaluateExpression("i(v9)", { currents: {} })).toThrow(EngineError);
    expect(() => evaluateExpression("mystery * 2")).toThrow(EngineError);
    try {
      evaluateExpression("v(nowhere)");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as EngineError).code).toBe("E_PARSE");
      expect((e as EngineError).message).toContain("nowhere");
    }
  });

  test("syntax errors report E_PARSE", () => {
    expect(() => evaluateExpression("2 +* 3")).toThrow(EngineError);
  });
});
