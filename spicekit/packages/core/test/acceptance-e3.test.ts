/**
 * E3 acceptance criteria (SPEC §22 "E3: AC, noise, behavioral"):
 *
 *  1. Active-filter Bode matches reference — Sallen-Key unity-gain low-pass
 *     with the built-in op-amp macromodel. For equal components (R1=R2=R,
 *     C1=C2=C) and K=1 the nodal equations give exactly
 *         H(s) = 1 / (s²R²C² + 2sRC + 1) = 1/(1 + j·u)²,  u = f/f0,
 *     f0 = 1/(2πRC), so |H| = 1/(1+u²): |H(f0)| = 1/2, |H| = 1/√2 at
 *     u = √(√2−1), and −40 dB/dec asymptote 1/u².
 *  2. Op-amp macromodel GBW verified — OPAMP1P (A0=1e6, GBW=1e6, pole at
 *     GBW/A0 = 1 Hz) in a non-inverting ×10 amplifier. Exact closed-loop
 *     hand model with output-resistance loading:
 *         H(f) = kl·A(f) / (1 + kl·A(f)·β),   A(f) = A0/(1 + j·f/fp),
 *     kl = (R1p+R2)/(R1p+R2+ROUT) (the feedback divider loads ROUT), R1p =
 *     R1∥RIN, β = R1p/(R1p+R2). The gain-bandwidth product |H_DC|·f3dB must
 *     equal GBW.
 */
import { describe, expect, test } from "bun:test";

import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function magnitude(result: RunResult, name: string, k: number): number {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(
      `signal ${name} not found; have: ${result.signals.map((x) => x.name).join(", ")}`,
    );
  }
  return s.values[k] as number;
}

/** Relative error of a against b (b > 0). */
function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

/**
 * First downward crossing of `target` by `signal`, linearly interpolated
 * between the two adjacent sweep points. Returns NaN if there is none.
 */
function crossDown(result: RunResult, name: string, target: number): number {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) throw new Error(`signal ${name} not found`);
  for (let k = 1; k < result.axis.length; k++) {
    const m0 = s.values[k - 1] as number;
    const m1 = s.values[k] as number;
    if (m0 >= target && m1 < target) {
      const t = (m0 - target) / (m0 - m1);
      return (result.axis[k - 1] as number) * (1 - t) + (result.axis[k] as number) * t;
    }
  }
  return Number.NaN;
}

describe("E3 acceptance — active filter Bode (Sallen-Key + op-amp macromodel)", () => {
  const R = 10;
  const C = 10e-6;
  const f0 = 1 / (2 * Math.PI * R * C); // 1591.549 Hz
  const netlist = `sallen-key unity-gain low-pass, equal components
V1 in 0 AC 1
R1 in a 10
R2 a b 10
C1 a out 10u
C2 b 0 10u
X1 b out out OPAMP_IDEAL
.ac dec 2001 100 ${20 * f0}
.end
`;

  test("|H| matches 1/(1+u²) across the whole sweep (<1e-4 relative)", () => {
    const parsed = parseNetlist(netlist);
    const r = runAnalysis(compile(parsed), parsed.analyses[0] as { kind: "ac" });
    let maxRel = 0;
    for (let k = 0; k < r.axis.length; k++) {
      const f = r.axis[k] as number;
      const u = f / f0;
      const expected = 1 / (1 + u * u);
      const got = magnitude(r, "vm(out)", k);
      const e = relErr(got, expected);
      if (e > maxRel) maxRel = e;
    }
    expect(maxRel).toBeLessThan(1e-4);
  });

  test("signature points: Q at f0, −3 dB corner, −40 dB/dec rolloff", () => {
    const parsed = parseNetlist(netlist);
    const r = runAnalysis(compile(parsed), parsed.analyses[0] as { kind: "ac" });
    // Q signature: |H| crosses 0.5 exactly at f0 for the K=1 Sallen-Key.
    expect(relErr(crossDown(r, "vm(out)", 0.5), f0)).toBeLessThan(1e-4);
    // −3 dB point: |H| = 1/√2 at u = √(√2−1).
    const u3 = Math.sqrt(Math.SQRT2 - 1);
    expect(relErr(crossDown(r, "vm(out)", Math.SQRT1_2), u3 * f0)).toBeLessThan(1e-4);
    // One-decade rolloff: |H(10·f0)| = 1/101 (asymptote 1/100 → −40 dB/dec).
    expect(relErr(crossDown(r, "vm(out)", 1 / 101), 10 * f0)).toBeLessThan(1e-4);
    // Passband (u = 0.2): nearest grid point within 0.13% of the target;
    // |H| slope there contributes <1e-4 relative — 5e-4 bound is safe.
    const n = r.axis.length;
    const f0g = r.axis[0] as number;
    const f1g = r.axis[n - 1] as number;
    const k = Math.round((Math.log10((0.2 * f0) / f0g) / Math.log10(f1g / f0g)) * (n - 1));
    expect(relErr(magnitude(r, "vm(out)", k), 1 / (1 + 0.2 * 0.2))).toBeLessThan(5e-4);
  });

  test("vdb(out) is 20·log10|H| and crosses −6.02 dB exactly at f0", () => {
    const parsed = parseNetlist(netlist);
    const r = runAnalysis(compile(parsed), parsed.analyses[0] as { kind: "ac" });
    // dB conversion consistency on sampled grid points.
    for (let k = 0; k < r.axis.length; k += 250) {
      const vm = magnitude(r, "vm(out)", k);
      const vdb = magnitude(r, "vdb(out)", k);
      expect(Math.abs(vdb - 20 * Math.log10(vm))).toBeLessThan(1e-9);
    }
    // Bode convention: the −6.0206 dB (|H| = 1/2) crossing sits at f0.
    expect(relErr(crossDown(r, "vdb(out)", 20 * Math.log10(0.5)), f0)).toBeLessThan(1e-3);
  });
});

describe("E3 acceptance — op-amp macromodel GBW (OPAMP1P)", () => {
  const A0 = 1e6;
  const GBW = 1e6;
  const ROUT = 100;
  const RIN = 1e9;
  const R1 = 1e3;
  const R2 = 9e3;
  const netlist = `non-inverting x10 with single-pole macromodel
V1 in 0 AC 1
X1 in fb out OPAMP1P params: RIN=1e9
R1 fb 0 1k
R2 out fb 9k
.ac lin 401 1k 10meg
.end
`;

  // Exact hand model (see file header): kl·A(f)/(1 + kl·A(f)·β).
  const R1p = (R1 * RIN) / (R1 + RIN);
  const Rl = R1p + R2;
  const kl = Rl / (Rl + ROUT);
  const beta = R1p / Rl;
  const fp = GBW / A0;
  // Exact closed-loop magnitude with complex A(f): |kl·A| / |1 + β·kl·A|.
  const handMag = (f: number): number => {
    const x = f / fp;
    const ar = (A0 * kl) / (1 + x * x); // Re(kl·A(f))
    const ai = -(A0 * kl * x) / (1 + x * x); // Im(kl·A(f))
    return Math.hypot(ar, ai) / Math.hypot(1 + beta * ar, beta * ai);
  };

  test("|H| matches the exact closed-loop hand model across the sweep", () => {
    const parsed = parseNetlist(netlist);
    const r = runAnalysis(compile(parsed), parsed.analyses[0] as { kind: "ac" });
    let maxRel = 0;
    for (let k = 0; k < r.axis.length; k++) {
      const f = r.axis[k] as number;
      const e = relErr(magnitude(r, "vm(out)", k), handMag(f));
      if (e > maxRel) maxRel = e;
    }
    expect(maxRel).toBeLessThan(1e-4);
  });

  test("DC gain ≈ 10 and f3dB·|H_DC| ≈ GBW (gain-bandwidth product)", () => {
    const parsed = parseNetlist(netlist);
    const r = runAnalysis(compile(parsed), parsed.analyses[0] as { kind: "ac" });
    const dcGain = magnitude(r, "vm(out)", 0);
    expect(relErr(dcGain, 10)).toBeLessThan(1e-3);

    // Measure f3dB by interpolation on the |H| = |H_DC|/√2 crossing.
    const target = dcGain / Math.SQRT2;
    let f3dB = Number.NaN;
    for (let k = 1; k < r.axis.length; k++) {
      const m0 = magnitude(r, "vm(out)", k - 1);
      const m1 = magnitude(r, "vm(out)", k);
      if (m0 >= target && m1 < target) {
        const t = (m0 - target) / (m0 - m1);
        f3dB = (r.axis[k - 1] as number) * (1 - t) + (r.axis[k] as number) * t;
        break;
      }
    }
    expect(Number.isFinite(f3dB)).toBe(true);
    // GBW product: 10 × 100 kHz = 1 MHz.
    const gbwProduct = dcGain * f3dB;
    expect(relErr(gbwProduct, GBW)).toBeLessThan(0.01);
    // And the closed-loop bandwidth lands at GBW/gain as designed.
    expect(relErr(f3dB, GBW / 10)).toBeLessThan(0.01);
  });
});
