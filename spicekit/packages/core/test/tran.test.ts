/**
 * Transient analytical verification (SPEC §13.2.1): RC/RL/RLC/LC responses
 * against closed-form solutions, companion-method accuracy ordering,
 * breakpoint landing, adaptive stepping, and determinism. Tolerances are
 * stated and justified per test (trap + adaptive LTE keeps smooth-circuit
 * error well under 0.1%; assertions use 0.5–1% floors per SPEC §13.2.2).
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";

import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "Tran",
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

function series(result: ReturnType<typeof runAnalysis>, name: string): Float64Array {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(
      `signal ${name} not found; have: ${result.signals.map((x) => x.name).join(", ")}`,
    );
  }
  return s.values;
}

function valueAt(result: ReturnType<typeof runAnalysis>, name: string, t: number): number {
  const times = result.axis;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs((times[i] as number) - t);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (bestDist > 1e-9) {
    throw new Error(`no sample near t=${t} (closest ${bestDist})`);
  }
  return series(result, name)[best] as number;
}

describe("transient — RC networks", () => {
  test("RC charging: 63.2% at τ, exponential envelope within 0.5%", () => {
    // V step 5 V, R = 1 k, C = 1 µ → τ = 1 ms.
    const c = circuit([
      {
        type: "V",
        name: "V1",
        n: ["in", "0"],
        dc: 0,
        wave: {
          kind: "PULSE",
          v1: 0,
          v2: 5,
          delay: 0,
          rise: 1e-12,
          fall: 1e-12,
          width: 0.01,
          period: 0.02,
        },
      },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "C", name: "C1", n: ["out", "0"], value: 1e-6 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 0.006, tmax: 2e-5 });
    const tau = 1e-3;
    for (const k of [0.5, 1, 2, 3, 5]) {
      const expected = 5 * (1 - Math.exp(-k));
      const got = valueAt(r, "v(out)", k * tau);
      expect(got).toBeCloseTo(expected, 2); // |Δ| < 5 mV = 0.1% of 5 V
    }
    // The classic 63.2% checkpoint.
    expect(valueAt(r, "v(out)", tau) / 5).toBeGreaterThan(0.63);
    expect(valueAt(r, "v(out)", tau) / 5).toBeLessThan(0.634);
  });

  test("RC discharge from uic initial condition: v(τ) = V0·e⁻¹", () => {
    const c = circuit([
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
      { type: "C", name: "C1", n: ["out", "0"], value: 1e-6, ic: 5 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 0.005, uic: true });
    const tau = 1e-3;
    expect(valueAt(r, "v(out)", 0)).toBeCloseTo(5, 6);
    for (const k of [0.5, 1, 2, 4]) {
      const expected = 5 * Math.exp(-k);
      expect(valueAt(r, "v(out)", k * tau)).toBeCloseTo(expected, 2);
    }
  });

  test("PULSE train through RC: plateau values and edge landing", () => {
    // Square wave 0/5 V, period 2 ms, τ = 100 µs: quasi-steady-state
    // plateaus v_lo = 5/(1+e^{T/(2τ)}) ... exact values below.
    const tau = 1e-4; // RC = 1 kΩ · 100 nF
    const half = 1e-3;
    const _a = Math.exp(-half / tau); // e^{-10} ≈ 4.54e-5 → essentially full swing
    const c = circuit([
      {
        type: "V",
        name: "V1",
        n: ["in", "0"],
        dc: 0,
        wave: {
          kind: "PULSE",
          v1: 0,
          v2: 5,
          delay: 0,
          rise: 1e-9,
          fall: 1e-9,
          width: half,
          period: 2 * half,
        },
      },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "C", name: "C1", n: ["out", "0"], value: 1e-7 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 5e-5, tstop: 0.004, tmax: 1e-5 });
    // tmax = τ/10 keeps the exponential discharge accurate on the coarse
    // output grid (adaptive sub-stepping between grid points).
    // End of the first high half: fully charged. Mid-discharge: exponential.
    expect(valueAt(r, "v(out)", 0.95e-3)).toBeGreaterThan(5 * (1 - Math.exp(-9.5)) - 1e-6);
    expect(valueAt(r, "v(out)", 1.5e-3)).toBeCloseTo(5 * Math.exp(-5), 3); // 0.5 ms = 5τ
    expect(valueAt(r, "v(out)", 1.95e-3)).toBeLessThan(5 * Math.exp(-9.5) + 1e-3);
    // Second cycle recharges from ~0: v(0.5 ms in) = 5·(1 − e^{−5}).
    expect(valueAt(r, "v(out)", 2.5e-3)).toBeCloseTo(5 * (1 - Math.exp(-5)), 2);
    // Breakpoint landing: samples exist exactly at the switching edges.
    const times = r.axis;
    const hasEdge = [1e-3, 2e-3, 3e-3].every((edge) =>
      [...times].some((t) => Math.abs(t - edge) < 1e-12),
    );
    expect(hasEdge).toBe(true);
  });

  test("PWL source reproduces exact piecewise values through a resistor", () => {
    // Resistive divider with a PWL source: no dynamics → exact values.
    const c = circuit([
      {
        type: "V",
        name: "V1",
        n: ["in", "0"],
        dc: 0,
        wave: {
          kind: "PWL",
          points: [
            [0, 0],
            [1e-3, 2],
            [2e-3, 2],
            [3e-3, -1],
          ],
        },
      },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "R", name: "R2", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 2.5e-4, tstop: 3e-3 });
    // Divider halves the source: v(out) = v(in)/2.
    expect(valueAt(r, "v(out)", 0.5e-3)).toBeCloseTo(0.5, 9); // vin=1
    expect(valueAt(r, "v(out)", 2.5e-3)).toBeCloseTo(0.25, 9); // vin=0.5
    expect(valueAt(r, "v(out)", 3e-3)).toBeCloseTo(-0.5, 9); // vin=-1
  });
});

describe("transient — RL networks", () => {
  test("RL current rise: i(t) = (V/R)(1 − e^{−tR/L})", () => {
    // V step 10 V, R = 10 Ω, L = 1 mH → τ = L/R = 100 µs, i∞ = 1 A.
    const c = circuit([
      {
        type: "V",
        name: "V1",
        n: ["in", "0"],
        dc: 0,
        wave: {
          kind: "PULSE",
          v1: 0,
          v2: 10,
          delay: 0,
          rise: 1e-12,
          fall: 1e-12,
          width: 0.01,
          period: 0.02,
        },
      },
      { type: "R", name: "R1", n: ["in", "out"], value: 10 },
      { type: "L", name: "L1", n: ["out", "0"], value: 1e-3 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 0.0008, tmax: 2e-5 });
    const tau = 1e-4;
    for (const k of [0.5, 1, 2, 3]) {
      const expected = 1 * (1 - Math.exp(-k));
      expect(valueAt(r, "i(l1)", k * tau)).toBeCloseTo(expected, 2);
    }
  });
});

describe("transient — RLC networks", () => {
  test("series RLC underdamped step response matches closed form", () => {
    // V=5, R=100 Ω, L=10 mH, C=1 µF:
    // α = R/2L = 5000, ω0 = 1/√(LC) = 10000, ωd = ω0√(1−(α/ω0)²) ≈ 8660.25
    // v_c(t) = V·(1 − e^{−αt}(cos ωd t + (α/ωd) sin ωd t))
    const V = 5,
      R = 100,
      L = 0.01,
      C = 1e-6;
    const alpha = R / (2 * L);
    const w0 = 1 / Math.sqrt(L * C);
    const wd = w0 * Math.sqrt(1 - (alpha / w0) ** 2);
    const c = circuit([
      {
        type: "V",
        name: "V1",
        n: ["in", "0"],
        dc: 0,
        wave: {
          kind: "PULSE",
          v1: 0,
          v2: V,
          delay: 0,
          rise: 1e-12,
          fall: 1e-12,
          width: 0.02,
          period: 0.04,
        },
      },
      { type: "R", name: "R1", n: ["in", "n1"], value: R },
      { type: "L", name: "L1", n: ["n1", "n2"], value: L },
      { type: "C", name: "C1", n: ["n2", "0"], value: C },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 2e-5, tstop: 0.003, tmax: 5e-5 });
    for (const t of [2e-4, 5e-4, 8e-4, 1.2e-3, 2e-3]) {
      const expected =
        V * (1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t)));
      expect(valueAt(r, "v(n2)", t)).toBeCloseTo(expected, 1); // |Δ| < 50 mV (1% of swing)
    }
  });

  test("LC tank conserves energy (uic, small damping)", () => {
    // C charged to 1 V via uic, L = 1 mH → oscillation at f = 1/(2π√(LC))
    // ≈ 5033 Hz, period ≈ 198.7 µs. Energy E = ½Cv² + ½Li² constant.
    const C = 1e-6,
      L = 1e-3,
      R = 0.01;
    const c = circuit([
      { type: "R", name: "R1", n: ["a", "b"], value: R },
      { type: "L", name: "L1", n: ["b", "0"], value: L },
      { type: "C", name: "C1", n: ["a", "0"], value: C, ic: 1 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "tran",
      tstep: 2e-6,
      tstop: 1e-3,
      uic: true,
      tmax: 1e-5,
    });
    const E0 = 0.5 * C * 1; // initial energy (all in the cap)
    const vA = series(r, "v(a)");
    const iL = series(r, "i(l1)");
    for (let k = 0; k < vA.length; k += 10) {
      const t = r.axis[k] as number;
      const vc = vA[k] as number;
      const il = iL[k] as number;
      // Instantaneous energy vs the exact dissipation envelope: for a series
      // RL tank the energy decays as E0·e^{−Rt/L} (τ_E = L/R = 0.1 s).
      const energy = 0.5 * C * vc * vc + 0.5 * L * il * il;
      const expected = E0 * Math.exp((-R / L) * t);
      expect(Math.abs(energy - expected) / E0).toBeLessThan(0.01);
    }
  });
});

describe("transient — integration methods", () => {
  const rcCircuit = (method?: "trap" | "be" | "gear2") =>
    circuit(
      [
        {
          type: "V",
          name: "V1",
          n: ["in", "0"],
          dc: 0,
          wave: {
            kind: "PULSE",
            v1: 0,
            v2: 5,
            delay: 0,
            rise: 1e-12,
            fall: 1e-12,
            width: 0.01,
            period: 0.02,
          },
        },
        { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
        { type: "C", name: "C1", n: ["out", "0"], value: 1e-6 },
      ],
      method !== undefined ? { options: { ...DEFAULT_SIM_OPTIONS, method } } : {},
    );

  function rmsError(got: Float64Array, times: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i] as number;
      const expected = 5 * (1 - Math.exp(-t / 1e-3));
      const d = (got[i] as number) - expected;
      sum += d * d;
    }
    return Math.sqrt(sum / times.length);
  }

  test("trapezoidal beats backward Euler on smooth response", () => {
    const h = 1e-4; // deliberately coarse (h/τ = 0.1)
    const rTrap = runAnalysis(compile(rcCircuit("trap")), {
      kind: "tran",
      tstep: h,
      tstop: 5e-3,
      tmax: h,
    });
    const rBe = runAnalysis(compile(rcCircuit("be")), {
      kind: "tran",
      tstep: h,
      tstop: 5e-3,
      tmax: h,
    });
    const errTrap = rmsError(series(rTrap, "v(out)"), rTrap.axis);
    const errBe = rmsError(series(rBe, "v(out)"), rBe.axis);
    expect(errTrap).toBeLessThan(errBe / 5);
    expect(errBe).toBeLessThan(0.05); // sanity: BE still converges
  });

  test("gear2 runs and stays accurate", () => {
    const h = 1e-4;
    const r = runAnalysis(compile(rcCircuit("gear2")), {
      kind: "tran",
      tstep: h,
      tstop: 5e-3,
      tmax: h,
    });
    // BDF2 over grid-landed steps with event restarts: keep < 1% of swing.
    expect(rmsError(series(r, "v(out)"), r.axis)).toBeLessThan(0.05);
  });

  test("adaptive stepping respects tmax and records exact grid", () => {
    const r = runAnalysis(compile(rcCircuit()), {
      kind: "tran",
      tstep: 1e-4,
      tstop: 2e-3,
      tmax: 5e-5,
    });
    expect(r.stats.maxStep).toBeLessThanOrEqual(5e-5 + 1e-15);
    expect(r.stats.acceptedSteps).toBeGreaterThan(r.axis.length); // sub-stepping happened
    // Grid points land exactly on multiples of tstep.
    for (let i = 0; i < r.axis.length; i++) {
      expect(Math.abs((r.axis[i] as number) - i * 1e-4)).toBeLessThan(1e-12);
    }
  });

  test("same inputs give bit-identical results (determinism, SPEC §14)", () => {
    const r1 = runAnalysis(compile(rcCircuit()), { kind: "tran", tstep: 5e-5, tstop: 1e-3 });
    const r2 = runAnalysis(compile(rcCircuit()), { kind: "tran", tstep: 5e-5, tstop: 1e-3 });
    expect([...series(r1, "v(out)")]).toEqual([...series(r2, "v(out)")]);
    expect([...r1.axis]).toEqual([...r2.axis]);
  });
});
