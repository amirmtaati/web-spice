/**
 * .tf — small-signal transfer function (E3, SPEC §5.5: ".tf gives small-
 * signal gain, input and output resistance").
 *
 * Evaluated on the DC-linearized network (capacitors open, inductors short,
 * nonlinear devices at their operating-point conductances): the complex AC
 * workspace at ω = 0 IS that matrix — its solution is purely real.
 *
 *   gain  — unit excitation at the input source, measured at the output:
 *           v(out[,ref])/1 V, i(br)/1 V, v(out)/1 A, or i(br)/1 A.
 *   Rin   — V input: 1/(−i_source) (the source drives; ngspice's positive
 *           convention). I input: v(+)−v(−) across the 1 A injection.
 *   Rout  — input zeroed; unit current injected between the output nodes;
 *           the resulting node-pair voltage is the driving-point resistance.
 */

import { EngineError } from "@spicekit/protocol";

import { AcWorkspace } from "./acws.ts";
import { runOp } from "./op.ts";
import type { RunStats, SignalSeries } from "./result.ts";
import type { Workspace } from "./workspace.ts";

export interface TfRequestLike {
  output: string;
  source: string;
}

export interface TfOutcome {
  gain: number;
  inputResistance: number;
  outputResistance: number;
  opMethod: string;
}

interface OutputSpec {
  kind: "v" | "i";
  /** Branch offset for i() outputs. */
  branch: number;
  /** Node offsets for v() outputs (pair: out, ref). */
  p: number;
  n: number;
}

interface InputSpec {
  kind: "v" | "i";
  /** MNA offset: branch (V) or node pair (I). */
  branch: number;
  p: number;
  n: number;
}

export function runTf(ws: Workspace, req: TfRequestLike): TfOutcome {
  const options = ws.compiled.options;
  const opMethod = runOp(ws, options, 0).method;

  const out = parseOutput(req.output, ws);
  const input = parseInput(req.source, ws);
  const acws = new AcWorkspace(ws);

  // 1) Unit excitation at the input → gain and (for V inputs) Rin.
  acws.beginStamp();
  acws.stampAll(0);
  applyInput(acws, input, 1);
  acws.factor();
  acws.solve();
  const gain = readOutput(acws, out);
  let inputResistance: number;
  if (input.kind === "v") {
    const iIn = acws.xc[2 * input.branch] as number;
    // x[branch] = current INTO the + terminal; a driving source pushes
    // current OUT, so the seen resistance is −1/i (ngspice convention).
    inputResistance = iIn !== 0 ? -1 / iIn : Number.POSITIVE_INFINITY;
  } else {
    // I input: the unit source value pulls 1 A out of node p; the resistance
    // it sees is the negative of the resulting node-pair voltage.
    inputResistance = -(readNode(acws, input.p) - readNode(acws, input.n));
  }

  // 2) Input zeroed; unit current at the output pair → output resistance.
  acws.beginStamp();
  acws.stampAll(0);
  if (out.kind === "v") {
    injectCurrent(acws, out.p, out.n, 1);
  } else if (out.branch >= 0) {
    // i() output: measure at the controlling source's node pair.
    const owner = ws.compiled.branchOwners[out.branch - ws.nodeCount];
    const el = ws.compiled.elements.find(
      (e) => e.name.toLowerCase() === (owner ?? "").toLowerCase(),
    );
    if (el !== undefined && el.nodes.length >= 2) {
      injectCurrent(acws, el.nodes[0] as number, el.nodes[1] as number, 1);
    }
  }
  acws.factor();
  acws.solve();
  let outputResistance: number;
  if (out.kind === "v") {
    outputResistance = readNode(acws, out.p) - readNode(acws, out.n);
  } else {
    // Resistance seen at the i() branch's terminals.
    const owner = ws.compiled.branchOwners[out.branch - ws.nodeCount];
    const el = ws.compiled.elements.find(
      (e) => e.name.toLowerCase() === (owner ?? "").toLowerCase(),
    );
    outputResistance =
      el !== undefined && el.nodes.length >= 2
        ? readNode(acws, el.nodes[0] as number) - readNode(acws, el.nodes[1] as number)
        : Number.NaN;
  }

  return { gain, inputResistance, outputResistance, opMethod };
}

/** Build the TF signal series (three single-point values). */
export function tfSignals(outcome: TfOutcome): SignalSeries[] {
  return [
    { name: "transfer_function", values: new Float64Array([outcome.gain]) },
    { name: "input_impedance", values: new Float64Array([outcome.inputResistance]) },
    { name: "output_impedance", values: new Float64Array([outcome.outputResistance]) },
  ];
}

export function tfStats(outcome: TfOutcome): RunStats {
  return {
    points: 1,
    newtonIterations: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    minStep: 0,
    maxStep: 0,
    opMethod: outcome.opMethod,
    notes: [],
  };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function parseOutput(spec: string, ws: Workspace): OutputSpec {
  const lower = spec.toLowerCase().replace(/\s+/g, "");
  const mv = /^v\(([^,)]+)(?:,([^)]+))?\)$/.exec(lower);
  if (mv !== null) {
    const p = nodeOffset(ws, mv[1] as string, spec);
    const n = mv[2] !== undefined ? nodeOffset(ws, mv[2], spec) : -1;
    return { kind: "v", branch: -1, p, n };
  }
  const mi = /^i\(([^)]+)\)$/.exec(lower);
  if (mi !== null) {
    const branch = ws.compiled.branchByName.get((mi[1] as string).toLowerCase());
    if (branch === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `.tf output "${spec}" is not a voltage-branch element`,
      });
    }
    return { kind: "i", branch: ws.nodeCount + branch, p: -1, n: -1 };
  }
  throw new EngineError({
    code: "E_PARSE",
    message: `.tf output must be v(node[,ref]) or i(source), got "${spec}"`,
  });
}

function parseInput(spec: string, ws: Workspace): InputSpec {
  const lower = spec.toLowerCase();
  const el = ws.compiled.elements.find((e) => e.name.toLowerCase() === lower);
  if (el === undefined || (el.type !== "V" && el.type !== "I")) {
    throw new EngineError({
      code: "E_PARSE",
      message: `.tf input source "${spec}" must be an independent V or I source`,
      ...(el !== undefined ? { location: { elementName: el.name } } : {}),
    });
  }
  if (el.type === "V") {
    const idx = ws.compiled.branchByName.get(lower);
    if (idx === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `.tf input source "${spec}" has no branch unknown`,
        location: { elementName: el.name },
      });
    }
    return {
      kind: "v",
      branch: ws.nodeCount + idx,
      p: el.nodes[0] as number,
      n: el.nodes[1] as number,
    };
  }
  return { kind: "i", branch: -1, p: el.nodes[0] as number, n: el.nodes[1] as number };
}

function nodeOffset(ws: Workspace, name: string, spec: string): number {
  const idx = ws.nodeIndexOf(name);
  if (idx < 0) {
    throw new EngineError({
      code: "E_PARSE",
      message: `.tf output "${spec}" references unknown node "${name}"`,
    });
  }
  return idx;
}

// ─── Excitation and readout ─────────────────────────────────────────────────

/** Apply ±unit excitation from the input source. */
function applyInput(acws: AcWorkspace, input: InputSpec, scale: number): void {
  if (input.kind === "v") {
    acws.addRhsAc(input.branch, scale, 0);
  } else {
    // Unit current flows out of node p through the source into n — the
    // inverse of the injection used for resistance measurement.
    injectCurrent(acws, input.p, input.n, -scale);
  }
}

/** Inject `current` amperes INTO node p, OUT of node n (real, DC form). */
function injectCurrent(acws: AcWorkspace, p: number, n: number, current: number): void {
  if (p >= 0) {
    acws.addRhsAc(p, current, 0);
  }
  if (n >= 0) {
    acws.addRhsAc(n, -current, 0);
  }
}

function readNode(acws: AcWorkspace, k: number): number {
  return k < 0 ? 0 : (acws.xc[2 * k] as number);
}

function readOutput(acws: AcWorkspace, out: OutputSpec): number {
  if (out.kind === "v") {
    return readNode(acws, out.p) - readNode(acws, out.n);
  }
  return acws.xc[2 * out.branch] as number;
}
