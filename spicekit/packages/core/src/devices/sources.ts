/**
 * Independent V/I sources (SPEC §5.7): DC value plus optional waveform and
 * AC small-signal magnitude/phase. OP and transient use the DC value (or the
 * waveform); the AC analysis applies the phasor mag·e^{j·phase} (SPEC §5.5).
 * Breakpoints from the waveform drive the adaptive timestep controller.
 */

import { EngineError } from "@spicekit/protocol";
import type { CompiledCircuit, CompiledElement } from "../compiler/index.ts";
import { ParamScope } from "../eval/index.ts";
import type { AcStamp, Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { stampVoltageBranch, stampVoltageBranchAc } from "./base.ts";
import type { ExternalChannels } from "./waveform.ts";
import { createWaveEval, nullExternals, resolveWave, type WaveEval } from "./waveform.ts";

export function sourceDevice(
  ce: CompiledElement,
  compiled: CompiledCircuit,
  externals: ExternalChannels = nullExternals,
): Device {
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  let dc = ce.dc ?? 0;
  const scope = new ParamScope(compiled.params, compiled.options.temp);
  const wave: WaveEval | undefined =
    ce.element.type === "V" || ce.element.type === "I"
      ? ce.element.wave !== undefined
        ? createWaveEval(resolveWave(ce.element.wave, scope), externals)
        : undefined
      : undefined;

  const valueAt = (t: number): number => (wave !== undefined ? wave.valueAt(t) : dc);

  /** Route a live setParam to the waveform or the DC value (SPEC §4.4). */
  const liveParam = (property: string, value: number, time: number): void => {
    if (wave !== undefined) {
      if (property === "value") {
        dc = value; // DC operating-point value (ngspice semantics)
        return;
      }
      wave.retune?.(property as "amplitude" | "frequency" | "offset" | "dutyCycle", value, time);
      return;
    }
    // Plain DC source: amplitude/offset/value all set the DC level.
    if (property === "value" || property === "amplitude" || property === "offset") {
      dc = value;
      return;
    }
    throw new EngineError({
      code: "E_PARSE",
      message: `${ce.name}: "${property}" needs a waveform (SIN/PULSE) on the source`,
      location: { elementName: ce.name },
    });
  };

  // AC small-signal phasor (E3): mag default 0, phase in degrees.
  const acMag = ce.element.type === "V" || ce.element.type === "I" ? (ce.element.ac?.mag ?? 0) : 0;
  const acPhaseDeg =
    ce.element.type === "V" || ce.element.type === "I" ? (ce.element.ac?.phase ?? 0) : 0;
  const acRe = (): number => acMag * Math.cos((acPhaseDeg * Math.PI) / 180);
  const acIm = (): number => acMag * Math.sin((acPhaseDeg * Math.PI) / 180);

  if (ce.type === "V") {
    const br = ce.branch as number;
    return {
      name: ce.name,
      stateSlots: 0,
      dcValue: () => dc,
      setDc: (value: number) => {
        dc = value;
      },
      stampDC(stamp: MatrixStamp): void {
        stampVoltageBranch(stamp, br, p, n);
        stamp.addRhs(br, dc);
      },
      stampTran(
        stamp: MatrixStamp,
        env: DeviceEnv,
        _h: number,
        _method: "be" | "trap" | "gear2",
      ): void {
        stampVoltageBranch(stamp, br, p, n);
        stamp.addRhs(br, valueAt(env.time));
      },
      stampAc(stamp: AcStamp, _env: DeviceEnv, _omega: number): void {
        // The branch equation holds v_p − v_n = v_ac (a real-valued source
        // phasor); the branch unknown then carries i_ac.
        stampVoltageBranchAc(stamp, br, p, n);
        stamp.addRhsAc(br, acRe(), acIm());
      },
      nextBreakpoint(t: number): number | undefined {
        return wave?.nextBreakpoint(t);
      },
      setLiveParam(property, value, time): void {
        liveParam(property, value, time);
      },
    };
  }

  // Current source: positive value drives current out of node p (SPICE:
  // current flows from + node through the source to the − node).
  return {
    name: ce.name,
    stateSlots: 0,
    dcValue: () => dc,
    setDc: (value: number) => {
      dc = value;
    },
    stampDC(stamp: MatrixStamp): void {
      stampCurrent(stamp, p, n, dc);
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv): void {
      stampCurrent(stamp, p, n, valueAt(env.time));
    },
    stampAc(stamp: AcStamp, _env: DeviceEnv, _omega: number): void {
      stampCurrentAc(stamp, p, n, acRe(), acIm());
    },
    nextBreakpoint(t: number): number | undefined {
      return wave?.nextBreakpoint(t);
    },
    setLiveParam(property, value, time): void {
      liveParam(property, value, time);
    },
  };
}

function stampCurrent(stamp: MatrixStamp, p: number, n: number, value: number): void {
  if (p >= 0) {
    stamp.addRhs(p, -value);
  }
  if (n >= 0) {
    stamp.addRhs(n, value);
  }
}

function stampCurrentAc(stamp: AcStamp, p: number, n: number, re: number, im: number): void {
  if (p >= 0) {
    stamp.addRhsAc(p, -re, -im);
  }
  if (n >= 0) {
    stamp.addRhsAc(n, re, im);
  }
}
