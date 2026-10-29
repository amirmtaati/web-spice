/**
 * Device factory (SPEC §5.3/§5.7): builds the device list from compiled
 * elements. The Device contract and stamp helpers live in `base.ts` so the
 * per-device modules never depend on this hub (no import cycles).
 */

import { EngineError } from "@spicekit/protocol";
import type { CompiledCircuit, CompiledElement } from "../compiler/index.ts";
import type { Device } from "./base.ts";
import { capacitorDevice } from "./capacitor.ts";
import { dependentDevice } from "./dependent.ts";
import { diodeDevice } from "./diode.ts";
import { inductorDevice } from "./inductor.ts";
import { mutualDevice } from "./mutual.ts";
import { resistorDevice } from "./resistor.ts";
import { sourceDevice } from "./sources.ts";

export type {
  Device,
  DeviceEnv,
  IntegrationMethod,
  LteUnit,
  MatrixStamp,
} from "./base.ts";

/** Build the device list from compiled elements, in element order. */
export function buildDevices(compiled: CompiledCircuit): Device[] {
  const devices: Device[] = [];
  for (const ce of compiled.elements) {
    const device = buildOne(ce, compiled);
    if (device !== undefined) {
      devices.push(device);
    }
  }
  return devices;
}

function buildOne(ce: CompiledElement, compiled: CompiledCircuit): Device | undefined {
  switch (ce.type) {
    case "R":
      return resistorDevice(ce, compiled.options);
    case "C":
      return capacitorDevice(ce);
    case "L":
      return inductorDevice(ce);
    case "K":
      return mutualDevice(ce, compiled);
    case "V":
    case "I":
      return sourceDevice(ce, compiled);
    case "E":
    case "G":
    case "F":
    case "H":
      return dependentDevice(ce);
    case "B":
      throw new EngineError({
        code: "E_NOT_IMPLEMENTED",
        message: "B device simulation lands with milestone E3 (SPEC §22)",
        location: { elementName: ce.name },
      });
    case "D":
      return diodeDevice(ce, compiled.options);
    case "Q":
    case "M":
    case "J":
    case "S":
    case "W":
      throw new EngineError({
        code: "E_NOT_IMPLEMENTED",
        message: `${ce.type} device simulation lands with milestone E2 (SPEC §22)`,
        location: { elementName: ce.name },
      });
    case "X":
      throw new EngineError({
        code: "E_NOT_IMPLEMENTED",
        message: "Subcircuit flattening lands with milestone E3 (SPEC §22)",
        location: { elementName: ce.name },
      });
    default:
      return undefined;
  }
}
