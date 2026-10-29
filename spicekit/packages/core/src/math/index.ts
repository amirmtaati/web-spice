/**
 * core/math (SPEC §5.10, §14): every transcendental function used by devices
 * and the evaluator goes through this module — never `Math.*` directly in
 * device code. Rationale: JS engines (JSC/V8/SpiderMonkey) may differ in the
 * last bits; if cross-runtime drift ever breaks a tolerance, this is the one
 * module to swap for a deterministic implementation (ADR required).
 *
 * Add functions here as devices need them; do not widen the surface "just in
 * case" — each function must have a consumer.
 */

export const TAU = 2 * Math.PI;

export function exp(x: number): number {
  return Math.exp(x);
}

export function sin(x: number): number {
  return Math.sin(x);
}

export function cos(x: number): number {
  return Math.cos(x);
}

export function sqrt(x: number): number {
  return Math.sqrt(x);
}

export function abs(x: number): number {
  return Math.abs(x);
}

/** Thermal voltage at temperature `tKelvin`. */
export function vThermal(tKelvin: number): number {
  const q = 1.602176634e-19; // elementary charge (exact, SI 2019)
  const k = 1.380649e-23; // Boltzmann constant (exact, SI 2019)
  return (k * tKelvin) / q;
}
