/**
 * .noise — small-signal noise analysis (E3, SPEC §5.5: "thermal, shot,
 * flicker for R/D/Q/M/J; output spectral density and integrated RMS").
 *
 * Adjoint (inter-reciprocal) method, one extra solve per frequency point:
 *
 *   1. Forward: A(f)·x = e_in gives the input→output transfer H_in(f)
 *      (unit excitation at the input source).
 *   2. Adjoint: A(f)ᴴ·z = e_out gives the noise-current→output transfer:
 *      a current source between (p, n) contributes |z_p − z_n|²·S_i(f) to
 *      the output PSD. z = conj(A⁻ᵀ)·e_out because
 *      (A⁻¹)_{out,p} = conj(z_p) for the conjugate-transpose solve.
 *
 * The total output PSD is the sum over every device noise source; the input-
 * referred PSD divides by |H_in|². Integrated RMS uses trapezoid on the sweep
 * grid. Device noise models live behind the `Device.noise` hook (resistor
 * Johnson 4kT/R; diode shot 2qI (+KF·I^AF/f); BJT junction shot, parasitic
 * thermal, flicker; MOSFET/JFET channel (8/3)kT·gm, flicker).
 */

import { EngineError } from "@spicekit/protocol";

import type { Device, NoiseSource } from "../devices/index.ts";
import { type AcRequestLike, acFrequency } from "./ac.ts";
import { AcWorkspace } from "./acws.ts";
import { runOp } from "./op.ts";
import type { RunStats, SignalSeries } from "./result.ts";
import type { Workspace } from "./workspace.ts";

export interface NoiseRequestLike extends AcRequestLike {
  output: string;
  source: string;
}

export interface NoiseOutcome {
  freqs: Float64Array;
  /** Output noise density (V/√Hz) per frequency point. */
  onoiseDensity: Float64Array;
  /** Input-referred density (V/√Hz for a V input, A/√Hz for I). */
  inoiseDensity: Float64Array;
  /** Trapezoid-integrated RMS over the sweep. */
  onoiseIntegrated: number;
  inoiseIntegrated: number;
  opMethod: string;
}

interface NoiseOutputSpec {
  p: number;
  n: number;
  /** Branch offset when the output is i(source). */
  branch: number;
  kind: "v" | "i";
}

interface NoiseInputSpec {
  kind: "v" | "i";
  branch: number;
  p: number;
  n: number;
}

export function runNoise(ws: Workspace, req: NoiseRequestLike): NoiseOutcome {
  const options = ws.compiled.options;
  const opMethod = runOp(ws, options, 0).method;

  const out = parseNoiseOutput(req.output, ws);
  const input = parseNoiseInput(req.source, ws);

  // Collect noise sources once per frequency (1/f terms depend on f).
  const acws = new AcWorkspace(ws);
  const points = acPointCountOf(req);
  const freqs = new Float64Array(points);
  const onoise = new Float64Array(points);
  const inoise = new Float64Array(points);

  for (let k = 0; k < points; k++) {
    const f = acFrequency(req, k);
    freqs[k] = f;
    acws.beginStamp();
    acws.stampAll(2 * Math.PI * f);

    // Forward: input → output transfer.
    applyUnitInput(acws, input);
    acws.factor();
    acws.solve();
    const hIn = readOutputValue(acws, out);
    if (Math.abs(hIn) < 1e-30) {
      // No input→output path: input-referred noise is undefined; report the
      // output density and zero input-referred values (ngspice divides too).
      onoise[k] = 0;
      inoise[k] = 0;
      continue;
    }

    // Adjoint: Aᴴ z = e_out (factor conj(Aᵀ), then the standard solves).
    acws.beginStamp();
    acws.stampAll(2 * Math.PI * f);
    applyAdjointExcitation(acws, out);
    acws.factorAdjoint();
    acws.solveAdjoint();

    // Sum every device noise source's contribution.
    let total = 0;
    for (let i = 0; i < ws.devices.length; i++) {
      const d = ws.devices[i] as Device;
      if (d.noise === undefined) {
        continue;
      }
      ws.prepareEnv(i, 0);
      const sources: NoiseSource[] = d.noise(ws.envRef(), f);
      for (const s of sources) {
        const zp = s.p >= 0 ? (acws.xc[2 * s.p] as number) : 0;
        const zn = s.n >= 0 ? (acws.xc[2 * s.n] as number) : 0;
        const ziP = s.p >= 0 ? (acws.xc[2 * s.p + 1] as number) : 0;
        const ziN = s.n >= 0 ? (acws.xc[2 * s.n + 1] as number) : 0;
        total += (zp * zp + ziP * ziP + zn * zn + ziN * ziN - 2 * (zp * zn + ziP * ziN)) * s.psd;
      }
    }
    onoise[k] = Math.max(total, 0);
    inoise[k] = (onoise[k] as number) / (hIn * hIn); // |H|² of the magnitude
  }

  return {
    freqs,
    onoiseDensity: onoise.map((v) => Math.sqrt(v)),
    inoiseDensity: inoise.map((v) => Math.sqrt(v)),
    onoiseIntegrated: trapzRms(freqs, onoise),
    inoiseIntegrated: trapzRms(freqs, inoise),
    opMethod,
  };
}

/** Trapezoid ∫S(f) df → RMS = sqrt(∫). */
function trapzRms(freqs: Float64Array, psd: Float64Array): number {
  let integral = 0;
  for (let k = 1; k < freqs.length; k++) {
    const df = (freqs[k] as number) - (freqs[k - 1] as number);
    integral += 0.5 * ((psd[k] as number) + (psd[k - 1] as number)) * df;
  }
  return Math.sqrt(Math.max(integral, 0));
}

export function noiseSignals(outcome: NoiseOutcome): SignalSeries[] {
  return [
    { name: "onoise_spectrum", values: outcome.onoiseDensity },
    { name: "inoise_spectrum", values: outcome.inoiseDensity },
  ];
}

export function noiseStats(outcome: NoiseOutcome): RunStats {
  return {
    points: outcome.freqs.length,
    newtonIterations: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    minStep: 0,
    maxStep: 0,
    opMethod: outcome.opMethod,
    notes: [
      `integrated onoise = ${outcome.onoiseIntegrated.toExponential(6)} V(rms)`,
      `integrated inoise = ${outcome.inoiseIntegrated.toExponential(6)}`,
    ],
  };
}

// ─── Adjoint machinery (implemented on AcWorkspace) ───────────────────────

function applyUnitInput(acws: AcWorkspace, input: NoiseInputSpec): void {
  if (input.kind === "v") {
    acws.addRhsAc(input.branch, 1, 0);
  } else {
    // Unit source value pulls 1 A out of p (matches the I-source convention).
    if (input.p >= 0) {
      acws.addRhsAc(input.p, -1, 0);
    }
    if (input.n >= 0) {
      acws.addRhsAc(input.n, 1, 0);
    }
  }
}

/** Adjoint excitation: unit vector(s) at the output unknown(s). */
function applyAdjointExcitation(acws: AcWorkspace, out: NoiseOutputSpec): void {
  if (out.kind === "v") {
    if (out.p >= 0) {
      acws.addRhsAc(out.p, 1, 0);
    }
    if (out.n >= 0) {
      acws.addRhsAc(out.n, -1, 0);
    }
    return;
  }
  // i() output: the branch current's sensitivity — excite the branch row.
  if (out.branch >= 0) {
    acws.addRhsAc(out.branch, 1, 0);
  }
}

function readOutputValue(acws: AcWorkspace, out: NoiseOutputSpec): number {
  // Complex magnitude of the input→output transfer.
  if (out.kind === "v") {
    const rp = out.p >= 0 ? (acws.xc[2 * out.p] as number) : 0;
    const ip = out.p >= 0 ? (acws.xc[2 * out.p + 1] as number) : 0;
    const rn = out.n >= 0 ? (acws.xc[2 * out.n] as number) : 0;
    const iN = out.n >= 0 ? (acws.xc[2 * out.n + 1] as number) : 0;
    return Math.hypot(rp - rn, ip - iN);
  }
  return Math.hypot(acws.xc[2 * out.branch] as number, acws.xc[2 * out.branch + 1] as number);
}

// ─── Parsing (shared shape with .tf) ────────────────────────────────────────

function acPointCountOf(req: AcRequestLike): number {
  if (!(req.points > 0) || !(req.fstop >= req.fstart) || req.fstart < 0) {
    throw new EngineError({
      code: "E_PARSE",
      message: ".noise needs points > 0 and 0 ≤ fstart ≤ fstop",
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

function parseNoiseOutput(spec: string, ws: Workspace): NoiseOutputSpec {
  const lower = spec.toLowerCase().replace(/\s+/g, "");
  const mv = /^v\(([^,)]+)(?:,([^)]+))?\)$/.exec(lower);
  if (mv !== null) {
    const p = nodeOffset(ws, mv[1] as string, spec);
    const n = mv[2] !== undefined ? nodeOffset(ws, mv[2], spec) : -1;
    return { kind: "v", p, n, branch: -1 };
  }
  const mi = /^i\(([^)]+)\)$/.exec(lower);
  if (mi !== null) {
    const branch = ws.compiled.branchByName.get((mi[1] as string).toLowerCase());
    if (branch === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `.noise output "${spec}" is not a voltage-branch element`,
      });
    }
    return { kind: "i", p: -1, n: -1, branch: ws.nodeCount + branch };
  }
  throw new EngineError({
    code: "E_PARSE",
    message: `.noise output must be v(node[,ref]) or i(source), got "${spec}"`,
  });
}

function parseNoiseInput(spec: string, ws: Workspace): NoiseInputSpec {
  const lower = spec.toLowerCase();
  const el = ws.compiled.elements.find((e) => e.name.toLowerCase() === lower);
  if (el === undefined || (el.type !== "V" && el.type !== "I")) {
    throw new EngineError({
      code: "E_PARSE",
      message: `.noise input source "${spec}" must be an independent V or I source`,
      ...(el !== undefined ? { location: { elementName: el.name } } : {}),
    });
  }
  if (el.type === "V") {
    const idx = ws.compiled.branchByName.get(lower);
    if (idx === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `.noise input source "${spec}" has no branch unknown`,
        location: { elementName: el.name },
      });
    }
    return { kind: "v", branch: ws.nodeCount + idx, p: -1, n: -1 };
  }
  return { kind: "i", branch: -1, p: el.nodes[0] as number, n: el.nodes[1] as number };
}

function nodeOffset(ws: Workspace, name: string, spec: string): number {
  const idx = ws.nodeIndexOf(name);
  if (idx < 0) {
    throw new EngineError({
      code: "E_PARSE",
      message: `.noise output "${spec}" references unknown node "${name}"`,
    });
  }
  return idx;
}
