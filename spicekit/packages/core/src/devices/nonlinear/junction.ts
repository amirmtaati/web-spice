/**
 * PN-junction physics shared by D / Q / M / J (SPEC §5.7). Formulas follow
 * SPICE2 (Massobrio & Antognetti, "Semiconductor Device Modeling with
 * SPICE2") with the ngspice refinements that matter for convergence:
 *
 *  - Reverse branch uses the generation-current form −Is·(1 + (3·vt/(e·v))³)
 *    instead of a flat −Is, so the reverse conductance is finite and Newton
 *    does not stall on an exactly-zero derivative (ngspice dioload.c).
 *  - Breakdown uses a matched knee: the branch −Is·exp(−(v+VBX)/vte) meets
 *    the reverse branch at v = −VBX and reaches exactly −IBV at v = −BV.
 *    This is the closed form of ngspice's diotemp.c knee matching loop
 *    (VBX = BV − vtebrk·ln(IBV/Is)); it removes the SPICE2 current jump.
 *  - Depletion capacitance is SPICE2's FC-linearized form: C1-continuous at
 *    v = FC·VJ (see junctionCapacitance below).
 *  - Every nonlinear branch also carries `gmin` in parallel (SPICE2/3
 *    CKTgmin semantics) — added by the caller.
 *
 * All functions are pure (state lives in the devices); exp/log come from
 * core/math per SPEC §5.10.
 */

import { BOLTZMANN, CHARGE, celsiusToKelvin, exp, ln, pow, sqrt } from "../../math/index.ts";

/** Thermal voltage vt = k·T/q for a temperature in °C (ngspice CONSTKoverQ). */
export function thermalVoltage(tempCelsius: number): number {
  return (BOLTZMANN * celsiusToKelvin(tempCelsius)) / CHARGE;
}

export interface DiodeJunction {
  /** Saturation current at the evaluated temperature (A). */
  is: number;
  /** Emission coefficient n. */
  n: number;
  /** Thermal voltage vt (V). */
  vt: number;
  /** Breakdown voltage BV; undefined = no breakdown branch. */
  bv?: number;
  /** Current at breakdown IBV (A). */
  ibv?: number;
  /** Emission coefficient of the breakdown branch (SPICE2 uses n). */
  nbv?: number;
}

export interface JunctionConduction {
  /** Current into the p terminal (A). */
  i: number;
  /** Conductance di/dv (S). */
  g: number;
}

const E = Math.E;

/**
 * Shockley junction with ngspice reverse-generation and matched-knee
 * breakdown. `vte = n·vt` (include the emission coefficient here).
 */
export function diodeConduction(v: number, d: DiodeJunction): JunctionConduction {
  const vte = d.n * d.vt;
  if (d.bv !== undefined) {
    const nbv = d.nbv ?? d.n;
    const vteb = nbv * d.vt;
    const ibv = d.ibv ?? 1e-3;
    // Matched knee: reverse branch value −Is is reached at −VBX.
    const vbx = d.bv - vteb * ln(Math.max(ibv, d.is) / d.is);
    if (v < -vbx) {
      const ev = exp(-(v + vbx) / vteb);
      return { i: -d.is * ev, g: (d.is / vteb) * ev };
    }
  }
  if (v >= -3 * vte) {
    const ev = exp(v / vte);
    return { i: d.is * (ev - 1), g: (d.is / vte) * ev };
  }
  // ngspice generation current: −Is·(1 + (3·vte/(e·v))³), finite slope.
  const arg = (3 * vte) / (v * E);
  const arg3 = arg * arg * arg;
  return { i: -d.is * (1 + arg3), g: (d.is * 3 * arg3) / v };
}

export interface JunctionCapacitance {
  /** Zero-bias junction capacitance (F). */
  cj0: number;
  /** Junction built-in potential (V). */
  vj: number;
  /** Grading exponent M. */
  m: number;
  /** Forward-bias depletion cutoff fraction FC (0..1). */
  fc: number;
}

/**
 * SPICE2 junction depletion capacitance with the FC forward-bias
 * linearization: below FC·VJ the classic (1 − v/VJ)^(−M) law; above it the
 * tangent line through FC·VJ — C1-continuous and free of the (1−v/VJ)^−M
 * blow-up that breaks Newton under forward bias.
 */
export function depletionCapacitance(v: number, c: JunctionCapacitance): number {
  const vF = c.fc * c.vj;
  if (v < vF) {
    const arg = Math.max(1 - v / c.vj, 1e-10);
    return c.cj0 * pow(arg, -c.m);
  }
  // Linear extrapolation: C = CJO/(1−FC)^(M+1) · (1 − FC(1+M) + M·v/VJ).
  const slopeTerm = (c.m * v) / c.vj;
  const factor = 1 - c.fc * (1 + c.m) + slopeTerm;
  return (c.cj0 * factor) / pow(1 - c.fc, c.m + 1);
}

/**
 * Diffusion (transit-time) capacitance for a forward junction:
 * Cd = TT/vte · Is·e^(v/vte) = TT·g_forward — zero in reverse where the
 * ideal injection term vanishes (SPICE2 evaluates it from the forward
 * conductance only).
 */
export function diffusionCapacitance(v: number, transitTime: number, d: DiodeJunction): number {
  if (transitTime <= 0) {
    return 0;
  }
  const vte = d.n * d.vt;
  const gForward = (d.is / vte) * exp(v / vte);
  return transitTime * gForward;
}

/**
 * Surface potential φ(T) and its use in the MOS body effect need √; exported
 * so devices stay on the core/math surface (SPEC §5.10).
 */
export function sqrtPositive(x: number): number {
  return sqrt(Math.max(x, 0));
}
