/**
 * Diode (SPEC §5.7): Shockley junction with series resistance, ngspice-style
 * reverse generation current, matched-knee breakdown (Zener/avalanche),
 * junction + diffusion capacitance, area scaling, temperature-dependent
 * saturation current, and pnjlim junction limiting between iterations.
 *
 * Branch conventions:
 *  - v = v(anode) − v(cathode); junction current i_j flows anode→cathode.
 *  - Series resistance RS is folded into the terminal stamp by linearizing
 *    the composite map i(v) = f(v − i·RS) at each iterate (exact for the
 *    linearized system; avoids an internal MNA node):
 *      G_c = g/(1 + g·RS),  i ≈ i0 + G_c·(v − v0),  J_c = G_c·v0 − i0.
 *  - gmin sits in parallel with the junction (SPICE CKTgmin semantics).
 *  - Capacitances integrate via the shared JunctionCap companion; the RS
 *    drop is applied to the DC junction component only (ngspice-44 stamps
 *    RS through an internal node — approximation documented for E2).
 *
 * Temperature (SPICE2, Massobrio ch. 2): Is(T) = Is(Tn)·(T/Tn)^(XTI)·
 * exp(q·EG/k·(1/TnK − 1/TK)). At temp = tnom the factor is exactly 1.
 */

import type { SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { abs, BOLTZMANN, CHARGE, celsiusToKelvin, exp } from "../math/index.ts";
import type { Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { branchVoltage, pokeJunctionVoltage, stampConductance } from "./base.ts";
import { JunctionCap, VC_SLOTS } from "./nonlinear/jcap.ts";
import {
  type DiodeJunction,
  depletionCapacitance,
  diffusionCapacitance,
  diodeConduction,
  type JunctionCapacitance,
  thermalVoltage,
} from "./nonlinear/junction.ts";
import { junctionVcrit, pnjlim } from "./nonlinear/limiting.ts";

// State layout: slot 0 = junction voltage used in the last stamp (limiting),
// then one JunctionCap block each for depletion and diffusion capacitance.
const VJ = 0;
const CJ_OFF = 1;
const CD_OFF = CJ_OFF + VC_SLOTS;
const DIODE_STATE_SLOTS = 1 + 2 * VC_SLOTS;

export function diodeDevice(ce: CompiledElement, options: SimOptions): Device {
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  const mp = ce.modelParams ?? {};
  const area = ce.area ?? 1;

  const is0 = (mp.is ?? 1e-14) * area;
  const rs = mp.rs ?? 0;
  const nEmission = mp.n ?? 1;
  const bv = mp.bv;
  const ibv = (mp.ibv ?? 1e-3) * area;
  const cj0 = (mp.cjo ?? mp.cj0 ?? 0) * area;
  const mGrade = mp.m ?? 0.5;
  const vj = mp.vj ?? 1;
  const fc = mp.fc ?? 0.5;
  const tt = mp.tt ?? 0;
  const eg = mp.eg ?? 1.11;
  const xti = mp.xti ?? 3;

  // Saturation current at the run temperature (tnom from options).
  const tK = celsiusToKelvin(options.temp);
  const tnK = celsiusToKelvin(options.tnom);
  const isTemp =
    is0 * (tK / tnK) ** xti * exp(((CHARGE * eg) / (BOLTZMANN * nEmission)) * (1 / tnK - 1 / tK));

  const junction: DiodeJunction = {
    is: isTemp,
    n: nEmission,
    vt: thermalVoltage(options.temp),
    ...(bv !== undefined ? { bv } : {}),
    ...(bv !== undefined ? { ibv } : {}),
  };
  const capModel: JunctionCapacitance = { cj0, vj, m: mGrade, fc };
  const vcrit = junctionVcrit(junction.vt, isTemp);
  const gmin = options.gmin;

  const jCap = new JunctionCap("cdep", 0, 1, CJ_OFF);
  const dCap = new JunctionCap("cdif", 0, 1, CD_OFF);

  /**
   * Junction response including the gmin shunt, at junction voltage vj.
   * f(vj) = i_junction(vj) + gmin·vj — the current the junction block sinks.
   */
  const junctionBlock = (vj: number): { i: number; g: number } => {
    const c = diodeConduction(vj, junction);
    return { i: c.i + gmin * vj, g: c.g + gmin };
  };

  /**
   * Solve the composite scalar equation vj + f(vj)·RS = v for the internal
   * junction voltage (the internal-node formulation solved in place — no
   * extra MNA unknown). h(vj) = vj + f(vj)·RS − v has h′ = 1 + f′·RS > 0,
   * so Newton is unconditionally stable; 4 iterations from the previous
   * junction voltage converge to machine precision for every region
   * (off / exponential / breakdown).
   */
  const junctionVoltageAt = (v: number, seed: number): number => {
    if (rs <= 0) {
      return v;
    }
    let vj = seed;
    for (let k = 0; k < 4; k++) {
      const f = junctionBlock(vj);
      const h = vj + f.i * rs - v;
      const hp = 1 + f.g * rs;
      vj -= h / hp;
    }
    return vj;
  };

  /**
   * Composite terminal response at terminal voltage v: exact derivative of
   * the implicit map i(v) (di/dv = f′/(1 + f′·RS)) and the Newton current
   * i(v) evaluated at the solved junction voltage. This is precisely the
   * stamp an internal RS node would produce, minus the unknown.
   */
  const dcStampAt = (v: number, seed: number): { g: number; j: number; vjUsed: number } => {
    const vj = junctionVoltageAt(v, seed);
    const f = junctionBlock(vj);
    const gC = f.g / (1 + f.g * rs);
    const i0 = (f.i + f.g * (v - vj)) / (1 + f.g * rs);
    return { g: gC, j: gC * v - i0, vjUsed: vj };
  };

  return {
    name: ce.name,
    stateSlots: DIODE_STATE_SLOTS,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      const v = branchVoltage(env, 0, 1);
      const { g, j, vjUsed } = dcStampAt(v, env.state[VJ] as number);
      env.state[VJ] = vjUsed;
      stampConductance(stamp, p, n, g);
      if (p >= 0) {
        stamp.addRhs(p, j);
      }
      if (n >= 0) {
        stamp.addRhs(n, -j);
      }
    },
    limit(env: DeviceEnv): boolean {
      const vTerm = branchVoltage(env, 0, 1);
      const vjOld = env.state[VJ] as number;
      // With series resistance the limiting must act on the JUNCTION voltage
      // (SPICE2 limits the internal junction, not the terminals): solve the
      // composite scalar for the junction voltage the fresh iterate implies,
      // clamp in junction space, then write the terminal back with the
      // consistent resistive drop.
      const vjNew = junctionVoltageAt(vTerm, vjOld);
      const drop = vTerm - vjNew;
      const r = pnjlim(vjNew, vjOld, junction.vt, vcrit);
      env.state[VJ] = r.v;
      if (r.limited) {
        pokeJunctionVoltage(env, 0, 1, r.v + drop);
        return true;
      }
      return false;
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method): void {
      const v = branchVoltage(env, 0, 1);
      const { g, j, vjUsed } = dcStampAt(v, env.state[VJ] as number);
      env.state[VJ] = vjUsed; // keep the limiting reference fresh in tran too
      stampConductance(stamp, p, n, g);
      if (p >= 0) {
        stamp.addRhs(p, j);
      }
      if (n >= 0) {
        stamp.addRhs(n, -j);
      }
      const cDep = depletionCapacitance(v, capModel);
      const cDif = diffusionCapacitance(v, tt, junction);
      if (cDep > 0) {
        jCap.stampTran(stamp, env, h, method, cDep);
      }
      if (cDif > 0) {
        dCap.stampTran(stamp, env, h, method, cDif);
      }
    },
    accept(env: DeviceEnv): void {
      const v = branchVoltage(env, 0, 1);
      const cDep = depletionCapacitance(v, capModel);
      const cDif = diffusionCapacitance(v, tt, junction);
      if (cDep > 0) {
        jCap.accept(env);
      }
      if (cDif > 0) {
        dCap.accept(env);
      }
    },
    lte(env: DeviceEnv, _h: number): number {
      const v = branchVoltage(env, 0, 1);
      const cDep = depletionCapacitance(v, capModel);
      const cDif = diffusionCapacitance(v, tt, junction);
      return jCap.lte(env, cDep) + dCap.lte(env, cDif);
    },
    lteUnit: "A",
    lteMagnitude(env: DeviceEnv): number {
      return abs(jCap.lteMagnitude(env)) + abs(dCap.lteMagnitude(env));
    },
  };
}
