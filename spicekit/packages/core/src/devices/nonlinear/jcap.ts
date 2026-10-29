/**
 * Voltage-dependent capacitor companion models (SPEC §5.5/§5.7). Nonlinear
 * devices own several internal capacitors (junction depletion, diffusion,
 * Meyer gate caps) whose value depends on their junction voltage. SPICE2's
 * approach — evaluate C at the current Newton iterate, then use the standard
 * linear companion formulas — is reused here so every device shares one
 * battle-tested integration path (identical state layout to capacitor.ts):
 *
 *   BE:    i = (C/h)·(v − v0)                    G = C/h,    J = G·v0
 *   trap:  i = G·(v − v0) + i0                   G = 2C/h,   J = G·v0 + i0
 *   gear2: G = 1.5C/h, J = (C/h)·(2v0 − v1/2)
 *
 * LTE (trap): i_lte ≈ (C/12)·|v' − 3v0 + 3v1 − v2| when the last three
 * steps were locally uniform (the analysis gates on that).
 *
 * Per-capacitor state (6 slots, offset from the owning device's stateBase):
 *   +0 V0, +1 V1, +2 V2 — accepted voltage history
 *   +3 IP — previous branch current
 *   +4 LG, +5 LJ — last companion (G, J); +6 CNT — accepted-step counter
 * (7 slots: VC_SLOTS).
 */

import { abs } from "../../math/index.ts";
import type { DeviceEnv, IntegrationMethod, MatrixStamp } from "../base.ts";
import { stampConductance } from "../base.ts";

export const VC_SLOTS = 7;

/**
 * Terminal reference for a capacitor: a plain number is a position inside
 * `env.nodes` (the element's terminals); `{arr: "branches", pos}` addresses
 * an internal MNA node owned by the device (BJT b'/c'/e').
 */
export type CapRef = number | { arr: "nodes" | "branches"; pos: number };

function resolveRef(env: DeviceEnv, ref: CapRef): number {
  if (typeof ref === "number") {
    return env.nodes[ref] as number;
  }
  return (ref.arr === "branches" ? env.branches : env.nodes)[ref.pos] as number;
}

function refPotential(env: DeviceEnv, ref: CapRef): number {
  const k = resolveRef(env, ref);
  return k === -1 ? 0 : (env.x[k] as number);
}

// Slot offsets inside one capacitor's state block.
const V0 = 0;
const V1 = 1;
const V2 = 2;
const IP = 3;
const LG = 4;
const LJ = 5;
const CNT = 6;

export class JunctionCap {
  constructor(
    readonly name: string,
    /** Terminal references (positions in env.nodes, or branch refs). */
    private readonly pRef: CapRef,
    private readonly nRef: CapRef,
    /** Slot offset inside the owning device's state block. */
    private readonly off: number,
  ) {}

  /** Voltage across the cap at the current iterate (v_plus − v_minus). */
  voltage(env: DeviceEnv): number {
    return refPotential(env, this.pRef) - refPotential(env, this.nRef);
  }

  /** Stamp the companion model for this step with C evaluated at the iterate. */
  stampTran(
    stamp: MatrixStamp,
    env: DeviceEnv,
    h: number,
    method: IntegrationMethod,
    cap: number,
  ): void {
    const s = env.stateBase + this.off;
    const p = resolveRef(env, this.pRef);
    const n = resolveRef(env, this.nRef);
    const v0 = env.state[s + V0] as number;
    const v1 = env.state[s + V1] as number;
    const ip = env.state[s + IP] as number;
    let g: number;
    let j: number;
    if (method === "be") {
      g = cap / h;
      j = g * v0;
    } else if (method === "trap") {
      g = (2 * cap) / h;
      j = g * v0 + ip;
    } else {
      g = (1.5 * cap) / h;
      j = (cap / h) * (2 * v0 - 0.5 * v1);
    }
    env.state[s + LG] = g;
    env.state[s + LJ] = j;
    stampConductance(stamp, p, n, g);
    if (p >= 0) {
      stamp.addRhs(p, j);
    }
    if (n >= 0) {
      stamp.addRhs(n, -j);
    }
  }

  /** Commit one accepted step: shift history, recompute the branch current. */
  accept(env: DeviceEnv): void {
    const s = env.stateBase + this.off;
    const vNew = this.voltage(env);
    env.state[s + V2] = env.state[s + V1] as number;
    env.state[s + V1] = env.state[s + V0] as number;
    env.state[s + V0] = vNew;
    const g = env.state[s + LG] as number;
    const j = env.state[s + LJ] as number;
    env.state[s + IP] = g * vNew - j;
    env.state[s + CNT] = (env.state[s + CNT] as number) + 1;
  }

  /** Trapezoidal LTE estimate in amperes (0 until 3 history points exist). */
  lte(env: DeviceEnv, cap: number): number {
    const s = env.stateBase + this.off;
    if ((env.state[s + CNT] as number) < 3) {
      return 0;
    }
    const v0 = env.state[s + V0] as number;
    const v1 = env.state[s + V1] as number;
    const v2 = env.state[s + V2] as number;
    const vNew = this.voltage(env);
    return (cap / 12) * abs(vNew - 3 * v0 + 3 * v1 - v2);
  }

  /** Magnitude of the LTE signal — the device current through this cap. */
  lteMagnitude(env: DeviceEnv): number {
    return abs(env.state[env.stateBase + this.off + IP] as number);
  }

  /** Reset history (uic / re-bias): cap holds `v` with zero current. */
  initState(env: DeviceEnv, v: number): void {
    const s = env.stateBase + this.off;
    env.state[s + V0] = v;
    env.state[s + V1] = 0;
    env.state[s + V2] = 0;
    env.state[s + IP] = 0;
    env.state[s + LG] = 0;
    env.state[s + LJ] = 0;
    env.state[s + CNT] = 0;
  }
}
