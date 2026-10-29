/**
 * Inductor (SPEC §5.7): DC short via a branch-current unknown; companion
 * stamps in transient. The branch row owns the integration equation so the
 * mutual-coupling device (mutual.ts) can add cross terms to the same rows:
 *
 *   BE:    v_{n+1} = (L/h)·(i_{n+1} − i_n)          A[br,br] −= L/h
 *   trap:  v_{n+1} = (2L/h)·(i_{n+1} − i_n) − v_n   A[br,br] −= 2L/h
 *   gear2: v_{n+1} = (3L/2h)·(i_{n+1} − (4/3)i_n + (1/3)i_{n−1})
 *                                                   A[br,br] −= 3L/2h
 *
 * x[branch] = current INTO the + node (SPICE i(Lx) convention, matching the
 * V-source branch convention in devices/index.ts).
 * LTE (trap): v_lte ≈ (L/12)·|i_{n+1} − 3i_n + 3i_{n−1} − i_{n−2}|.
 */

import type { CompiledElement } from "../compiler/index.ts";
import { abs } from "../math/index.ts";
import type { Device, DeviceEnv, IntegrationMethod, MatrixStamp } from "./base.ts";
import { branchVoltage } from "./base.ts";

const I0 = 0; // i_{n}
const I1 = 1; // i_{n-1}
const I2 = 2; // i_{n-2}
const V0 = 3; // v_{n}
const V1 = 4; // v_{n-1}
const CNT = 5;

const INDUCTOR_STATE_SLOTS = 6;

export function inductorDevice(ce: CompiledElement): Device {
  const l = ce.value as number;
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  const br = ce.branch as number;

  return {
    name: ce.name,
    stateSlots: INDUCTOR_STATE_SLOTS,
    lteUnit: "V",
    stampDC(stamp: MatrixStamp, _env: DeviceEnv): void {
      // Short circuit: branch row v_p − v_n = 0 (no i coefficient at DC).
      stampVoltageBranch(stamp, br, p, n);
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void {
      const s = env.stateBase;
      const i0 = env.state[s + I0] as number;
      const i1 = env.state[s + I1] as number;
      const v0 = env.state[s + V0] as number;
      let coef: number;
      let rhs: number;
      if (method === "be") {
        coef = l / h;
        rhs = -coef * i0;
      } else if (method === "trap") {
        coef = (2 * l) / h;
        rhs = -coef * i0 - v0;
      } else {
        coef = (3 * l) / (2 * h);
        rhs = -((2 * l) / h) * i0 + (l / (2 * h)) * i1;
      }
      stampVoltageBranch(stamp, br, p, n);
      stamp.addA(br, br, -coef);
      stamp.addRhs(br, rhs);
    },
    accept(env: DeviceEnv): void {
      const s = env.stateBase;
      const iNew = env.x[br] as number;
      const vNew = branchVoltage(env, 0, 1);
      env.state[s + I2] = env.state[s + I1] as number;
      env.state[s + I1] = env.state[s + I0] as number;
      env.state[s + I0] = iNew;
      env.state[s + V1] = env.state[s + V0] as number;
      env.state[s + V0] = vNew;
      env.state[s + CNT] = (env.state[s + CNT] as number) + 1;
    },
    lte(env: DeviceEnv, _h: number): number {
      const s = env.stateBase;
      if ((env.state[s + CNT] as number) < 3) {
        return 0;
      }
      const i0 = env.state[s + I0] as number;
      const i1 = env.state[s + I1] as number;
      const i2 = env.state[s + I2] as number;
      return (l / 12) * abs((env.x[br] as number) - 3 * i0 + 3 * i1 - i2);
    },
    lteMagnitude(env: DeviceEnv): number {
      // The LTE quantity is a voltage; compare against the device voltage.
      return abs(env.state[env.stateBase + V0] as number);
    },
  };
}

/** Shared branch-equation stamp: v_p − v_n appears in the branch row. */
export function stampVoltageBranch(stamp: MatrixStamp, br: number, p: number, n: number): void {
  if (p >= 0) {
    stamp.addA(p, br, 1);
    stamp.addA(br, p, 1);
  }
  if (n >= 0) {
    stamp.addA(n, br, -1);
    stamp.addA(br, n, -1);
  }
}
