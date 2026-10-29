/**
 * Mutual inductance tests (SPEC §5.7 K): coupled-inductor physics via the
 * series aiding/opposing invariant. With a ramped current source I(t) the
 * total voltage is L_total·dI/dt where
 *   L_total = L1 + L2 ± 2M  (+ aiding, − opposing),  M = k·√(L1·L2).
 * This exercises the K cross-term stamps in the branch rows end-to-end.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";

import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";

function circuit(elements: Element[]): Circuit {
  return {
    title: "Mutual",
    elements,
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
  };
}

function rampSource(): Element {
  // 0 → 1 A over 1 ms (slope 1000 A/s), back down over the next 1 ms.
  return {
    type: "I",
    name: "I1",
    n: ["0", "n1"],
    dc: 0,
    wave: {
      kind: "PWL",
      points: [
        [0, 0],
        [1e-3, 1],
        [2e-3, 0],
      ],
    },
  };
}

describe("mutual inductance (K)", () => {
  const L = 1e-3;
  const k = 0.9;
  const M = k * L; // L1 = L2 = L
  const slope = 1000; // A/s during the ramp

  test("series aiding: v = (L1 + L2 + 2M)·dI/dt", () => {
    const c = circuit([
      rampSource(),
      { type: "L", name: "L1", n: ["n1", "n2"], value: L },
      { type: "L", name: "L2", n: ["n2", "0"], value: L },
      { type: "K", name: "K1", inductors: ["L1", "L2"], coupling: k },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 1.5e-3, tmax: 1e-5 });
    const v = r.signals.find((s) => s.name === "v(n1)")?.values as Float64Array;
    // Mid-ramp (0.5 ms): well inside the linear segment.
    const idx = 50;
    const expected = (L + L + 2 * M) * slope; // 3.8 mH · 1000 = 3.8 V
    expect(v[idx]).toBeCloseTo(expected, 1); // |Δ| < 50 mV
  });

  test("series opposing: v = (L1 + L2 − 2M)·dI/dt", () => {
    // Flipping L2's node order reverses the coupling sense.
    const c = circuit([
      rampSource(),
      { type: "L", name: "L1", n: ["n1", "n2"], value: L },
      { type: "L", name: "L2", n: ["0", "n2"], value: L },
      { type: "K", name: "K1", inductors: ["L1", "L2"], coupling: k },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 1.5e-3, tmax: 1e-5 });
    const v = r.signals.find((s) => s.name === "v(n1)")?.values as Float64Array;
    const idx = 50;
    const expected = (L + L - 2 * M) * slope; // 0.2 mH · 1000 = 0.2 V
    expect(v[idx]).toBeCloseTo(expected, 2); // |Δ| < 5 mV
  });

  test("uncoupled limit (k → small) matches plain sum", () => {
    const c = circuit([
      rampSource(),
      { type: "L", name: "L1", n: ["n1", "n2"], value: L },
      { type: "L", name: "L2", n: ["n2", "0"], value: L },
      { type: "K", name: "K1", inductors: ["L1", "L2"], coupling: 1e-6 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tran", tstep: 1e-5, tstop: 1.5e-3, tmax: 1e-5 });
    const v = r.signals.find((s) => s.name === "v(n1)")?.values as Float64Array;
    expect(v[50]).toBeCloseTo(2 * L * slope, 2); // 2 V
  });
});
