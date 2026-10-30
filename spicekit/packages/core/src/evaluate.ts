/**
 * `evaluate` message support (E3, SPEC §4.3/§5.6): expression evaluation
 * for math channels. The engine facade compiles the expression once and
 * evaluates it against a caller-supplied context (node voltages, element
 * currents, parameters) — the same closure compiler used by `.param` and
 * behavioral sources. `context` entries from the message map to
 * case-insensitive v()/i() lookups with optional per-call overrides.
 */

import { EngineError } from "@spicekit/protocol";

import { compileExpression, type EvalContext, ParamScope } from "./eval/index.ts";

export interface EvaluateOptions {
  /** Node voltages by name: v(name). */
  voltages?: Record<string, number>;
  /** Element currents by name: i(name). */
  currents?: Record<string, number>;
  /** Named parameters (e.g. from .param). */
  params?: Record<string, number>;
  /** Simulation time (default 0). */
  time?: number;
  /** Temperature in °C (default 27). */
  tempC?: number;
}

/**
 * Evaluate an expression string against the supplied context. Throws
 * E_PARSE (with the underlying message) for syntax errors, unknown
 * functions, or unknown identifiers.
 */
export function evaluateExpression(expr: string, options: EvaluateOptions = {}): number {
  const voltages = options.voltages ?? {};
  const currents = options.currents ?? {};
  const params = options.params ?? {};
  const scope = new ParamScope(params, options.tempC ?? 27, options.time ?? 0);
  const ctx: EvalContext = {
    time: options.time ?? 0,
    tempC: options.tempC ?? 27,
    v: (node: string): number => {
      const value = voltages[node.toLowerCase()];
      if (value === undefined) {
        throw new EngineError({
          code: "E_PARSE",
          message: `evaluate: unknown node "${node}" in context`,
        });
      }
      return value;
    },
    i: (element: string): number => {
      const value = currents[element.toLowerCase()];
      if (value === undefined) {
        throw new EngineError({
          code: "E_PARSE",
          message: `evaluate: unknown element "${element}" in context`,
        });
      }
      return value;
    },
    param: (name: string): number | undefined => scope.param(name),
  };
  try {
    return compileExpression(expr)(ctx);
  } catch (error) {
    throw new EngineError({
      code: "E_PARSE",
      message: `evaluate: ${(error as Error).message}`,
    });
  }
}
