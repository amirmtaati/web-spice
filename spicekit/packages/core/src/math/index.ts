/**
 * core/math (SPEC §5.10, §14): every transcendental function used by devices
 * and the evaluator goes through this module — never `Math.*` directly in
 * device code. Rationale: JS engines (JSC/V8/SpiderMonkey) may differ in the
 * last bits; if cross-runtime drift ever breaks a tolerance, this is the one
 * module to swap for a deterministic implementation (ADR required).
 *
 * The function set mirrors the evaluator's builtin table (SPEC §5.6), which is
 * the consumer of every entry here. Device code must import from this module.
 */

export const TAU = 2 * Math.PI;
export const PI = Math.PI;

/** Elementary charge (exact, SI 2019). */
export const CHARGE = 1.602176634e-19;
/** Boltzmann constant (exact, SI 2019). */
export const BOLTZMANN = 1.380649e-23;
/** 0 °C in kelvin. */
export const KELVIN = 273.15;

export function exp(x: number): number {
  return Math.exp(x);
}

export function sin(x: number): number {
  return Math.sin(x);
}

export function cos(x: number): number {
  return Math.cos(x);
}

export function tan(x: number): number {
  return Math.tan(x);
}

export function asin(x: number): number {
  return Math.asin(x);
}

export function acos(x: number): number {
  return Math.acos(x);
}

export function atan(x: number): number {
  return Math.atan(x);
}

export function atan2(y: number, x: number): number {
  return Math.atan2(y, x);
}

export function sinh(x: number): number {
  return Math.sinh(x);
}

export function cosh(x: number): number {
  return Math.cosh(x);
}

export function tanh(x: number): number {
  return Math.tanh(x);
}

/** Natural logarithm. */
export function ln(x: number): number {
  return Math.log(x);
}

/** Base-2 logarithm (`log()` in SPICE expressions). */
export function log(x: number): number {
  return Math.log2(x);
}

/** Base-10 logarithm (`log10()` in SPICE expressions). */
export function log10(x: number): number {
  return Math.log10(x);
}

export function sqrt(x: number): number {
  return Math.sqrt(x);
}

export function abs(x: number): number {
  return Math.abs(x);
}

export function min(a: number, b: number): number {
  return Math.min(a, b);
}

export function max(a: number, b: number): number {
  return Math.max(a, b);
}

export function pow(base: number, exponent: number): number {
  return base ** exponent;
}

export function floor(x: number): number {
  return Math.floor(x);
}

export function ceil(x: number): number {
  return Math.ceil(x);
}

/** SPICE `int()`: truncate toward zero (distinct from floor for negatives). */
export function int(x: number): number {
  return Math.trunc(x);
}

/** SPICE `sgn()`: sign with 0 mapping to 0. */
export function sgn(x: number): number {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

/** SPICE `u()`: unit step (1 for x ≥ 0, else 0). */
export function u(x: number): number {
  return x >= 0 ? 1 : 0;
}

/** SPICE `uramp()`: max(x, 0). */
export function uramp(x: number): number {
  return Math.max(x, 0);
}

/** SPICE `limit(x, lo, hi)`: clamp into [lo, hi]. */
export function limit(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** Thermal voltage kT/q at temperature `tKelvin`. */
export function vThermal(tKelvin: number): number {
  return (BOLTZMANN * tKelvin) / CHARGE;
}

/** Celsius to kelvin. */
export function celsiusToKelvin(celsius: number): number {
  return celsius + KELVIN;
}
