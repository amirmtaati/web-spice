/**
 * Resistor (SPEC §5.7): linear conductance with temperature coefficients
 * R(T) = R0·(1 + tc1·ΔT + tc2·ΔT²), ΔT = temp − tnom (ngspice semantics).
 * Pure DC device: identical stamp in every Newton pass and in transient.
 */

import { EngineError, type SimOptions } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import { BOLTZMANN, celsiusToKelvin } from "../math/index.ts";
import type { AcStamp, Device, DeviceEnv, MatrixStamp, NoiseSource } from "./base.ts";
import { stampConductance, stampConductanceAc } from "./base.ts";

export function resistorDevice(ce: CompiledElement, options: SimOptions): Device {
  const dT = options.temp - options.tnom;
  const scale = 1 + (ce.tc1 ?? 0) * dT + (ce.tc2 ?? 0) * dT * dT;
  let conductance = 1 / ((ce.value ?? 1) * scale);
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  return {
    name: ce.name,
    stateSlots: 0,
    stampDC(stamp: MatrixStamp, _env: DeviceEnv): void {
      stampConductance(stamp, p, n, conductance);
    },
    stampAc(stamp: AcStamp, _env: DeviceEnv, _omega: number): void {
      // Resistors are frequency-independent; thermal noise is handled by the
      // noise analysis (E3), not the AC stamp.
      stampConductanceAc(stamp, p, n, conductance, 0);
    },
    noise(_env: DeviceEnv): NoiseSource[] {
      // Johnson–Nyquist thermal noise: 4kT/R (A²/Hz) at the run temperature.
      const psd = 4 * BOLTZMANN * celsiusToKelvin(options.temp) * conductance;
      return [{ p, n, psd }];
    },
    setLiveParam(property, value, _time): void {
      if (property !== "value") {
        throw new EngineError({
          code: "E_PARSE",
          message: `${ce.name}: resistors support only "value" (got "${property}")`,
          location: { elementName: ce.name },
        });
      }
      if (!(value > 0)) {
        throw new EngineError({
          code: "E_PARSE",
          message: `${ce.name}: resistance must be > 0, got ${value}`,
          location: { elementName: ce.name },
        });
      }
      conductance = 1 / (value * scale);
    },
  };
}
