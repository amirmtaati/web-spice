/**
 * AC small-signal analysis — analytical suite (E3, SPEC §13.2.1). Expected
 * values hand-derived from phasor analysis: RC low-pass corner, LC resonance,
 * transformer ratio, sweep point counts, AC source phasors, probe aliases.
 * Linear sweeps are used where a target frequency must land exactly on the
 * axis (fstart + k·step hits fc by construction).
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "AC analytical",
    elements,
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
    ...extra,
  };
}

function sig(result: RunResult, name: string, point = 0): number {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(
      `signal ${name} not found; have: ${result.signals.map((x) => x.name).join(", ")}`,
    );
  }
  return s.values[point] as number;
}

/**
 * Index of a lin-sweep point: fstart + k·step, step = (fstop−fstart)/(N−1).
 * k must be chosen so the target is (nearly) exactly on the grid.
 */
function linPoint(result: RunResult, freq: number): number {
  const n = result.axis.length;
  const f0 = result.axis[0] as number;
  const f1 = result.axis[n - 1] as number;
  const step = (f1 - f0) / (n - 1);
  const k = Math.round((freq - f0) / step);
  const got = f0 + k * step;
  if (Math.abs(got - freq) > step * 1e-6) {
    throw new Error(`frequency ${freq} not on the lin grid (nearest ${got})`);
  }
  return k;
}

describe("AC — sweep generation", () => {
  test("dec points-per-decade count and decade spacing", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["a", "0"], dc: 1, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "dec",
      points: 10,
      fstart: 1,
      fstop: 1000,
    });
    // floor(log10(1000)·10) + 1 = 31 points; k=10 → one decade, k=30 → two.
    expect(r.axis.length).toBe(31);
    expect(r.axis[0]).toBeCloseTo(1, 9);
    expect(r.axis[10]).toBeCloseTo(10, 6);
    expect(r.axis[30]).toBeCloseTo(1000, 3);
  });

  test("oct points-per-octave count", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["a", "0"], dc: 1, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "oct",
      points: 6,
      fstart: 10,
      fstop: 320,
    });
    // floor(log2(32)·6) + 1 = 31 points
    expect(r.axis.length).toBe(31);
    expect(r.axis[30]).toBeCloseTo(320, 6);
  });

  test("lin even spacing includes both endpoints", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["a", "0"], dc: 1, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 100,
      fstart: 1,
      fstop: 100,
    });
    expect(r.axis.length).toBe(100);
    expect(r.axis[0]).toBeCloseTo(1, 9);
    expect(r.axis[99]).toBeCloseTo(100, 9);
  });
});

describe("AC — RC low-pass", () => {
  // V(ac 1) — 1k — out — 1µF — gnd.  H(f) = 1/(1 + j·f/fc), fc = 1591.55 Hz.
  // Lin sweep from fc/10 to 10·fc with 199 points → step = fc/20, so fc is
  // exactly point k = 18 and 10·fc is point k = 198.
  const R = 1e3;
  const C = 1e-6;
  const fc = 1 / (2 * Math.PI * R * C);

  function rc(): RunResult {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 0, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["in", "out"], value: R },
      { type: "C", name: "C1", n: ["out", "0"], value: C },
    ]);
    return runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 199,
      fstart: 0.1 * fc,
      fstop: 10 * fc,
    });
  }

  test("near-DC gain → 1, phase → 0", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 0, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["in", "out"], value: R },
      { type: "C", name: "C1", n: ["out", "0"], value: C },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 2,
      fstart: 1e-3,
      fstop: 10 * fc,
    });
    expect(sig(r, "vm(out)", 0)).toBeCloseTo(1, 9);
    expect(sig(r, "vp(out)", 0)).toBeCloseTo(0, 2); // −3.6e-5° at 1 mHz
  });

  test("corner frequency: |H| = 1/√2, φ = −45°, −3.01 dB", () => {
    const r = rc();
    const p = linPoint(r, fc);
    expect(sig(r, "vm(out)", p)).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(sig(r, "vp(out)", p)).toBeCloseTo(-45, 6);
    expect(sig(r, "vdb(out)", p)).toBeCloseTo(-3.0103, 4);
  });

  test("ten times the corner: −20.04 dB, ≈ −84.29°", () => {
    const r = rc();
    const p = linPoint(r, 10 * fc);
    expect(sig(r, "vdb(out)", p)).toBeCloseTo(-20.0432, 3);
    expect(sig(r, "vp(out)", p)).toBeCloseTo(-84.2894, 3);
  });

  test("input node follows the source exactly", () => {
    const r = rc();
    const p = linPoint(r, fc);
    expect(sig(r, "vm(in)", p)).toBeCloseTo(1, 9);
    expect(sig(r, "vp(in)", p)).toBeCloseTo(0, 9);
  });

  test("branch current through the source matches admittance", () => {
    const r = rc();
    const p = linPoint(r, fc);
    // i(V1) = v(out)·jωC  →  |i| = (1/√2)·ωC
    const expected = (1 / Math.SQRT2) * 2 * Math.PI * fc * C;
    expect(sig(r, "im(v1)", p)).toBeCloseTo(expected, 10);
  });
});

describe("AC — LC resonance", () => {
  // Current source 1 A into R ∥ L ∥ C.  |v| peaks at f0 = 1/(2π√(LC)) with
  // v(f0) = R (L and C susceptances cancel). R = 1k, L = 1 mH, C = 1 µF.
  const R = 1e3;
  const L = 1e-3;
  const C = 1e-6;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));

  test("parallel tank peaks at resonance with v = I·R", () => {
    const c = circuit([
      { type: "I", name: "I1", n: ["0", "tank"], dc: 0, ac: { mag: 1 } },
      { type: "R", name: "R1", n: ["tank", "0"], value: R },
      { type: "L", name: "L1", n: ["tank", "0"], value: L },
      { type: "C", name: "C1", n: ["tank", "0"], value: C },
    ]);
    // Lin sweep 0 → 2·f0 with 1001 points → f0 is exactly point k = 500.
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1001,
      fstart: 0,
      fstop: 2 * f0,
    });
    expect(sig(r, "vm(tank)", 500)).toBeCloseTo(R, 4);
    // At f0/2 the susceptance is −j·1.5·ω0C (L dominates), with 1/R along
    // the real axis: |Z| = 1/√((1/R)² + (1.5·ω0C)²).
    const zHalf = 1 / Math.sqrt((1 / R) ** 2 + (1.5 * 2 * Math.PI * f0 * C) ** 2);
    expect(sig(r, "vm(tank)", 250)).toBeCloseTo(zHalf, 6);
  });
});

describe("AC — coupled inductors (transformer)", () => {
  test("open-secondary ratio ≈ k·√(L2/L1)", () => {
    // L1 = 1 mH primary, L2 = 100 mH secondary, k = 0.999 → ratio ≈ 9.99.
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 0, ac: { mag: 10 } },
      { type: "R", name: "R1", n: ["in", "p"], value: 1 },
      { type: "L", name: "L1", n: ["p", "0"], value: 1e-3 },
      { type: "L", name: "L2", n: ["s", "0"], value: 1e-1 },
      { type: "K", name: "K1", inductors: ["L1", "L2"], coupling: 0.999 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 2,
      fstart: 1000,
      fstop: 1000,
    });
    const ratio = sig(r, "vm(s)") / sig(r, "vm(p)");
    expect(ratio).toBeCloseTo(0.999 * 10, 3);
  });
});

describe("AC — source phasors", () => {
  test("V source magnitude and phase appear verbatim at the node", () => {
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["a", "0"], dc: 0, ac: { mag: 2, phase: 90 } },
        { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
      ],
      {
        probes: [
          { signal: "vm(a)" },
          { signal: "vp(a)" },
          { signal: "vr(a)" },
          { signal: "vi(a)" },
        ],
      },
    );
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    expect(sig(r, "vm(a)")).toBeCloseTo(2, 9);
    expect(sig(r, "vp(a)")).toBeCloseTo(90, 9);
    expect(sig(r, "vr(a)")).toBeCloseTo(0, 9); // cos(90°) = 0
    expect(sig(r, "vi(a)")).toBeCloseTo(2, 9); // sin(90°) = 1
  });

  test("source without an AC card is an AC short (0 V)", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["a", "0"], dc: 5 },
      { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    expect(sig(r, "vm(a)")).toBeCloseTo(0, 12);
  });
});

describe("AC — netlist round trip and probes", () => {
  test(".ac card parses and v(out) probe maps to vm(out)", () => {
    const netlist = `AC probe test
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 20 10 100k
.print v(out)
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "ac" });
    expect(r.kind).toBe("ac");
    expect(r.signals.map((s) => s.name)).toEqual(["vm(out)"]);
    // Corner of 1k/1µF: the dec-20 axis includes f = 10·10^(k/20); the corner
    // 1591.55 Hz sits between points — verify at the two nearest points.
    let best = 0;
    for (let i = 0; i < r.axis.length; i++) {
      if (
        Math.abs((r.axis[i] as number) - 1 / (2 * Math.PI * 1e3 * 1e-6)) <
        Math.abs((r.axis[best] as number) - 1 / (2 * Math.PI * 1e3 * 1e-6))
      ) {
        best = i;
      }
    }
    expect(sig(r, "vm(out)", best)).toBeCloseTo(1 / Math.SQRT2, 2);
  });
});
