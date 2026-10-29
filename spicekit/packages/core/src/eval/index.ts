/**
 * Expression evaluator public API (SPEC §5.6). Used by `.param`, `{}` element
 * values, and (from E3) behavioral sources and the `evaluate` message.
 * Expressions compile to closures — never `eval`/`new Function`.
 */

export type { EvalContext } from "./context.ts";
export type { EvalFn } from "./functions.ts";
export { ParamScope } from "./params.ts";
export { compileExpression } from "./parser.ts";
export { ExpressionError } from "./tokenizer.ts";

import type { Expr } from "@spicekit/protocol";
import type { EvalContext } from "./context.ts";
import { compileExpression } from "./parser.ts";

/**
 * Resolve a protocol `Expr` (number or expression string) in a context.
 * String form may include the `{...}` braces from the netlist; they are
 * stripped before compiling.
 */
export function resolveExpr(expr: Expr, ctx: EvalContext): number {
  if (typeof expr === "number") {
    return expr;
  }
  const source = expr.startsWith("{") && expr.endsWith("}") ? expr.slice(1, -1) : expr;
  return compileExpression(source)(ctx);
}
