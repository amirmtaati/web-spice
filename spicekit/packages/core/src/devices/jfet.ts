/**
 * JFET Level 1 (SPEC §5.7) — a faithful port of ngspice jfetload.c (classic
 * SPICE2 equations; the Sydney-University mod degenerates to them at b=1):
 *
 *   Gate junctions (gate-source, gate-drain): IS diodes with emission
 *     coefficient N, ngspice reverse-generation branch, gmin in parallel.
 *   Channel (n-channel; VTO < 0 is the pinch-off voltage), normal mode
 *     (vds ≥ 0), vgst = vgs − VTO, betap = BETA·(1 + λ·vds):
 *     cutoff (vgst ≤ 0)         cdrain = 0
 *     saturation (vgst ≤ vds)   cdrain = betap·vgst²,  gm = 2·betap·vgst,
 *                               gds = λ·BETA·vgst²
 *     linear                    cdrain = betap·vds·(2·vgst − vds),
 *                               gm = 2·betap·vds,
 *                               gds = 2·betap·(vgst − vds) + λ·BETA·vds·(2·vgst − vds)
 *   Inverse mode (vds < 0) mirrors with vgdt = vgd − VTO (signs per ngspice).
 *   cd = cdrain − cgd (drain terminal), gate current = both junctions.
 *
 * Terminal stamp (RD = RS = 0; t = ±1 for njf/pjf):
 *   ceqgs = t·((cg − cgd) − ggs·vgs);  ceqgd = t·(cgd − ggd·vgd);
 *   cdreq = t·(cdrain − gds·vds − gm·vgs)
 *   b[g] += −ceqgs − ceqgd;  b[d] += −cdreq + ceqgd;  b[s] += cdreq + ceqgs
 *   A[g][g] += ggs+ggd  A[g][d] −= ggd   A[g][s] −= ggs
 *   A[d][d] += gds+ggd  A[d][g] += gm−ggd  A[d][s] −= gds+gm
 *   A[s][s] += gds+gm+ggs  A[s][g] −= ggs+gm  A[s][d] −= gds
 * (Every row sums to zero — the gate draws only junction leakage.)
 *
 * Limiting: pnjlim then fetlim on vgs and vgd (ngspice order, threshold-
 * relative fetlim). Depletion caps CGS/CGD with PB/MJ/FC.
 *
 * Temperature: evaluated at temp = tnom (scalings land later; exact at the
 * default 27 °C).
 */

import type { SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { abs, BOLTZMANN, celsiusToKelvin } from "../math/index.ts";
import type {
  AcStamp,
  Device,
  DeviceEnv,
  IntegrationMethod,
  MatrixStamp,
  NoiseSource,
} from "./base.ts";
import { nodePotential, stampCapacitanceAc } from "./base.ts";
import { JunctionCap, VC_SLOTS } from "./nonlinear/jcap.ts";
import {
  depletionCapacitance,
  diodeConduction,
  type JunctionCapacitance,
  thermalVoltage,
} from "./nonlinear/junction.ts";
import { fetlim, junctionVcrit, pnjlim } from "./nonlinear/limiting.ts";

// State: vgs/vgd used in the last stamp, then CGS and CGD cap blocks.
const VGS0 = 0;
const VGD0 = 1;
const CGS_OFF = 2;
const CGD_OFF = CGS_OFF + VC_SLOTS;
const JFET_STATE_SLOTS = 2 + 2 * VC_SLOTS;

interface JfetSolution {
  cdrain: number;
  gm: number;
  gds: number;
  /** Gate-source junction current/conductance (incl. gmin). */
  cgsJ: number;
  ggs: number;
  /** Gate-drain junction current/conductance (incl. gmin). */
  cgdJ: number;
  ggd: number;
  /** Total gate current (both junctions). */
  cg: number;
}

export function jfetDevice(ce: CompiledElement, options: SimOptions): Device {
  // Element node order: [drain, gate, source] (SPICE Jxxx D G S model).
  const dNode = ce.nodes[0] as number;
  const gNode = ce.nodes[1] as number;
  const sNode = ce.nodes[2] as number;
  const mp = ce.modelParams ?? {};
  const area = ce.area ?? 1;

  const type = ce.modelType === "pjf" ? -1 : 1;
  const vto = mp.vto ?? -2;
  const beta = (mp.beta ?? 1e-4) * area;
  const lambda = mp.lambda ?? 0;
  const isGate = (mp.is ?? 1e-14) * area;
  const nGate = mp.n ?? 1;
  const cgs0 = (mp.cgs ?? 0) * area;
  const cgd0 = (mp.cgd ?? 0) * area;
  const pb = mp.pb ?? 1;
  const mj = mp.m ?? 0.5;
  const fc = mp.fc ?? 0.5;
  const kf = mp.kf ?? 0;
  const af = mp.af ?? 1;

  const vt = thermalVoltage(options.temp);
  const vcrit = junctionVcrit(vt, isGate);
  const gmin = options.gmin;
  // ngspice tThreshold: the type-signed threshold in device coordinates.
  const threshold = type * vto;

  const capModel: JunctionCapacitance = { cj0: 0, vj: pb, m: mj, fc };
  // env.nodes = [drain, gate, source].
  const capGS = new JunctionCap("cgs", 1, 2, CGS_OFF);
  const capGD = new JunctionCap("cgd", 1, 0, CGD_OFF);

  /** Device-frame solution at (vgs, vgd). */
  const solveDc = (vgs: number, vgd: number): JfetSolution => {
    const gs = diodeConduction(vgs, { is: isGate, n: nGate, vt });
    const gd = diodeConduction(vgd, { is: isGate, n: nGate, vt });
    const cgsJ = gs.i + gmin * vgs;
    const ggs = gs.g + gmin;
    const cgdJ = gd.i + gmin * vgd;
    const ggd = gd.g + gmin;
    const vds = vgs - vgd;
    let cdrain = 0;
    let gm = 0;
    let gds = 0;
    // Device-frame threshold: type·VTO (njf: +VTO, pjf: −VTO).
    const vtoDev = type * vto;
    if (vds >= 0) {
      const vgst = vgs - vtoDev;
      if (vgst > 0) {
        const betap = beta * (1 + lambda * vds);
        if (vgst <= vds) {
          // saturation
          cdrain = betap * vgst * vgst;
          gm = 2 * betap * vgst;
          gds = lambda * beta * vgst * vgst;
        } else {
          // linear
          cdrain = betap * vds * (2 * vgst - vds);
          gm = 2 * betap * vds;
          gds = 2 * betap * (vgst - vds) + lambda * beta * vds * (2 * vgst - vds);
        }
      }
    } else {
      const vgdt = vgd - vtoDev;
      if (vgdt > 0) {
        const betap = beta * (1 - lambda * vds);
        if (vgdt <= -vds) {
          // saturation (inverse)
          cdrain = -betap * vgdt * vgdt;
          gm = -2 * betap * vgdt;
          gds = lambda * beta * vgdt * vgdt - gm;
        } else {
          // linear (inverse)
          cdrain = betap * vds * (2 * vgdt + vds);
          gm = 2 * betap * vds;
          gds = 2 * betap * vgdt - lambda * beta * vds * (2 * vgdt + vds);
        }
      }
    }
    return { cdrain, gm, gds, cgsJ, ggs, cgdJ, ggd, cg: cgsJ + cgdJ };
  };

  /** ngspice limiting: pnjlim then fetlim on both gate junctions. */
  const limitVoltages = (env: DeviceEnv): boolean => {
    const st = env.stateBase;
    const vgsOld = env.state[st + VGS0] as number;
    const vgdOld = env.state[st + VGD0] as number;
    const vG = type * nodePotential(env, 1);
    const vS = type * nodePotential(env, 2);
    const vD = type * nodePotential(env, 0);
    let vgs = vG - vS;
    let vgd = vG - vD;
    const rgs = pnjlim(vgs, vgsOld, vt, vcrit);
    const rgd = pnjlim(vgd, vgdOld, vt, vcrit);
    vgs = rgs.v;
    vgd = rgd.v;
    // fetlim uses the device threshold (type-signed).
    vgs = fetlim(vgs, vgsOld, threshold);
    vgd = fetlim(vgd, vgdOld, threshold);
    env.state[st + VGS0] = vgs;
    env.state[st + VGD0] = vgd;
    return rgs.limited || rgd.limited;
  };

  const stampDevice = (stamp: MatrixStamp, env: DeviceEnv): void => {
    const st = env.stateBase;
    const vgs = env.state[st + VGS0] as number;
    const vgd = env.state[st + VGD0] as number;
    const s = solveDc(vgs, vgd);
    const vds = vgs - vgd;
    const ceqgs = type * (s.cg - s.cgdJ - s.ggs * vgs);
    const ceqgd = type * (s.cgdJ - s.ggd * vgd);
    const cdreq = type * (s.cdrain - s.gds * vds - s.gm * vgs);
    if (gNode >= 0) {
      stamp.addRhs(gNode, -ceqgs - ceqgd);
      stamp.addA(gNode, gNode, s.ggs + s.ggd);
      if (dNode >= 0) {
        stamp.addA(gNode, dNode, -s.ggd);
      }
      if (sNode >= 0) {
        stamp.addA(gNode, sNode, -s.ggs);
      }
    }
    if (dNode >= 0) {
      stamp.addRhs(dNode, -cdreq + ceqgd);
      stamp.addA(dNode, dNode, s.gds + s.ggd);
      if (gNode >= 0) {
        stamp.addA(dNode, gNode, s.gm - s.ggd);
      }
      if (sNode >= 0) {
        stamp.addA(dNode, sNode, -s.gds - s.gm);
      }
    }
    if (sNode >= 0) {
      stamp.addRhs(sNode, cdreq + ceqgs);
      stamp.addA(sNode, sNode, s.gds + s.gm + s.ggs);
      if (gNode >= 0) {
        stamp.addA(sNode, gNode, -s.ggs - s.gm);
      }
      if (dNode >= 0) {
        stamp.addA(sNode, dNode, -s.gds);
      }
    }
  };

  return {
    name: ce.name,
    stateSlots: JFET_STATE_SLOTS,
    limit: limitVoltages,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      stampDevice(stamp, env);
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void {
      stampDevice(stamp, env);
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vgd = env.state[st + VGD0] as number;
      const cgsCap = cgs0 > 0 ? depletionCapacitance(vgs, { ...capModel, cj0: cgs0 }) : 0;
      const cgdCap = cgd0 > 0 ? depletionCapacitance(vgd, { ...capModel, cj0: cgd0 }) : 0;
      if (cgsCap > 0) {
        capGS.stampTran(stamp, env, h, method, cgsCap);
      }
      if (cgdCap > 0) {
        capGD.stampTran(stamp, env, h, method, cgdCap);
      }
    },
    stampAc(stamp: AcStamp, env: DeviceEnv, omega: number): void {
      // Small-signal at the OP: the y-matrix from the DC Jacobian plus the
      // gate depletion capacitances at the stored junction voltages.
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vgd = env.state[st + VGD0] as number;
      const s = solveDc(vgs, vgd);
      if (gNode >= 0) {
        stamp.addAc(gNode, gNode, s.ggs + s.ggd, 0);
        if (dNode >= 0) {
          stamp.addAc(gNode, dNode, -s.ggd, 0);
        }
        if (sNode >= 0) {
          stamp.addAc(gNode, sNode, -s.ggs, 0);
        }
      }
      if (dNode >= 0) {
        stamp.addAc(dNode, dNode, s.gds + s.ggd, 0);
        if (gNode >= 0) {
          stamp.addAc(dNode, gNode, s.gm - s.ggd, 0);
        }
        if (sNode >= 0) {
          stamp.addAc(dNode, sNode, -s.gds - s.gm, 0);
        }
      }
      if (sNode >= 0) {
        stamp.addAc(sNode, sNode, s.gds + s.gm + s.ggs, 0);
        if (gNode >= 0) {
          stamp.addAc(sNode, gNode, -s.ggs - s.gm, 0);
        }
        if (dNode >= 0) {
          stamp.addAc(sNode, dNode, -s.gds, 0);
        }
      }
      const cgsCap = cgs0 > 0 ? depletionCapacitance(vgs, { ...capModel, cj0: cgs0 }) : 0;
      const cgdCap = cgd0 > 0 ? depletionCapacitance(vgd, { ...capModel, cj0: cgd0 }) : 0;
      stampCapacitanceAc(stamp, gNode, sNode, cgsCap, omega);
      stampCapacitanceAc(stamp, gNode, dNode, cgdCap, omega);
    },
    noise(env: DeviceEnv, freqHz: number): NoiseSource[] {
      // Channel thermal noise (8/3)kT·gm (ngspice jfet, b = 1 shot term is
      // zero for the gate at DC reverse bias) plus flicker on Id.
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vgd = env.state[st + VGD0] as number;
      const s = solveDc(vgs, vgd);
      const sources: NoiseSource[] = [
        {
          p: dNode,
          n: sNode,
          psd: (8 / 3) * BOLTZMANN * celsiusToKelvin(options.temp) * Math.max(s.gm, 0),
        },
      ];
      if (kf > 0 && s.cdrain > 0) {
        sources.push({
          p: dNode,
          n: sNode,
          psd: (kf * s.cdrain ** af) / Math.max(freqHz, 1e-6),
        });
      }
      return sources;
    },
    accept(env: DeviceEnv): void {
      capGS.accept(env);
      capGD.accept(env);
    },
    lte(env: DeviceEnv, _h: number): number {
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vgd = env.state[st + VGD0] as number;
      const cgsCap = cgs0 > 0 ? depletionCapacitance(vgs, { ...capModel, cj0: cgs0 }) : 0;
      const cgdCap = cgd0 > 0 ? depletionCapacitance(vgd, { ...capModel, cj0: cgd0 }) : 0;
      return capGS.lte(env, cgsCap) + capGD.lte(env, cgdCap);
    },
    lteUnit: "A",
    lteMagnitude(env: DeviceEnv): number {
      return abs(capGS.lteMagnitude(env)) + abs(capGD.lteMagnitude(env));
    },
  };
}
