/**
 * Mutual inductance (K, SPEC §5.7): couples two inductor branch rows with
 * M = k·sqrt(L1·L2). The L devices own their self terms; this device adds
 * the cross terms to both branch rows:
 *
 *   BE:    A[br1,br2] −= M/h      rhs[br1] −= (M/h)·i2_n   (symmetric)
 *   trap:  A[br1,br2] −= 2M/h     rhs[br1] −= (2M/h)·i2_n
 *   gear2: A[br1,br2] −= 3M/2h    rhs[br1] −= (2M/h)·i2_n + (M/2h)·i2_{n−1}
 *
 * SPICE convention: positive k, dot orientation fixed by node order (v1 =
 * L1·di1/dt + M·di2/dt with both inductors' + terminal as dotted end).
 */

import type { CompiledCircuit, CompiledElement } from "../compiler/index.ts";
import { sqrt } from "../math/index.ts";
import type { AcStamp, Device, DeviceEnv, IntegrationMethod, MatrixStamp } from "./base.ts";

const MUTUAL_STATE_SLOTS = 0;

export function mutualDevice(ce: CompiledElement, compiled: CompiledCircuit): Device {
  const k = ce.value as number;
  const [name1, name2] = ce.element.type === "K" ? ce.element.inductors : ["", ""];
  const l1 = compiled.elements.find((e) => e.name.toLowerCase() === name1.toLowerCase());
  const l2 = compiled.elements.find((e) => e.name.toLowerCase() === name2.toLowerCase());
  if (l1 === undefined || l2 === undefined) {
    // checkCouplings guarantees both exist; defensive guard for direct IR use.
    throw new Error(`K ${ce.name}: inductor not found`);
  }
  const mCoupling = k * sqrt((l1.value as number) * (l2.value as number));
  const br1 = l1.branch as number;
  const br2 = l2.branch as number;

  return {
    name: ce.name,
    stateSlots: MUTUAL_STATE_SLOTS,
    stampDC(): void {
      // Coupling affects only di/dt terms; DC short circuits unchanged.
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void {
      // Partner inductor currents come from their state slots (i_n, i_{n-1}).
      const i2n = readLState(env, l2, 0);
      const i2p = readLState(env, l2, 1);
      const i1n = readLState(env, l1, 0);
      let factor: number;
      let rhs1: number;
      let rhs2: number;
      if (method === "be") {
        factor = mCoupling / h;
        rhs1 = -factor * i2n;
        rhs2 = -factor * i1n;
      } else if (method === "trap") {
        factor = (2 * mCoupling) / h;
        rhs1 = -factor * i2n;
        rhs2 = -factor * i1n;
      } else {
        factor = (3 * mCoupling) / (2 * h);
        rhs1 = -((2 * mCoupling) / h) * i2n + (mCoupling / (2 * h)) * i2p;
        rhs2 = -((2 * mCoupling) / h) * i1n + (mCoupling / (2 * h)) * readLState(env, l1, 1);
      }
      stamp.addA(br1, br2, -factor);
      stamp.addA(br2, br1, -factor);
      stamp.addRhs(br1, rhs1);
      stamp.addRhs(br2, rhs2);
    },
    stampAc(stamp: AcStamp, _env: DeviceEnv, omega: number): void {
      // AC cross terms: v1 gains +jωM·i2 and v2 gains +jωM·i1, so both
      // branch rows subtract jωM·(partner current). ω = 0 → no coupling.
      if (omega === 0) {
        return;
      }
      stamp.addAc(br1, br2, 0, -omega * mCoupling);
      stamp.addAc(br2, br1, 0, -omega * mCoupling);
    },
  };
}

/** Read a partner inductor's state slot via the analysis state-base map. */
function readLState(env: DeviceEnv, l: CompiledElement, slot: number): number {
  const base = env.stateBases.get(l.name.toLowerCase());
  if (base === undefined) {
    return 0;
  }
  return env.state[base + slot] as number;
}
