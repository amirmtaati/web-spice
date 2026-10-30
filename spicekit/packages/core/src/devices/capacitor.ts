/**
 * Capacitor (SPEC §5.7): open at DC; companion-model stamps in transient
 * (backward Euler, trapezoidal, Gear-2) and trapezoidal local truncation
 * error for adaptive stepping (SPEC §5.5). Companion formulas (standard
 * SPICE2/ngspice derivation, i = C·dv/dt):
 *
 *   BE:    i_{n+1} = (C/h)·(v_{n+1} − v_n)              G = C/h,   J = G·v_n
 *   trap:  i_{n+1} = G·(v_{n+1} − v_n) + i_n            G = 2C/h,  J = G·v_n + i_n
 *   gear2: i_{n+1} = (C/h)·(1.5·v_{n+1} − 2·v_n + v_{n−1}/2)
 *                                                     G = 1.5C/h, J = (C/h)(2v_n − v_{n−1}/2)
 *
 * MNA: conductance G between nodes plus current source J into the + node.
 * LTE (trap): i_lte ≈ (C/12)·|v_{n+1} − 3v_n + 3v_{n−1} − v_{n−2}| (assumes
 * locally constant h; the controller divides by trtol).
 */

import { EngineError } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { abs } from "../math/index.ts";
import type { AcStamp, Device, DeviceEnv, IntegrationMethod, MatrixStamp } from "./base.ts";
import { branchVoltage, stampConductance, stampConductanceAc } from "./base.ts";

const V0 = 0; // v_{n}   (previous accepted step)
const V1 = 1; // v_{n-1}
const V2 = 2; // v_{n-2}
const IP = 3; // i_{n}   (previous current)
const LG = 4; // last G
const LJ = 5; // last J
const CNT = 6; // accepted-step counter (LTE needs >= 3 history points)

const CAPACITOR_STATE_SLOTS = 7;

export function capacitorDevice(ce: CompiledElement): Device {
  let c = ce.value as number;
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;

  return {
    name: ce.name,
    stateSlots: CAPACITOR_STATE_SLOTS,
    lteUnit: "A",
    stampDC(): void {
      // Open circuit at DC: no stamp.
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void {
      const s = env.stateBase;
      const v0 = env.state[s + V0] as number;
      const v1 = env.state[s + V1] as number;
      const ip = env.state[s + IP] as number;
      let g: number;
      let j: number;
      if (method === "be") {
        g = c / h;
        j = g * v0;
      } else if (method === "trap") {
        g = (2 * c) / h;
        j = g * v0 + ip;
      } else {
        g = (1.5 * c) / h;
        j = (c / h) * (2 * v0 - 0.5 * v1);
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
    },
    stampAc(stamp: AcStamp, _env: DeviceEnv, omega: number): void {
      // i = jωC·v; ω = 0 (DC limit) → open circuit, nothing to stamp.
      if (omega === 0 || c === 0) {
        return;
      }
      stampConductanceAc(stamp, p, n, 0, omega * c);
    },
    accept(env: DeviceEnv): void {
      const s = env.stateBase;
      const vNew = branchVoltage(env, 0, 1);
      env.state[s + V2] = env.state[s + V1] as number;
      env.state[s + V1] = env.state[s + V0] as number;
      env.state[s + V0] = vNew;
      const g = env.state[s + LG] as number;
      const j = env.state[s + LJ] as number;
      env.state[s + IP] = g * vNew - j;
      env.state[s + CNT] = (env.state[s + CNT] as number) + 1;
    },
    lte(env: DeviceEnv, _h: number): number {
      const s = env.stateBase;
      if ((env.state[s + CNT] as number) < 3) {
        return 0; // fewer than 3 history points: no estimate yet
      }
      const v0 = env.state[s + V0] as number;
      const v1 = env.state[s + V1] as number;
      const v2 = env.state[s + V2] as number;
      const vNew = branchVoltage(env, 0, 1);
      return (c / 12) * abs(vNew - 3 * v0 + 3 * v1 - v2);
    },
    lteMagnitude(env: DeviceEnv): number {
      // The LTE quantity is a current; compare against the device current.
      return abs(env.state[env.stateBase + IP] as number);
    },
    setLiveParam(property, value, _time): void {
      if (property !== "value") {
        throw new EngineError({
          code: "E_PARSE",
          message: `${ce.name}: capacitors support only "value" (got "${property}")`,
          location: { elementName: ce.name },
        });
      }
      if (!(value >= 0)) {
        throw new EngineError({
          code: "E_PARSE",
          message: `${ce.name}: capacitance must be >= 0, got ${value}`,
          location: { elementName: ce.name },
        });
      }
      c = value;
    },
  };
}
