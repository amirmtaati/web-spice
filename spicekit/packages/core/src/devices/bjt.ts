/**
 * BJT (SPEC §5.7): SPICE2 Gummel-Poon reduced to its Ebers-Moll core —
 * transport formulation with the Early-effect base-charge factor q1, NPN/PNP
 * via voltage mirroring, junction + diffusion capacitance, gmin on both
 * junctions, and pnjlim limiting on vbe/vbc. Ohmic RB/RC/RE fold into the
 * terminal stamp through the exact composite linearization (the internal
 * prime-node system solved in place; see solveComposite below).
 *
 * Equations follow ngspice bjtload.c (defaults: ISE=ISC=IKF=IKR=0):
 *
 *   cbe = IS·(e^(vbe/(NF·vt)) − 1)      gbe = ∂cbe/∂vbe
 *   cbc = IS·(e^(vbc/(NR·vt)) − 1)      gbc = ∂cbc/∂vbc
 *   q1  = 1/(1 − vbc/VAF − vbe/VAR)     (Early; ∞ ⇒ q1 = 1)
 *   cc  = (cbe − cbc)/q1 − cbc/BR       (collector current, into C)
 *   cb  = cbe/BF + cbc/BR               (base current, into B)
 *   gpi = gbe/BF    gmu = gbc/BR
 *   go  = (gbc + (cbe − cbc)·q1²·invVAF)/q1
 *   gm  = (gbe − (cbe − cbc)·q1²·invVAR)/q1 − go
 *
 * Terminal stamp (t = ±1 for npn/pnp; identical Jacobian both polarities):
 *   gBB = grf+grr  gBC = −grr  gBE = −grf          (base row)
 *   gCB = gff+gfr  gCC = −gfr  gCE = −gff          (collector row)
 *   gEk = −(gBk + gCk)                             (emitter = −B − C)
 *   iB0 = t·cb   iC0 = t·cc   iE0 = −t·(cb + cc)
 *   A[k][j] += gKj;  b[k] += −(iK0 − Σ_j gKj·v0_j)
 *
 * PNP mirrors voltages (vbe ← −vbe) and negates the currents; the chain
 * rule leaves the Jacobian stamps unchanged — exactly ngspice's structure.
 *
 * Temperature: evaluated at temp = tnom (SPICE2 scalings land with the
 * temperature milestone; at the default 27 °C this is exact).
 */

import type { SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { abs } from "../math/index.ts";
import type { Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { nodePotential } from "./base.ts";
import { JunctionCap, VC_SLOTS } from "./nonlinear/jcap.ts";
import {
  depletionCapacitance,
  diffusionCapacitance,
  diodeConduction,
  type JunctionCapacitance,
  thermalVoltage,
} from "./nonlinear/junction.ts";
import { junctionVcrit, pnjlim } from "./nonlinear/limiting.ts";

// State: vbe/vbc (internal, npn-reference) used in the last stamp, then one
// cap block each for BE junction, BE diffusion (TF), BC junction, BC
// diffusion (TR).
const VBE0 = 0;
const VBC0 = 1;
const CBE_OFF = 2;
const CBE_DIF_OFF = CBE_OFF + VC_SLOTS;
const CBC_OFF = CBE_DIF_OFF + VC_SLOTS;
const CBC_DIF_OFF = CBC_OFF + VC_SLOTS;
const BJT_STATE_SLOTS = 2 + 4 * VC_SLOTS;

interface BjtJunction {
  is: number;
  n: number;
  vt: number;
}

interface BjtSolution {
  cc: number;
  cb: number;
  gpi: number;
  gmu: number;
  go: number;
  gm: number;
}

export function bjtDevice(ce: CompiledElement, options: SimOptions): Device {
  // Element node order: [collector, base, emitter] (SPICE Qxxx C B E model).
  const cNode = ce.nodes[0] as number;
  const bNode = ce.nodes[1] as number;
  const eNode = ce.nodes[2] as number;
  const mp = ce.modelParams ?? {};
  const area = ce.area ?? 1;

  const type = ce.modelType === "pnp" ? -1 : 1;
  const is = (mp.is ?? 1e-16) * area;
  const bf = mp.bf ?? 100;
  const br = mp.br ?? 1;
  const nf = mp.nf ?? 1;
  const nr = mp.nr ?? 1;
  const vaf = mp.vaf ?? Number.POSITIVE_INFINITY;
  const vrb = mp.var ?? Number.POSITIVE_INFINITY;
  const rb = mp.rb ?? 0;
  const rc = mp.rc ?? 0;
  const re = mp.re ?? 0;
  const cje = (mp.cje ?? 0) * area;
  const vje = mp.vje ?? 0.75;
  const mje = mp.mje ?? 0.33;
  const cjc = (mp.cjc ?? 0) * area;
  const vjc = mp.vjc ?? 0.75;
  const mjc = mp.mjc ?? 0.33;
  const tf = mp.tf ?? 0;
  const tr = mp.tr ?? 0;
  const fc = mp.fc ?? 0.5;

  const vt = thermalVoltage(options.temp);
  const beJunction: BjtJunction = { is, n: nf, vt };
  const bcJunction: BjtJunction = { is, n: nr, vt };
  const invVaf = Number.isFinite(vaf) ? 1 / vaf : 0;
  const invVrb = Number.isFinite(vrb) ? 1 / vrb : 0;
  const vcrit = junctionVcrit(vt, is);
  const gmin = options.gmin;
  const hasR = rb > 0 || rc > 0 || re > 0;

  const beCapModel: JunctionCapacitance = { cj0: cje, vj: vje, m: mje, fc };
  const bcCapModel: JunctionCapacitance = { cj0: cjc, vj: vjc, m: mjc, fc };
  // Cap positions inside env.nodes = [collector, base, emitter].
  const beCap = new JunctionCap("cbe", 1, 2, CBE_OFF);
  const beDif = new JunctionCap("cbe-dif", 1, 2, CBE_DIF_OFF);
  const bcCap = new JunctionCap("cbc", 1, 0, CBC_OFF);
  const bcDif = new JunctionCap("cbc-dif", 1, 0, CBC_DIF_OFF);

  /** DC junction solution at internal (vbe, vbc) — npn reference. */
  const solveDc = (vbe: number, vbc: number): BjtSolution => {
    const be = diodeConduction(vbe, beJunction);
    const bc = diodeConduction(vbc, bcJunction);
    const cbe = be.i + gmin * vbe;
    const gbe = be.g + gmin;
    const cbc = bc.i + gmin * vbc;
    const gbc = bc.g + gmin;
    const q1 = 1 / (1 - invVaf * vbc - invVrb * vbe);
    const cc = (cbe - cbc) / q1 - cbc / br;
    const cb = cbe / bf + cbc / br;
    const gpi = gbe / bf;
    const gmu = gbc / br;
    const go = (gbc + (cbe - cbc) * q1 * q1 * invVaf) / q1;
    const gm = (gbe - (cbe - cbc) * q1 * q1 * invVrb) / q1 - go;
    return { cc, cb, gpi, gmu, go, gm };
  };

  interface Composite {
    s: BjtSolution;
    gff: number; // ∂ic/∂vbe  (terminal, composite)
    gfr: number; // ∂ic/∂vbc
    grf: number; // ∂ib/∂vbe
    grr: number; // ∂ib/∂vbc
    vbeInt: number;
    vbcInt: number;
  }

  /**
   * Solve the BJT at terminal voltages (vbe, vbc) with ohmic RB/RC/RE.
   * Without resistors this is solveDc directly. With them, the internal
   * junction voltages obey v_int = v − M·i with
   *   M = [[RE, RB+RE], [−RC, RB]]  wrt (ic, ib),
   * solved by Newton on h(z) = z + M·F(z) − v (2×2 system, positive-definite
   * for physical parameters — emitter degeneration only strengthens the
   * diagonal), then the exact terminal Jacobian is (I + Gf·M)⁻¹·Gf.
   */
  const solveComposite = (
    vbe: number,
    vbc: number,
    seedVbe: number,
    seedVbc: number,
  ): Composite => {
    if (!hasR) {
      const s = solveDc(vbe, vbc);
      return {
        s,
        gff: s.gm + s.go,
        gfr: -(s.gmu + s.go),
        grf: s.gpi,
        grr: s.gmu,
        vbeInt: vbe,
        vbcInt: vbc,
      };
    }
    let zbe = seedVbe;
    let zbc = seedVbc;
    let s = solveDc(zbe, zbc);
    for (let k = 0; k < 4; k++) {
      s = solveDc(zbe, zbc);
      const gff = s.gm + s.go;
      const gfr = -(s.gmu + s.go);
      const grf = s.gpi;
      const grr = s.gmu;
      // h = z + M·i(z) − v
      const h1 = zbe + re * s.cc + (rb + re) * s.cb - vbe;
      const h2 = zbc - rc * s.cc + rb * s.cb - vbc;
      // Jh = I + Gf·M
      const a11 = 1 + gff * re - gfr * rc;
      const a12 = gff * (rb + re) + gfr * rb;
      const a21 = grf * re - grr * rc;
      const a22 = 1 + grf * (rb + re) + grr * rb;
      const det = a11 * a22 - a12 * a21;
      const invDet = 1 / det;
      const d1 = (a22 * h1 - a12 * h2) * invDet;
      const d2 = (-a21 * h1 + a11 * h2) * invDet;
      zbe -= d1;
      zbc -= d2;
    }
    s = solveDc(zbe, zbc);
    const gff = s.gm + s.go;
    const gfr = -(s.gmu + s.go);
    const grf = s.gpi;
    const grr = s.gmu;
    // G_eff = (I + Gf·M)⁻¹·Gf via the adjugate.
    const a11 = 1 + gff * re - gfr * rc;
    const a12 = gff * (rb + re) + gfr * rb;
    const a21 = grf * re - grr * rc;
    const a22 = 1 + grf * (rb + re) + grr * rb;
    const det = a11 * a22 - a12 * a21;
    const invDet = 1 / det;
    // (I+GfM)⁻¹ = adj/det; G_eff rows = (adj·Gf)/det.
    const j11 = a22 * invDet;
    const j12 = -a12 * invDet;
    const j21 = -a21 * invDet;
    const j22 = a11 * invDet;
    return {
      s,
      gff: j11 * gff + j12 * grf,
      gfr: j11 * gfr + j12 * grr,
      grf: j21 * gff + j22 * grf,
      grr: j21 * gfr + j22 * grr,
      vbeInt: zbe,
      vbcInt: zbc,
    };
  };

  /** Charge present at (vbe, vbc) for the four cap groups (F). */
  const capValues = (vbe: number, vbc: number): [number, number, number, number] => {
    const cBe = depletionCapacitance(vbe, beCapModel);
    const cBeDif = diffusionCapacitance(vbe, tf, beJunction);
    const cBc = depletionCapacitance(vbc, bcCapModel);
    const cBcDif = diffusionCapacitance(vbc, tr, bcJunction);
    return [cBe, cBeDif, cBc, cBcDif];
  };

  /**
   * Stamp from the stored (limited) internal junction voltages: evaluate the
   * Ebers-Moll solution there, compute the exact terminal Jacobian, and
   * anchor the Newton source at the self-consistent terminal point. The
   * common-offset freedom of the anchor is absorbed by the zero row sums of
   * the terminal Jacobian — using the iterate's emitter potential as the
   * reference is exactly equivalent to ngspice's ceq form.
   */
  const stampFromState = (stamp: MatrixStamp, env: DeviceEnv): void => {
    const vbeInt = env.state[env.stateBase + VBE0] as number;
    const vbcInt = env.state[env.stateBase + VBC0] as number;
    const s = solveDc(vbeInt, vbcInt);
    const gff = s.gm + s.go;
    const gfr = -(s.gmu + s.go);
    const grf = s.gpi;
    const grr = s.gmu;
    let gEffFf = gff;
    let gEffFr = gfr;
    let gEffRf = grf;
    let gEffRr = grr;
    // Terminal anchors: with R, back out the ohmic drops from the internal
    // point; v* = v_int + M·i evaluated at the junction currents.
    const vbeAnchor = vbeInt + re * s.cc + (rb + re) * s.cb;
    const vbcAnchor = vbcInt - rc * s.cc + rb * s.cb;
    if (hasR) {
      const a11 = 1 + gff * re - gfr * rc;
      const a12 = gff * (rb + re) + gfr * rb;
      const a21 = grf * re - grr * rc;
      const a22 = 1 + grf * (rb + re) + grr * rb;
      const invDet = 1 / (a11 * a22 - a12 * a21);
      const j11 = a22 * invDet;
      const j12 = -a12 * invDet;
      const j21 = -a21 * invDet;
      const j22 = a11 * invDet;
      gEffFf = j11 * gff + j12 * grf;
      gEffFr = j11 * gfr + j12 * grr;
      gEffRf = j21 * gff + j22 * grf;
      gEffRr = j21 * gfr + j22 * grr;
    }
    // Terminal potentials implied by the anchored internal point (type
    // mirrors npn-reference differences onto physical terminals).
    const vE = nodePotential(env, 2);
    const vB = vE + type * vbeAnchor;
    const vC = vB - type * vbcAnchor;
    stampBjtTerminals(
      stamp,
      bNode,
      cNode,
      eNode,
      type,
      s,
      gEffFf,
      gEffFr,
      gEffRf,
      gEffRr,
      vB,
      vC,
      vE,
    );
  };

  return {
    name: ce.name,
    stateSlots: BJT_STATE_SLOTS,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      stampFromState(stamp, env);
    },
    limit(env: DeviceEnv): boolean {
      const vB = nodePotential(env, 1);
      const vC = nodePotential(env, 0);
      const vE = nodePotential(env, 2);
      const vbeTerm = type * (vB - vE);
      const vbcTerm = type * (vB - vC);
      // Reconstruct the internal junction voltages (no-op without RB/RC/RE).
      let vbeNew = vbeTerm;
      let vbcNew = vbcTerm;
      if (hasR) {
        const j = solveComposite(
          vbeTerm,
          vbcTerm,
          env.state[env.stateBase + VBE0] as number,
          env.state[env.stateBase + VBC0] as number,
        );
        vbeNew = j.vbeInt;
        vbcNew = j.vbcInt;
      }
      const rbe = pnjlim(vbeNew, env.state[env.stateBase + VBE0] as number, vt, vcrit);
      const rbc = pnjlim(vbcNew, env.state[env.stateBase + VBC0] as number, vt, vcrit);
      env.state[env.stateBase + VBE0] = rbe.v;
      env.state[env.stateBase + VBC0] = rbc.v;
      return rbe.limited || rbc.limited;
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method): void {
      stampFromState(stamp, env);
      const [cBe, cBeDif, cBc, cBcDif] = capValues(
        env.state[env.stateBase + VBE0] as number,
        env.state[env.stateBase + VBC0] as number,
      );
      if (cBe > 0) {
        beCap.stampTran(stamp, env, h, method, cBe);
      }
      if (cBeDif > 0) {
        beDif.stampTran(stamp, env, h, method, cBeDif);
      }
      if (cBc > 0) {
        bcCap.stampTran(stamp, env, h, method, cBc);
      }
      if (cBcDif > 0) {
        bcDif.stampTran(stamp, env, h, method, cBcDif);
      }
    },
    accept(env: DeviceEnv): void {
      beCap.accept(env);
      beDif.accept(env);
      bcCap.accept(env);
      bcDif.accept(env);
    },
    lte(env: DeviceEnv, _h: number): number {
      const vbe = env.state[env.stateBase + VBE0] as number;
      const vbc = env.state[env.stateBase + VBC0] as number;
      const [cBe, cBeDif, cBc, cBcDif] = capValues(vbe, vbc);
      return (
        beCap.lte(env, cBe) + beDif.lte(env, cBeDif) + bcCap.lte(env, cBc) + bcDif.lte(env, cBcDif)
      );
    },
    lteUnit: "A",
    lteMagnitude(env: DeviceEnv): number {
      return (
        abs(beCap.lteMagnitude(env)) +
        abs(beDif.lteMagnitude(env)) +
        abs(bcCap.lteMagnitude(env)) +
        abs(bcDif.lteMagnitude(env))
      );
    },
  };
}

/**
 * Stamp the linearized terminal currents anchored at the limited point:
 *   i_k(v) ≈ iK0 + Σ_j gKj·(v_j − v_j0)
 * The Jacobian rows are identical for NPN/PNP (chain rule under voltage
 * mirroring); only the current constants flip with `type`. (vB, vC, vE) is
 * the anchor point — the self-consistent terminal voltages of the limited
 * internal state.
 */
function stampBjtTerminals(
  stamp: MatrixStamp,
  bNode: number,
  cNode: number,
  eNode: number,
  type: number,
  s: BjtSolution,
  gff: number,
  gfr: number,
  grf: number,
  grr: number,
  vB: number,
  vC: number,
  vE: number,
): void {
  const gBB = grf + grr;
  const gBC = -grr;
  const gBE = -grf;
  const gCB = gff + gfr;
  const gCC = -gfr;
  const gCE = -gff;
  const gEB = -(gBB + gCB);
  const gEC = -(gBC + gCC);
  const gEE = -(gBE + gCE);
  const iB0 = type * s.cb;
  const iC0 = type * s.cc;
  const iE0 = -type * (s.cb + s.cc);

  if (bNode >= 0) {
    stamp.addA(bNode, bNode, gBB);
    stamp.addRhs(bNode, -(iB0 - (gBB * vB + gBC * vC + gBE * vE)));
    if (cNode >= 0) {
      stamp.addA(bNode, cNode, gBC);
    }
    if (eNode >= 0) {
      stamp.addA(bNode, eNode, gBE);
    }
  }
  if (cNode >= 0) {
    stamp.addA(cNode, cNode, gCC);
    stamp.addRhs(cNode, -(iC0 - (gCB * vB + gCC * vC + gCE * vE)));
    if (bNode >= 0) {
      stamp.addA(cNode, bNode, gCB);
    }
    if (eNode >= 0) {
      stamp.addA(cNode, eNode, gCE);
    }
  }
  if (eNode >= 0) {
    stamp.addA(eNode, eNode, gEE);
    stamp.addRhs(eNode, -(iE0 - (gEB * vB + gEC * vC + gEE * vE)));
    if (bNode >= 0) {
      stamp.addA(eNode, bNode, gEB);
    }
    if (cNode >= 0) {
      stamp.addA(eNode, cNode, gEC);
    }
  }
}
