/**
 * Evaluation context (SPEC §5.6): the seam between compiled expressions and
 * the simulation. Parameter resolution uses a scope that only serves `param`;
 * behavioral sources (E3) supply `v`/`i` accessors bound to the solution
 * vector. All math goes through `core/math` (SPEC §5.10).
 */

/** Context passed to every compiled expression evaluation. */
export interface EvalContext {
  /** Simulation time in seconds (0 outside transient). */
  readonly time: number;
  /** Circuit temperature in °C (SimOptions.temp). */
  readonly tempC: number;
  /** Node voltage by node name (case-insensitive). */
  v(node: string): number;
  /** Element current by element name (case-insensitive). */
  i(element: string): number;
  /** Named `.param` lookup; undefined when the name is not a parameter. */
  param(name: string): number | undefined;
}
