/**
 * MOSFET Level 1 — Shichman-Hodges (SPEC §5.7), a faithful port of ngspice
 * mos1load.c with the same conventions:
 *
 *   sarg  = sqrt(PHI − vbs)            (vbs ≤ 0)
 *         = sqrt(PHI) − vbs/(2·sqrt(PHI)), clamped ≥ 0   (vbs > 0)
 *   von   = type·VTO − GAMMA·sqrt(PHI) + GAMMA·sarg     (body effect)
 *   vgst  = (mode>0 ? vgs : vgd) − von;  vdsat = max(vgst, 0)
 *   betap = KP·(W/L)·(1 + λ·vds·mode)
 *   cutoff (vgst ≤ 0):        cdrain = 0
 *   saturation (vgst ≤ vds·mode): cdrain = betap·vgst²/2,
 *                             gm = betap·vgst, gds = λ·KP·(W/L)·vgst²/2
 *   linear:                   cdrain = betap·(vds·mode)·(vgst − vds·mode/2),
 *                             gm = betap·(vds·mode),
 *                             gds = betap·(vgst − vds·mode) + λ·KP·(W/L)·vds·mode·(vgst − vds·mode/2)
 *   gmbs = gm·GAMMA/(2·sarg)  (arg = 0 when sarg = 0)
 *   cd    = mode·cdrain − cbd (drain terminal current)
 *
 * Bulk diodes (d-b, s-b) are ideal junctions with IS + gmin; junction
 * capacitances CBD/CBS use the depletion law (PB, MJ, FC); Meyer gate caps
 * (ngspice DEVqmeyer, MAGIC_VDS = 25 mV) plus CGSO/CGDO/CGBO overlaps when
 * TOX is given. Limiting: fetlim on vgs/vgd (threshold-relative), pnjlim on
 * vbs/vbd, with limvds keeping the drain-source step consistent — the exact
 * ngspice sequence.
 *
 * Temperature: evaluated at temp = tnom (scalings land with the temperature
 * milestone; exact at the default 27 °C).
 */

import type { SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { abs } from "../math/index.ts";
import type { Device, DeviceEnv, IntegrationMethod, MatrixStamp } from "./base.ts";
import { nodePotential } from "./base.ts";
import { JunctionCap, VC_SLOTS } from "./nonlinear/jcap.ts";
import {
  depletionCapacitance,
  diodeConduction,
  type JunctionCapacitance,
  thermalVoltage,
} from "./nonlinear/junction.ts";
import { fetlim, junctionVcrit, limvds, pnjlim } from "./nonlinear/limiting.ts";

// Junction states (ngspice order: vbs, vbd, vgs, vds), then cap blocks.
const VBS0 = 0;
const VBD0 = 1;
const VGS0 = 2;
const VDS0 = 3;
const CBS_OFF = 4;
const CBD_OFF = CBS_OFF + VC_SLOTS;
const CGS_OFF = CBD_OFF + VC_SLOTS;
const CGD_OFF = CGS_OFF + VC_SLOTS;
const CGB_OFF = CGD_OFF + VC_SLOTS;
const MOS_STATE_SLOTS = 4 + 5 * VC_SLOTS;

const MAGIC_VDS = 0.025;
const DEFAULT_W = 100e-6;
const DEFAULT_L = 100e-6;

export function mosfetDevice(ce: CompiledElement, options: SimOptions): Device {
  // Element node order: [drain, gate, source, bulk] (SPICE Mxxx D G S B).
  const dNode = ce.nodes[0] as number;
  const gNode = ce.nodes[1] as number;
  const sNode = ce.nodes[2] as number;
  const bNode = ce.nodes[3] as number;
  const mp = ce.modelParams ?? {};

  const type = ce.modelType === "pmos" ? -1 : 1;
  const vto = mp.vto ?? 0;
  const kp = mp.kp ?? 2e-5;
  const gamma = mp.gamma ?? 0;
  const phi = mp.phi ?? 0.6;
  const lambda = mp.lambda ?? 0;
  const tox = mp.tox;
  const cgso = mp.cgso ?? 0;
  const cgdo = mp.cgdo ?? 0;
  const cgbo = mp.cgbo ?? 0;
  const isBulk = mp.is ?? 1e-14;
  const nBulk = mp.n ?? 1;
  const cbd = (mp.cbd ?? 0) * 1;
  const cbs = (mp.cbs ?? 0) * 1;
  const pb = mp.pb ?? 0.8;
  const mj = mp.mj ?? 0.5;
  const fc = mp.fc ?? 0.5;

  const w = ce.w ?? DEFAULT_W;
  const l = ce.l ?? DEFAULT_L;
  const beta = (kp * w) / l;

  const vt = thermalVoltage(options.temp);
  const vcrit = junctionVcrit(vt, isBulk);
  const gmin = options.gmin;
  const sqPhi = Math.sqrt(phi);
  // ngspice tVbi·type at temp = tnom: von = type·VTO − γ·√PHI + γ·sarg.
  const vbi = type * vto - gamma * sqPhi;

  const bulkCap: JunctionCapacitance = { cj0: 0, vj: pb, m: mj, fc };
  const capS = new JunctionCap("cbs", 2, 3, CBS_OFF);
  const capD = new JunctionCap("cbd", 0, 3, CBD_OFF);
  const capGS = new JunctionCap("cgs", 1, 2, CGS_OFF);
  const capGD = new JunctionCap("cgd", 1, 0, CGD_OFF);
  const capGB = new JunctionCap("cgb", 1, 3, CGB_OFF);

  interface MosSolution {
    von: number;
    vdsat: number;
    cdrain: number;
    gm: number;
    gds: number;
    gmbs: number;
    cbs: number;
    gbs: number;
    cbd: number;
    gbd: number;
  }

  /** Shichman-Hodges solution at bulk-junction voltages (device polarity). */
  const solveDc = (vgs: number, vds: number, vbs: number): MosSolution => {
    const sarg =
      vbs <= 0 ? Math.sqrt(Math.max(phi - vbs, 0)) : Math.max(sqPhi - vbs / (2 * sqPhi), 0);
    const von = vbi + gamma * sarg; // type-signed threshold
    const vgd = vgs - vds;
    const vbdVal = vbs - vds;
    const mode = vds >= 0 ? 1 : -1;
    const vde = vds * mode;
    const vdrive = mode > 0 ? vgs : vgd;
    const vgst = vdrive - von;
    const arg = sarg > 0 ? gamma / (2 * sarg) : 0;
    let cdrain = 0;
    let gm = 0;
    let gds = 0;
    if (vgst > 0) {
      const betap = beta * (1 + lambda * vde);
      if (vgst <= vde) {
        // saturation
        cdrain = (betap * vgst * vgst) / 2;
        gm = betap * vgst;
        gds = (lambda * beta * vgst * vgst) / 2;
      } else {
        // linear (triode)
        cdrain = betap * vde * (vgst - vde / 2);
        gm = betap * vde;
        gds = betap * (vgst - vde) + lambda * beta * vde * (vgst - vde / 2);
      }
    }
    const gmbs = gm * arg;
    // Bulk diodes with gmin (ngspice includes CKTgmin in both branches).
    const sb = diodeConduction(vbs, { is: isBulk, n: nBulk, vt });
    const db = diodeConduction(vbdVal, { is: isBulk, n: nBulk, vt });
    return {
      von,
      vdsat: Math.max(vgst, 0),
      cdrain,
      gm,
      gds,
      gmbs,
      cbs: sb.i + gmin * vbs,
      gbs: sb.g + gmin,
      cbd: db.i + gmin * vbdVal,
      gbd: db.g + gmin,
    };
  };

  /** Meyer + overlap gate capacitances (F) at the current iterate. */
  const gateCaps = (vgs: number, vgd: number, s: MosSolution): [number, number, number] => {
    const overlapGS = cgso * w;
    const overlapGD = cgdo * w;
    const overlapGB = cgbo * l;
    if (tox === undefined || tox <= 0) {
      return [overlapGS, overlapGD, overlapGB];
    }
    // ngspice DEVqmeyer with Cox = (εox/TOX)·W·Leff (latDiff = 0).
    const oxideCap = ((3.9 * 8.854214871e-12) / tox) * w * l;
    const phiV = phi;
    const vdsat = Math.max(s.vdsat, MAGIC_VDS);
    let cgs = 0;
    let cgd = 0;
    let cgb = 0;
    const vgst = vgs - s.von;
    const vds = vgs - vgd;
    if (vgst <= -phiV) {
      cgb = oxideCap / 2;
    } else if (vgst <= -phiV / 2) {
      cgb = (-vgst * oxideCap) / (2 * phiV);
    } else if (vgst <= 0) {
      cgb = (-vgst * oxideCap) / (2 * phiV);
      cgs = (vgst * oxideCap) / (1.5 * phiV) + oxideCap / 3;
      if (vds < vdsat) {
        const vddif = 2 * vdsat - vds;
        const vddif1 = vdsat - vds;
        const vddif2 = vddif * vddif;
        cgd = cgs * (1 - (vdsat * vdsat) / vddif2);
        cgs = cgs * (1 - (vddif1 * vddif1) / vddif2);
      }
    } else if (vdsat <= vds) {
      cgs = oxideCap / 3;
    } else {
      const vddif = 2 * vdsat - vds;
      const vddif1 = vdsat - vds;
      const vddif2 = vddif * vddif;
      cgd = (oxideCap * (1 - (vdsat * vdsat) / vddif2)) / 3;
      cgs = (oxideCap * (1 - (vddif1 * vddif1) / vddif2)) / 3;
    }
    // Clamp negatives: the Meyer interpolation dips below zero when
    // vds crosses vdsat (1 − vdsat²/vddif² < 0), and a negative capacitance
    // creates energy — the standard practical guard.
    return [
      Math.max(cgs, 0) + overlapGS,
      Math.max(cgd, 0) + overlapGD,
      Math.max(cgb, 0) + overlapGB,
    ];
  };

  /** ngspice limiting sequence for the four junction/drive voltages. */
  const limitVoltages = (env: DeviceEnv): boolean => {
    const st = env.stateBase;
    const vbsOld = env.state[st + VBS0] as number;
    const vbdOld = env.state[st + VBD0] as number;
    const vgsOld = env.state[st + VGS0] as number;
    const vdsOld = env.state[st + VDS0] as number;
    // Fresh iterates from the node potentials (type-mirrored to the
    // device's own polarity).
    const vG = type * nodePotential(env, 1);
    const vS = type * nodePotential(env, 2);
    const vB = type * nodePotential(env, 3);
    const vD = type * nodePotential(env, 0);
    let vgs = vG - vS;
    let vds = vD - vS;
    let vbs = vB - vS;
    let vgd = vgs - vds;
    let vbd = vbs - vds;
    // von from the previous state for fetlim (type-signed).
    const sPrev = solveDc(vgsOld, vdsOld, vbsOld);
    const vonLim = sPrev.von;
    if (vdsOld >= 0) {
      vgs = fetlim(vgs, vgsOld, vonLim);
      vds = vgs - vgd;
      vds = limvds(vds, vdsOld);
      vgd = vgs - vds;
    } else {
      vgd = fetlim(vgd, vgsOld - vdsOld, vonLim);
      vds = vgs - vgd;
      vds = -limvds(-vds, -vdsOld);
      vgs = vgd + vds;
    }
    let limited = false;
    if (vds >= 0) {
      const r = pnjlim(vbs, vbsOld, vt, vcrit);
      vbs = r.v;
      limited = limited || r.limited;
      vbd = vbs - vds;
    } else {
      const r = pnjlim(vbd, vbdOld, vt, vcrit);
      vbd = r.v;
      limited = limited || r.limited;
      vbs = vbd + vds;
    }
    env.state[st + VBS0] = vbs;
    env.state[st + VBD0] = vbd;
    env.state[st + VGS0] = vgs;
    env.state[st + VDS0] = vds;
    return limited;
  };

  return {
    name: ce.name,
    stateSlots: MOS_STATE_SLOTS,
    limit: limitVoltages,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      stampChannel(stamp, env, dNode, gNode, sNode, bNode, type, beta, lambda, solveDc);
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void {
      stampChannel(stamp, env, dNode, gNode, sNode, bNode, type, beta, lambda, solveDc);
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vds = env.state[st + VDS0] as number;
      const vbs = env.state[st + VBS0] as number;
      const vbd = env.state[st + VBD0] as number;
      const s = solveDc(vgs, vds, vbs);
      // Bulk junction capacitances (depletion law).
      const cbsCap = cbs > 0 ? depletionCapacitance(vbs, { ...bulkCap, cj0: cbs }) : 0;
      const cbdCap = cbd > 0 ? depletionCapacitance(vbd, { ...bulkCap, cj0: cbd }) : 0;
      if (cbsCap > 0) {
        capS.stampTran(stamp, env, h, method, cbsCap);
      }
      if (cbdCap > 0) {
        capD.stampTran(stamp, env, h, method, cbdCap);
      }
      // Meyer + overlap gate caps at the current iterate.
      const vgd = vgs - vds;
      const [cgs, cgd, cgb] = gateCaps(vgs, vgd, s);
      if (cgs > 0) {
        capGS.stampTran(stamp, env, h, method, cgs);
      }
      if (cgd > 0) {
        capGD.stampTran(stamp, env, h, method, cgd);
      }
      if (cgb > 0) {
        capGB.stampTran(stamp, env, h, method, cgb);
      }
    },
    accept(env: DeviceEnv): void {
      capS.accept(env);
      capD.accept(env);
      capGS.accept(env);
      capGD.accept(env);
      capGB.accept(env);
    },
    lte(env: DeviceEnv, _h: number): number {
      const st = env.stateBase;
      const vgs = env.state[st + VGS0] as number;
      const vds = env.state[st + VDS0] as number;
      const vbs = env.state[st + VBS0] as number;
      const vbd = env.state[st + VBD0] as number;
      const cbsCap = cbs > 0 ? depletionCapacitance(vbs, { ...bulkCap, cj0: cbs }) : 0;
      const cbdCap = cbd > 0 ? depletionCapacitance(vbd, { ...bulkCap, cj0: cbd }) : 0;
      // Gate caps participate in the LTE signal — without them the controller
      // is blind to CMOS switching events and trapezoidal ringing survives.
      const s = solveDc(vgs, vds, vbs);
      const [cgs, cgd, cgb] = gateCaps(vgs, vgs - vds, s);
      return (
        capS.lte(env, cbsCap) +
        capD.lte(env, cbdCap) +
        capGS.lte(env, cgs) +
        capGD.lte(env, cgd) +
        capGB.lte(env, cgb)
      );
    },
    lteUnit: "A",
    lteMagnitude(env: DeviceEnv): number {
      return (
        abs(capS.lteMagnitude(env)) +
        abs(capD.lteMagnitude(env)) +
        abs(capGS.lteMagnitude(env)) +
        abs(capGD.lteMagnitude(env)) +
        abs(capGB.lteMagnitude(env))
      );
    },
  };
}

/** Minimal MOS solution view used by the terminal stamp helper. */
interface MosStampSolution {
  cdrain: number;
  gm: number;
  gds: number;
  gmbs: number;
  cbs: number;
  gbs: number;
  cbd: number;
  gbd: number;
}

type MosSolve = (vgs: number, vds: number, vbs: number) => MosStampSolution;

/**
 * Terminal stamp from the stored (limited) junction states — the ngspice
 * mos1load y-matrix and rhs with drain/source conductances = 0 (no ohmic
 * resistances on L1 MOSFETs; RD/RS land with the subcircuit milestone).
 * Mode (vds ≥ 0 normal / < 0 inverse) selects the xnrm/xrev row variants.
 */
function stampChannel(
  stamp: MatrixStamp,
  env: DeviceEnv,
  dNode: number,
  gNode: number,
  sNode: number,
  bNode: number,
  type: number,
  _beta: number,
  _lambda: number,
  solveDc: MosSolve,
): void {
  void _beta;
  void _lambda;
  const st = env.stateBase;
  const vgs = env.state[st + VGS0] as number;
  const vds = env.state[st + VDS0] as number;
  const vbs = env.state[st + VBS0] as number;
  const vbd = env.state[st + VBD0] as number;
  const s = solveDc(vgs, vds, vbs);
  const mode = vds >= 0 ? 1 : -1;
  const xnrm = mode >= 0 ? 1 : 0;
  const xrev = mode >= 0 ? 0 : 1;
  const vgd = vgs - vds;
  // cdreq = i0 − G·v0 in the device's own polarity (ngspice cdreq).
  const cdreq =
    mode >= 0
      ? type * (s.cdrain - s.gds * vds - s.gm * vgs - s.gmbs * vbs)
      : -(type * (s.cdrain - s.gds * -vds - s.gm * vgd - s.gmbs * vbd));
  const ceqbs = type * (s.cbs - s.gbs * vbs);
  const ceqbd = type * (s.cbd - s.gbd * vbd);

  // RHS (b in A·x = b): ngspice rhs[node] += contributions.
  if (gNode >= 0) {
    stamp.addRhs(gNode, -type * 0); // gate: caps only in transient (below)
  }
  if (bNode >= 0) {
    stamp.addRhs(bNode, -(ceqbs + ceqbd));
  }
  if (dNode >= 0) {
    stamp.addRhs(dNode, ceqbd - cdreq);
  }
  if (sNode >= 0) {
    stamp.addRhs(sNode, cdreq + ceqbs);
  }
  // y matrix.
  const gmT = (xnrm - xrev) * s.gm;
  const gmbsT = (xnrm - xrev) * s.gmbs;
  if (bNode >= 0) {
    stamp.addA(bNode, bNode, s.gbd + s.gbs);
    if (dNode >= 0) {
      stamp.addA(bNode, dNode, -s.gbd);
    }
    if (sNode >= 0) {
      stamp.addA(bNode, sNode, -s.gbs);
    }
  }
  if (dNode >= 0) {
    stamp.addA(dNode, dNode, s.gds + s.gbd + xrev * (s.gm + s.gmbs));
    if (gNode >= 0) {
      stamp.addA(dNode, gNode, gmT);
    }
    if (bNode >= 0) {
      stamp.addA(dNode, bNode, -s.gbd + gmbsT);
    }
    if (sNode >= 0) {
      stamp.addA(dNode, sNode, -s.gds - xnrm * (s.gm + s.gmbs));
    }
  }
  if (sNode >= 0) {
    stamp.addA(sNode, sNode, s.gds + s.gbs + xnrm * (s.gm + s.gmbs));
    if (gNode >= 0) {
      stamp.addA(sNode, gNode, -gmT);
    }
    if (bNode >= 0) {
      stamp.addA(sNode, bNode, -s.gbs - gmbsT);
    }
    if (dNode >= 0) {
      stamp.addA(sNode, dNode, -s.gds - xrev * (s.gm + s.gmbs));
    }
  }
}
