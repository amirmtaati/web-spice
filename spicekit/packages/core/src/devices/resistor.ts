/**
 * Resistor (SPEC §5.7): linear conductance with temperature coefficients
 * R(T) = R0·(1 + tc1·ΔT + tc2·ΔT²), ΔT = temp − tnom (ngspice semantics).
 * Pure DC device: identical stamp in every Newton pass and in transient.
 */

import type { SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import type { Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { stampConductance } from "./base.ts";

export function resistorDevice(ce: CompiledElement, options: SimOptions): Device {
  const dT = options.temp - options.tnom;
  const scale = 1 + (ce.tc1 ?? 0) * dT + (ce.tc2 ?? 0) * dT * dT;
  const conductance = 1 / ((ce.value ?? 1) * scale);
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  return {
    name: ce.name,
    stateSlots: 0,
    stampDC(stamp: MatrixStamp, _env: DeviceEnv): void {
      stampConductance(stamp, p, n, conductance);
    },
  };
}
