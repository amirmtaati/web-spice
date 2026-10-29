/**
 * AC small-signal analysis (E3, SPEC §5.5): linearize at the DC operating
 * point, then solve the complex MNA system per frequency.
 *
 *   dec: `points` per decade   — f_k = fstart · 10^(k/points)
 *   oct: `points` per octave   — f_k = fstart · 2^(k/points)
 *   lin: `points` total        — f_k = fstart + k·(fstop − fstart)/(points − 1)
 *
 * ω = 0 (a lin sweep reaching DC) takes the DC limit: capacitors open,
 * inductors ideal shorts. Signal series follow ngspice naming: vm/vp/vdb/
 * vr/vi per node, im/ip/idb/ir/ii per branch; a probe "v(out)" maps to the
 * magnitude variant vm(out).
 */

import { EngineError } from "@spicekit/protocol";
import { AcWorkspace } from "./acws.ts";
import { runOp } from "./op.ts";
import type { RunStats, SignalSeries } from "./result.ts";
import type { Workspace } from "./workspace.ts";

export interface AcRequestLike {
  sweep: "dec" | "oct" | "lin";
  points: number;
  fstart: number;
  fstop: number;
}

export interface AcOutcome {
  freqs: Float64Array;
  /** 2·size per point; column p is the interleaved complex solution. */
  snapshots: Float64Array;
  opMethod: string;
}

/** Sweep point count for the three SPICE sweep types. */
export function acPointCount(req: AcRequestLike): number {
  if (!(req.points > 0) || !(req.fstop >= req.fstart) || req.fstart < 0) {
    throw new EngineError({
      code: "E_PARSE",
      message: ".ac needs points > 0 and 0 ≤ fstart ≤ fstop",
    });
  }
  if (req.fstart === req.fstop) {
    return 1;
  }
  switch (req.sweep) {
    case "dec":
      return Math.floor(Math.log10(req.fstop / req.fstart) * req.points) + 1;
    case "oct":
      return Math.floor(Math.log2(req.fstop / req.fstart) * req.points) + 1;
    case "lin":
      return req.points;
  }
}

export function acFrequency(req: AcRequestLike, k: number): number {
  if (req.fstart === req.fstop) {
    return req.fstart;
  }
  switch (req.sweep) {
    case "dec":
      return req.fstart * 10 ** (k / req.points);
    case "oct":
      return req.fstart * 2 ** (k / req.points);
    case "lin": {
      const step = (req.fstop - req.fstart) / (req.points - 1);
      return Math.min(req.fstart + k * step, req.fstop);
    }
  }
}

export function runAc(ws: Workspace, req: AcRequestLike): AcOutcome {
  const options = ws.compiled.options;
  const points = acPointCount(req);
  const size = ws.size;
  const freqs = new Float64Array(points);
  const snapshots = new Float64Array(2 * size * points);
  const opMethod = runOp(ws, options, 0).method;
  const acws = new AcWorkspace(ws);
  for (let p = 0; p < points; p++) {
    const f = acFrequency(req, p);
    freqs[p] = f;
    acws.beginStamp();
    acws.stampAll(2 * Math.PI * f);
    acws.factor();
    acws.solve();
    snapshots.set(acws.xc, 2 * size * p);
  }
  return { freqs, snapshots, opMethod };
}

/** One complex component of an MNA unknown across all sweep points. */
function seriesFor(
  outcome: AcOutcome,
  slot: number,
  get: (re: number, im: number) => number,
): Float64Array {
  const size = outcome.freqs.length > 0 ? outcome.snapshots.length / (2 * outcome.freqs.length) : 0;
  const points = outcome.freqs.length;
  const out = new Float64Array(points);
  for (let p = 0; p < points; p++) {
    const base = 2 * size * p + 2 * slot;
    out[p] = get(outcome.snapshots[base] as number, outcome.snapshots[base + 1] as number);
  }
  return out;
}

function magnitudeOf(re: number, im: number): number {
  return Math.hypot(re, im);
}

function phaseOf(re: number, im: number): number {
  return (Math.atan2(im, re) * 180) / Math.PI;
}

function dbOf(re: number, im: number): number {
  const mag = Math.hypot(re, im);
  return mag > 0 ? 20 * Math.log10(mag) : -320;
}

type Component = (re: number, im: number) => number;

/**
 * Build AC signal series. Default set (no probes): vm/vp/vdb per node and
 * im per branch — vr/vi/ir/ii/ip are opt-in via explicit probes. A probe
 * "v(out)" matches the magnitude variant vm(out); "vdb(out)" matches directly.
 */
export function acSignals(
  nodeNames: string[],
  branchOwners: string[],
  nodeCount: number,
  outcome: AcOutcome,
  probeWanted: Set<string> | undefined,
): SignalSeries[] {
  const signals: SignalSeries[] = [];
  for (const node of nodeNames) {
    const lower = node.toLowerCase();
    const slot = nodeIndexOf(lower, nodeNames);
    if (slot < 0) {
      continue;
    }
    pushVariants(signals, outcome, probeWanted, NODE_VARIANTS, lower, slot, `v(${lower})`);
  }
  for (const owner of branchOwners) {
    if (owner.includes("#internal")) {
      continue;
    }
    const lower = owner.toLowerCase();
    pushVariants(
      signals,
      outcome,
      probeWanted,
      BRANCH_VARIANTS,
      lower,
      nodeCount + branchIndex(lower, branchOwners),
      `i(${lower})`,
    );
  }
  return signals;
}

const NODE_VARIANTS: readonly [string, Component][] = [
  ["vm", magnitudeOf],
  ["vp", phaseOf],
  ["vdb", dbOf],
  ["vr", (re) => re],
  ["vi", (_re, im) => im],
];

const BRANCH_VARIANTS: readonly [string, Component][] = [
  ["im", magnitudeOf],
  ["ip", phaseOf],
  ["idb", dbOf],
  ["ir", (re) => re],
  ["ii", (_re, im) => im],
];

function pushVariants(
  signals: SignalSeries[],
  outcome: AcOutcome,
  probeWanted: Set<string> | undefined,
  variants: readonly [string, Component][],
  base: string,
  slot: number,
  probeBase: string,
): void {
  // The "plain" variant that a bare probe ("v(out)" / "i(v1)") maps to.
  const plainVariant = probeBase.startsWith("v(") ? "vm" : "im";
  for (const [variant, get] of variants) {
    let matched: boolean;
    if (probeWanted !== undefined) {
      matched =
        probeWanted.has(`${variant}(${base})`) ||
        (variant === plainVariant && probeWanted.has(probeBase));
    } else {
      // Defaults: magnitude/phase/dB for nodes, magnitude for branches.
      matched = variant === "vm" || variant === "vp" || variant === "vdb" || variant === "im";
    }
    if (matched) {
      signals.push({ name: `${variant}(${base})`, values: seriesFor(outcome, slot, get) });
    }
  }
}

function nodeIndexOf(lower: string, nodeNames: string[]): number {
  for (let i = 0; i < nodeNames.length; i++) {
    if ((nodeNames[i] as string).toLowerCase() === lower) {
      return i;
    }
  }
  return -1;
}

function branchIndex(lower: string, branchOwners: string[]): number {
  for (let i = 0; i < branchOwners.length; i++) {
    if ((branchOwners[i] as string).toLowerCase() === lower) {
      return i;
    }
  }
  return -1;
}

/** Probe name → series name: "v(out)" reports magnitude "vm(out)". */
export function probeAlias(probe: string): string {
  const m = /^v\((.+)\)$/.exec(probe);
  if (m !== null) {
    return `vm(${m[1]})`;
  }
  const mi = /^i\((.+)\)$/.exec(probe);
  if (mi !== null) {
    return `im(${mi[1] as string})`;
  }
  return probe;
}

/** Stats for the small-signal analyses (no stepping involved). */
export function smallSignalStats(points: number, opMethod: string): RunStats {
  return {
    points,
    newtonIterations: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    minStep: 0,
    maxStep: 0,
    opMethod,
    notes: [],
  };
}
