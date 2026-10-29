/**
 * Analysis result types (SPEC §4.3/§5.5): datasets stream to the client as
 * `data` messages (E4); the CLI and tests consume them directly. All series
 * are Float64Array for zero-copy transfer.
 */

import type { AnalysisRequest, MeasureResult } from "@spicekit/protocol";

export type AnalysisKind = AnalysisRequest["kind"];

export interface SignalSeries {
  /** Canonical name: "v(node)" or "i(element)". */
  name: string;
  values: Float64Array;
}

export interface RunStats {
  points: number;
  newtonIterations: number;
  acceptedSteps: number;
  rejectedSteps: number;
  minStep: number;
  maxStep: number;
  /** Which OP method succeeded (E1: "direct"; E2 adds gmin/source stepping). */
  opMethod: string;
  /** Notes, e.g. unmatched probes. */
  notes: string[];
}

export interface RunResult {
  kind: AnalysisKind;
  /** Transient: sample times. Sweep: swept-source values. Length = points. */
  axis: Float64Array;
  axisName: string;
  /** Second sweep axis (nested DC sweeps); one value per sample. */
  axis2?: Float64Array;
  axis2Name?: string;
  signals: SignalSeries[];
  stats: RunStats;
  /** Evaluated `.measure` cards for this analysis (E3). */
  measures?: MeasureResult[];
}
