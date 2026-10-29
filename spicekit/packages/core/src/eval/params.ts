/**
 * Parameter scope (SPEC §5.6): resolves `.param` maps where entries may be
 * numbers or expressions referencing other parameters, in any order. Lazy
 * evaluation with memoization and cycle detection; compiled closures are
 * reused across evaluations.
 */

import type { EvalContext } from "./context.ts";
import { compileExpression } from "./parser.ts";

export class ParamScope implements EvalContext {
  readonly time: number;
  readonly tempC: number;
  private readonly cache = new Map<string, number>();
  private readonly compiled = new Map<string, ReturnType<typeof compileExpression>>();

  constructor(
    private readonly params: Record<string, number | string>,
    tempC = 27,
    time = 0,
  ) {
    this.tempC = tempC;
    this.time = time;
  }

  v(_node: string): number {
    throw new Error("v() is not available outside a simulation");
  }

  i(_element: string): number {
    throw new Error("i() is not available outside a simulation");
  }

  /** Resolve a parameter by (case-insensitive) name; undefined if unknown. */
  param(name: string): number | undefined {
    const lower = name.toLowerCase();
    const cached = this.cache.get(lower);
    if (cached !== undefined) {
      return cached;
    }
    return this.resolve(lower);
  }

  /** Instance-level resolution stack: survives through compiled closures. */
  private readonly resolving = new Set<string>();

  private resolve(lower: string): number | undefined {
    if (this.resolving.has(lower)) {
      throw new Error(`Parameter cycle: ${[...this.resolving, lower].join(" -> ")}`);
    }
    const raw = this.params[lower];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw === "number") {
      this.cache.set(lower, raw);
      return raw;
    }
    this.resolving.add(lower);
    let fn = this.compiled.get(lower);
    if (fn === undefined) {
      fn = compileExpression(raw);
      this.compiled.set(lower, fn);
    }
    const value = fn(this);
    this.resolving.delete(lower);
    this.cache.set(lower, value);
    return value;
  }
}
