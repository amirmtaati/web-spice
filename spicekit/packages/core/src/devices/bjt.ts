/**
 * BJT (SPEC §5.7): SPICE2 Gummel-Poon reduced to its Ebers-Moll core —
 * transport formulation with the Early-effect base-charge factor q1, NPN/PNP
 * via voltage mirroring, junction + diffusion capacitance, gmin on both
 * junctions, and pnjlim limiting on vbe/vbc.
 *
 * Parasitic RB/RC/RE are modeled with real internal MNA nodes (b', c', e')
 * — one branch unknown per positive resistance, allocated by the compiler
 * (ngspice-44 structure). The junctions stamp between the prime nodes, the
 * resistors stamp terminal→prime, and the limiter reads the junction
 * voltages directly from the solution vector. This replaces the earlier
 * folded-composite formulation, whose 2×2 reconstruction Newton was
 * ill-conditioned from cold starts (determinant cancellation → NaN).
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
 * Prime-node stamp (t = ±1 for npn/pnp; identical Jacobian both polarities):
 *   gBB = grf+grr  gBC = −grr  gBE = −grf          (base row)
 *   gCB = gff+gfr  gCC = −gfr  gCE = −gff          (collector row)
 *   gEk = −(gBk + gCk)                             (emitter = −B − C)
 *   iB0 = t·cb   iC0 = t·cc   iE0 = −t·(cb + cc)
 *   A[k][j] += gKj;  b[k] += −(iK0 − Σ_j gKj·v0_j)
 *
 * The row sums of the Jacobian block are zero, so the choice of anchor
 * offset is free: anchoring the emitter at the iterate's e' potential is
 * exactly ngspice's ceq form.
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
import type { AcStamp, Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { stampCapacitanceAc, stampConductance, stampConductanceAc } from "./base.ts";
import { type CapRef, JunctionCap, resolveCapRef, VC_SLOTS } from "./nonlinear/jcap.ts";
import {
  depletionCapacitance,
  diffusionCapacitance,
  diodeConduction,
  type JunctionCapacitance,
  thermalVoltage,
} from "./nonlinear/junction.ts";
import { junctionVcrit, pnjlim } from "./nonlinear/limiting.ts";

// State: vbe/vbc (npn-reference) used in the last stamp, then one cap block
// each for BE junction, BE diffusion (TF), BC junction, BC diffusion (TR).
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
  const hasRb = rb > 0;
  const hasRc = rc > 0;
  const hasRe = re > 0;

  const beCapModel: JunctionCapacitance = { cj0: cje, vj: vje, m: mje, fc };
  const bcCapModel: JunctionCapacitance = { cj0: cjc, vj: vjc, m: mjc, fc };

  // Terminal references for the caps: prime nodes when the corresponding
  // resistor exists (compiler allocates branch unknowns in [rb, rc, re]
  // order), element terminals otherwise. Element node order is
  // [collector, base, emitter] = env.nodes positions [0, 1, 2].
  const bRef: CapRef = hasRb ? { arr: "branches", pos: 0 } : 1;
  const cRef: CapRef = hasRc ? { arr: "branches", pos: hasRb ? 1 : 0 } : 0;
  const eRef: CapRef = hasRe ? { arr: "branches", pos: (hasRb ? 1 : 0) + (hasRc ? 1 : 0) } : 2;
  const beCap = new JunctionCap("cbe", bRef, eRef, CBE_OFF);
  const beDif = new JunctionCap("cbe-dif", bRef, eRef, CBE_DIF_OFF);
  const bcCap = new JunctionCap("cbc", bRef, cRef, CBC_OFF);
  const bcDif = new JunctionCap("cbc-dif", bRef, cRef, CBC_DIF_OFF);

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

  /** Charge present at (vbe, vbc) for the four cap groups (F). */
  const capValues = (vbe: number, vbc: number): [number, number, number, number] => {
    const cBe = depletionCapacitance(vbe, beCapModel);
    const cBeDif = diffusionCapacitance(vbe, tf, beJunction);
    const cBc = depletionCapacitance(vbc, bcCapModel);
    const cBcDif = diffusionCapacitance(vbc, tr, bcJunction);
    return [cBe, cBeDif, cBc, cBcDif];
  };

  /**
   * MNA offsets of the (possibly internal) prime nodes, plus the terminals.
   * Branch order from the compiler: [rb → b', rc → c', re → e'] filtered.
   */
  const offsets = (
    env: DeviceEnv,
  ): { b: number; c: number; e: number; bt: number; ct: number; et: number } => {
    let bi = 0;
    const b = hasRb ? (env.branches[bi++] as number) : (env.nodes[1] as number);
    const c = hasRc ? (env.branches[bi++] as number) : (env.nodes[0] as number);
    const e = hasRe ? (env.branches[bi] as number) : (env.nodes[2] as number);
    return {
      b,
      c,
      e,
      bt: env.nodes[1] as number,
      ct: env.nodes[0] as number,
      et: env.nodes[2] as number,
    };
  };

  const xAt = (env: DeviceEnv, k: number): number => (k === -1 ? 0 : (env.x[k] as number));

  /** Parasitic resistor stamps terminal → prime node. */
  const stampResistors = (stamp: MatrixStamp, env: DeviceEnv): void => {
    if (hasRb) {
      stampConductance(stamp, env.nodes[1] as number, env.branches[0] as number, 1 / rb);
    }
    if (hasRc) {
      const ci = hasRb ? 1 : 0;
      stampConductance(stamp, env.nodes[0] as number, env.branches[ci] as number, 1 / rc);
    }
    if (hasRe) {
      const ei = (hasRb ? 1 : 0) + (hasRc ? 1 : 0);
      stampConductance(stamp, env.nodes[2] as number, env.branches[ei] as number, 1 / re);
    }
  };

  /** Complex form of `stampResistors` (AC small-signal). */
  const stampResistorsAc = (stamp: AcStamp, env: DeviceEnv): void => {
    if (hasRb) {
      stampConductanceAc(stamp, env.nodes[1] as number, env.branches[0] as number, 1 / rb, 0);
    }
    if (hasRc) {
      const ci = hasRb ? 1 : 0;
      stampConductanceAc(stamp, env.nodes[0] as number, env.branches[ci] as number, 1 / rc, 0);
    }
    if (hasRe) {
      const ei = (hasRb ? 1 : 0) + (hasRc ? 1 : 0);
      stampConductanceAc(stamp, env.nodes[2] as number, env.branches[ei] as number, 1 / re, 0);
    }
  };

  /**
   * Stamp from the stored (limited) junction voltages: evaluate the
   * Ebers-Moll solution there and anchor the Newton source at the
   * state-consistent prime-node potentials. The zero row sums of the
   * Jacobian block absorb the anchor's common offset — using the iterate's
   * e' potential as the reference is exactly ngspice's ceq form.
   */
  const stampFromState = (stamp: MatrixStamp, env: DeviceEnv): void => {
    const vbe0 = env.state[env.stateBase + VBE0] as number;
    const vbc0 = env.state[env.stateBase + VBC0] as number;
    const s = solveDc(vbe0, vbc0);
    const gff = s.gm + s.go;
    const gfr = -(s.gmu + s.go);
    const grf = s.gpi;
    const grr = s.gmu;
    const o = offsets(env);
    // Anchor at the iterate's e' potential; type mirrors npn-reference
    // differences onto physical prime-node potentials.
    const vE = xAt(env, o.e);
    const vB = vE + type * vbe0;
    const vC = vB - type * vbc0;
    stampBjtTerminals(stamp, o.b, o.c, o.e, type, s, gff, gfr, grf, grr, vB, vC, vE);
    stampResistors(stamp, env);
  };

  return {
    name: ce.name,
    stateSlots: BJT_STATE_SLOTS,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      stampFromState(stamp, env);
    },
    limit(env: DeviceEnv): boolean {
      // The junction voltages are MNA unknowns (prime nodes) — read them
      // from the solution directly; no reconstruction of any kind.
      const o = offsets(env);
      const vbeTerm = type * (xAt(env, o.b) - xAt(env, o.e));
      const vbcTerm = type * (xAt(env, o.b) - xAt(env, o.c));
      const rbe = pnjlim(vbeTerm, env.state[env.stateBase + VBE0] as number, vt, vcrit);
      const rbc = pnjlim(vbcTerm, env.state[env.stateBase + VBC0] as number, vt, vcrit);
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
    stampAc(stamp: AcStamp, env: DeviceEnv, omega: number): void {
      // Small-signal at the OP: the identical 3×3 transconductance block
      // between prime nodes (no anchor terms — the Jacobian only), parasitic
      // resistors, and cπ/cμ at the stored junction voltages.
      const vbe0 = env.state[env.stateBase + VBE0] as number;
      const vbc0 = env.state[env.stateBase + VBC0] as number;
      const s = solveDc(vbe0, vbc0);
      const gff = s.gm + s.go;
      const gfr = -(s.gmu + s.go);
      const grf = s.gpi;
      const grr = s.gmu;
      const o = offsets(env);
      stampBjtBlockAc(stamp, o.b, o.c, o.e, gff, gfr, grf, grr);
      stampResistorsAc(stamp, env);
      const [cBe, cBeDif, cBc, cBcDif] = capValues(vbe0, vbc0);
      const bp = resolveCapRef(env, bRef);
      const ep = resolveCapRef(env, eRef);
      const cp = resolveCapRef(env, cRef);
      stampCapacitanceAc(stamp, bp, ep, cBe + cBeDif, omega);
      stampCapacitanceAc(stamp, bp, cp, cBc + cBcDif, omega);
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
 * Complex form of the prime-node block for AC (the Jacobian only — no
 * anchor currents exist in small-signal). Coefficients identical to
 * `stampBjtTerminals`; the emitter row is the negative sum of the other two
 * rows, which keeps KCL exact.
 */
function stampBjtBlockAc(
  stamp: AcStamp,
  bNode: number,
  cNode: number,
  eNode: number,
  gff: number,
  gfr: number,
  grf: number,
  grr: number,
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
  if (bNode >= 0) {
    stamp.addAc(bNode, bNode, gBB, 0);
    if (cNode >= 0) {
      stamp.addAc(bNode, cNode, gBC, 0);
    }
    if (eNode >= 0) {
      stamp.addAc(bNode, eNode, gBE, 0);
    }
  }
  if (cNode >= 0) {
    stamp.addAc(cNode, cNode, gCC, 0);
    if (bNode >= 0) {
      stamp.addAc(cNode, bNode, gCB, 0);
    }
    if (eNode >= 0) {
      stamp.addAc(cNode, eNode, gCE, 0);
    }
  }
  if (eNode >= 0) {
    stamp.addAc(eNode, eNode, gEE, 0);
    if (bNode >= 0) {
      stamp.addAc(eNode, bNode, gEB, 0);
    }
    if (cNode >= 0) {
      stamp.addAc(eNode, cNode, gEC, 0);
    }
  }
}

/**
 * Stamp the linearized prime-node currents anchored at the limited point:
 *   i_k(v) ≈ iK0 + Σ_j gKj·(v_j − v_j0)
 * The Jacobian rows are identical for NPN/PNP (chain rule under voltage
 * mirroring); only the current constants flip with `type`. (vB, vC, vE) is
 * the anchor point — the state-consistent prime-node potentials.
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
