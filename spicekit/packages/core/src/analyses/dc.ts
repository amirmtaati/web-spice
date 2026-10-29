/**
 * DC sweep (SPEC §5.5): sweep an independent V/I source over a range, with
 * the previous solution as the warm start through a full Newton solve per
 * point (nonlinear devices need iterations; E1's single-solve shortcut only
 * held for linear circuits). E1 restamps and refactorizes per point (simple
 * and always correct); the factor-once/RHS-only optimization lands with E4's
 * sparse solver and symbolic reuse (SPEC §5.4 stage 2). Nested sweeps: the
 * inner sweep runs fully for each outer point; samples are ordered
 * inner-fastest.
 */

import type { DcSweep } from "@spicekit/protocol";

import { EngineError, type SimOptions } from "@spicekit/protocol";
import { runOpWarm } from "./op.ts";
import type { Workspace } from "./workspace.ts";

export interface SweepOutcome {
  /** Values of the (outer) swept source, one per outer point. */
  outerValues: Float64Array;
  /** Values of the inner sweep source, one per sample (undefined: single). */
  innerValues: Float64Array | undefined;
  points: number;
  /** size × points; column k is the solution at sample k. */
  snapshots: Float64Array;
}

export function runDcSweep(
  ws: Workspace,
  sweep: DcSweep,
  second: DcSweep | undefined,
  options: SimOptions,
): SweepOutcome {
  const outer = resolveSource(ws, sweep.source);
  const inner = second !== undefined ? resolveSource(ws, second.source) : undefined;
  const outerN = pointCount(sweep);
  const innerN = second !== undefined ? pointCount(second) : 1;
  const outerValues = new Float64Array(outerN);
  const innerValues = second !== undefined ? new Float64Array(outerN * innerN) : undefined;
  const size = ws.size;
  const snapshots = new Float64Array(size * outerN * innerN);

  let sample = 0;
  for (let o = 0; o < outerN; o++) {
    const outerValue = sweep.start + o * sweep.step;
    outerValues[o] = outerValue;
    setSource(ws, outer, outerValue);
    for (let i = 0; i < innerN; i++) {
      if (inner !== undefined && second !== undefined) {
        const innerValue = second.start + i * second.step;
        (innerValues as Float64Array)[o * innerN + i] = innerValue;
        setSource(ws, inner, innerValue);
      }
      stampAndSolvePoint(ws, options);
      snapshots.set(ws.x, sample * size);
      sample += 1;
    }
  }
  return { outerValues, innerValues, points: outerN * innerN, snapshots };
}

function pointCount(s: DcSweep): number {
  if (s.step === 0) {
    throw new EngineError({ code: "E_PARSE", message: `Sweep of ${s.source} has zero step` });
  }
  const n = Math.floor((s.stop - s.start) / s.step + 1e-9) + 1;
  if (n <= 0) {
    throw new EngineError({ code: "E_PARSE", message: `Sweep of ${s.source} has no points` });
  }
  return n;
}

/** Newton solve at one sweep point, warm-started from the previous point. */
function stampAndSolvePoint(ws: Workspace, options: SimOptions): void {
  runOpWarm(ws, options, 0);
}

interface SweptSource {
  deviceIndex: number;
}

function resolveSource(ws: Workspace, name: string): SweptSource {
  const lower = name.toLowerCase();
  const index = ws.devices.findIndex((d) => d.name.toLowerCase() === lower);
  if (index === -1) {
    throw new EngineError({
      code: "E_PARSE",
      message: `DC sweep source "${name}" not found in circuit`,
    });
  }
  const device = ws.devices[index] as { setDc?: (v: number) => void };
  if (device.setDc === undefined) {
    throw new EngineError({
      code: "E_PARSE",
      message: `DC sweep target "${name}" is not an independent V/I source`,
    });
  }
  return { deviceIndex: index };
}

function setSource(ws: Workspace, source: SweptSource, value: number): void {
  const device = ws.devices[source.deviceIndex] as { setDc?: (v: number) => void };
  (device.setDc as (v: number) => void)(value);
}
