/**
 * Analyses (SPEC §5.5): OP (Newton with the E2 fallback-ladder seam), DC
 * sweep, transient (BE/trap/Gear-2 with adaptive stepping). E1 implements
 * the linear subset; ac/noise/tf land with E3 (§22).
 */

import { type AnalysisRequest, EngineError, type SimOptions } from "@spicekit/protocol";

import type { CompiledCircuit } from "../compiler/index.ts";
import { type AcOutcome, acSignals, runAc } from "./ac.ts";
import { runDcSweep } from "./dc.ts";
import { noiseSignals, noiseStats, runNoise } from "./noise.ts";
import { runOp } from "./op.ts";
import type { AnalysisKind, RunResult, SignalSeries } from "./result.ts";
import { runTf, tfSignals, tfStats } from "./tf.ts";
import { runTransient } from "./tran.ts";
import { Workspace } from "./workspace.ts";

export type { AnalysisKind, RunResult, SignalSeries } from "./result.ts";

export interface AnalysisProgress {
  kind: AnalysisKind;
  fraction: number;
  simTime: number;
}

/**
 * Run one analysis against a compiled circuit. Fresh workspace each call —
 * analyses are pure functions of (circuit, request, options).
 */
export function runAnalysis(
  compiled: CompiledCircuit,
  request: AnalysisRequest,
  options?: Partial<SimOptions>,
): RunResult {
  const opts: SimOptions = { ...compiled.options, ...options };
  const ws = new Workspace({ ...compiled, options: opts });
  switch (request.kind) {
    case "op":
      return runOpAnalysis(ws, opts);
    case "dc":
      return runDcAnalysis(ws, opts, request);
    case "tran":
      return runTranAnalysis(ws, opts, request);
    case "ac":
      return runAcAnalysis(ws, request);
    case "tf":
      return runTfAnalysis(ws, request);
    case "noise":
      return runNoiseAnalysis(ws, request);
    default: {
      const never: never = request;
      throw new EngineError({
        code: "E_PARSE",
        message: `Unknown analysis ${JSON.stringify(never)}`,
      });
    }
  }
}

function runAcAnalysis(
  ws: Workspace,
  request: Extract<AnalysisRequest, { kind: "ac" }>,
): RunResult {
  const outcome: AcOutcome = runAc(ws, request);
  const points = outcome.freqs.length;
  const wanted = probeWanted(ws);
  const signals = acSignals(
    ws.compiled.nodeNames,
    ws.compiled.branchOwners,
    ws.nodeCount,
    outcome,
    wanted,
  );
  return {
    kind: "ac",
    axis: outcome.freqs,
    axisName: "freq",
    signals,
    stats: {
      points,
      newtonIterations: 0,
      acceptedSteps: 0,
      rejectedSteps: 0,
      minStep: 0,
      maxStep: 0,
      opMethod: outcome.opMethod,
      notes: [],
    },
  };
}

function runTfAnalysis(
  ws: Workspace,
  request: Extract<AnalysisRequest, { kind: "tf" }>,
): RunResult {
  const outcome = runTf(ws, request);
  return {
    kind: "tf",
    axis: new Float64Array([0]),
    axisName: "tf",
    signals: tfSignals(outcome),
    stats: tfStats(outcome),
  };
}

function runNoiseAnalysis(
  ws: Workspace,
  request: Extract<AnalysisRequest, { kind: "noise" }>,
): RunResult {
  const outcome = runNoise(ws, request);
  return {
    kind: "noise",
    axis: outcome.freqs,
    axisName: "freq",
    signals: noiseSignals(outcome),
    stats: noiseStats(outcome),
  };
}

function runOpAnalysis(ws: Workspace, options: SimOptions): RunResult {
  const outcome = runOp(ws, options, 0);
  const wanted = probeWanted(ws);
  const signals: SignalSeries[] = signalNamesFor(ws)
    .filter((name) => wanted === undefined || wanted.has(name))
    .map((name) => ({ name, values: new Float64Array([ws.x[signalIndex(name, ws)] as number]) }));
  return {
    kind: "op",
    axis: new Float64Array([0]),
    axisName: "op",
    signals,
    stats: {
      points: 1,
      newtonIterations: outcome.iterations,
      acceptedSteps: 0,
      rejectedSteps: 0,
      minStep: 0,
      maxStep: 0,
      opMethod: outcome.method,
      notes: [],
    },
  };
}

/** All default signals: v(node) for every node, i(element) per branch. */
function signalNamesFor(ws: Workspace): string[] {
  const names: string[] = [];
  for (const node of ws.compiled.nodeNames) {
    names.push(`v(${node.toLowerCase()})`);
  }
  for (const owner of ws.compiled.branchOwners) {
    // Device-internal KCL nodes (BJT b'/c'/e') are solver bookkeeping,
    // not probeable currents.
    if (owner.includes("#internal")) {
      continue;
    }
    names.push(`i(${owner.toLowerCase()})`);
  }
  return names;
}

function runDcAnalysis(
  ws: Workspace,
  options: SimOptions,
  request: Extract<AnalysisRequest, { kind: "dc" }>,
): RunResult {
  const { outerValues, innerValues, points, snapshots } = runDcSweep(
    ws,
    request,
    request.second,
    options,
  );
  const axisName =
    request.second !== undefined
      ? `sweep ${request.source}/${request.second.source}`
      : `sweep ${request.source}`;
  const signalNames = signalNamesFor(ws);
  const wanted = probeWanted(ws);
  const signals: SignalSeries[] = signalNames
    .filter((name) => wanted === undefined || wanted.has(name))
    .map((name) => ({ name, values: new Float64Array(points) }));
  for (let p = 0; p < points; p++) {
    ws.x.set(snapshots.subarray(p * ws.size, (p + 1) * ws.size));
    fillSignals(signals, p, ws);
  }
  return {
    kind: "dc",
    axis: outerValues,
    axisName,
    ...(innerValues !== undefined && request.second !== undefined
      ? { axis2: innerValues, axis2Name: `sweep ${request.second.source}` }
      : {}),
    signals,
    stats: {
      points,
      newtonIterations: 0,
      acceptedSteps: 0,
      rejectedSteps: 0,
      minStep: 0,
      maxStep: 0,
      opMethod: "direct",
      notes: [],
    },
  };
}

function runTranAnalysis(
  ws: Workspace,
  options: SimOptions,
  request: Extract<AnalysisRequest, { kind: "tran" }>,
): RunResult {
  const outcome = runTransient(ws, options, request);
  const points = outcome.times.length;
  const signalNames = signalNamesFor(ws);
  const wanted = probeWanted(ws);
  const signals: SignalSeries[] = signalNames
    .filter((name) => wanted === undefined || wanted.has(name))
    .map((name) => ({ name, values: new Float64Array(points) }));
  for (let p = 0; p < points; p++) {
    ws.x.set(outcome.snapshots.subarray(p * ws.size, (p + 1) * ws.size));
    fillSignals(signals, p, ws);
  }
  return {
    kind: "tran",
    axis: outcome.times,
    axisName: "time",
    signals,
    stats: {
      points,
      newtonIterations: 0,
      acceptedSteps: outcome.acceptedSteps,
      rejectedSteps: outcome.rejectedSteps,
      minStep: outcome.minStep,
      maxStep: outcome.maxStep,
      opMethod: request.uic === true ? "uic" : outcome.opMethod,
      notes: [],
    },
  };
}

/** Probe filter: null = all signals. */
function probeWanted(ws: Workspace): Set<string> | undefined {
  const probes = ws.compiled.probes;
  return probes.length > 0 ? new Set(probes.map((pr) => pr.signal.toLowerCase())) : undefined;
}

/** Fill signals[p] from the current ws.x. */
function fillSignals(signals: SignalSeries[], p: number, ws: Workspace): void {
  for (const sig of signals) {
    const idx = signalIndex(sig.name, ws);
    sig.values[p] = idx >= 0 ? (ws.x[idx] as number) : Number.NaN;
  }
}

function signalIndex(name: string, ws: Workspace): number {
  if (name.startsWith("v(")) {
    return ws.nodeIndexOf(name.slice(2, -1));
  }
  if (name.startsWith("i(")) {
    const owner = name.slice(2, -1).toLowerCase();
    const branchIdx = ws.compiled.branchOwners.findIndex((o) => o.toLowerCase() === owner);
    if (branchIdx === -1) {
      return -1;
    }
    return ws.nodeCount + branchIdx;
  }
  return -1;
}
