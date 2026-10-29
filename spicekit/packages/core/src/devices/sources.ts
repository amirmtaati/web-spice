/**
 * Independent V/I sources (SPEC §5.7): DC value plus optional waveform and
 * AC small-signal magnitude/phase. OP and transient use the DC value (or the
 * waveform); the AC analysis applies the phasor mag·e^{j·phase} (SPEC §5.5).
 * Breakpoints from the waveform drive the adaptive timestep controller.
 */

import type { CompiledCircuit, CompiledElement } from "../compiler/index.ts";
import { ParamScope } from "../eval/index.ts";
import type { AcStamp, Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { stampVoltageBranch, stampVoltageBranchAc } from "./base.ts";
import { createWaveEval, resolveWave, type WaveEval } from "./waveform.ts";

export function sourceDevice(ce: CompiledElement, compiled: CompiledCircuit): Device {
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  let dc = ce.dc ?? 0;
  const scope = new ParamScope(compiled.params, compiled.options.temp);
  const wave: WaveEval | undefined =
    ce.element.type === "V" || ce.element.type === "I"
      ? ce.element.wave !== undefined
        ? createWaveEval(resolveWave(ce.element.wave, scope))
        : undefined
      : undefined;

  const valueAt = (t: number): number => (wave !== undefined ? wave.valueAt(t) : dc);

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
