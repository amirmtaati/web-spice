/**
 * Analytical verification — OP and DC sweep (SPEC §13.2.1). Every expected
 * value is hand-derived from circuit theory with stated tolerances.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "Analytical",
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

describe("OP — analytical suite", () => {
  test("voltage divider (equal resistors)", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 10 },
      { type: "R", name: "R1", n: ["in", "mid"], value: 1000 },
      { type: "R", name: "R2", n: ["mid", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(in)")).toBeCloseTo(10, 9);
    expect(sig(r, "v(mid)")).toBeCloseTo(5, 9);
    // i(V1): current INTO the + terminal — current flows out → negative.
    expect(sig(r, "i(v1)")).toBeCloseTo(-0.005, 9);
  });

  test("loaded divider matches formula", () => {
    // V=12, R1=1k, R2=2k, Rload=3k: v(mid) = 12·(R2∥R3)/(R1+R2∥R3)
    const rParallel = (2000 * 3000) / 5000;
    const expected = 12 * (rParallel / (1000 + rParallel));
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 12 },
      { type: "R", name: "R1", n: ["in", "mid"], value: 1000 },
      { type: "R", name: "R2", n: ["mid", "0"], value: 2000 },
      { type: "R", name: "R3", n: ["mid", "0"], value: 3000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(mid)")).toBeCloseTo(expected, 9);
  });

  test("current source into resistor (both signs)", () => {
    // I1 out 0 1m: 1 mA leaves "out" through the source → v(out) = −1 V.
    const c1 = circuit([
      { type: "I", name: "I1", n: ["out", "0"], dc: 0.001 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r1 = runAnalysis(compile(c1), { kind: "op" });
    expect(sig(r1, "v(out)")).toBeCloseTo(-1, 9);

    // I2 0 out 1m: 1 mA flows INTO "out" → v(out) = +1 V.
    const c2 = circuit([
      { type: "I", name: "I2", n: ["0", "out"], dc: 0.001 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r2 = runAnalysis(compile(c2), { kind: "op" });
    expect(sig(r2, "v(out)")).toBeCloseTo(1, 9);
  });

  test("VCVS amplifies exactly", () => {
    const c = circuit([
      { type: "V", name: "Vs", n: ["in", "0"], dc: 0.1 },
      { type: "E", name: "E1", n: ["out", "0", "in", "0"], gain: 100 },
      { type: "R", name: "R1", n: ["out", "0"], value: 10000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(10, 9);
    expect(sig(r, "i(e1)")).toBeCloseTo(-0.001, 9); // 10V/10k out of + terminal
  });

  test("VCCS drives load resistor", () => {
    // SPICE G: current leaves n+ with magnitude gm·(v_cp − v_cn).
    // v(out) = −gm·vin·R = −1m·2·1k = −2 V (inverting transconductance).
    const c = circuit([
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "G", name: "G1", n: ["out", "0", "in", "0"], gm: 0.001 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(-2, 9);
  });

  test("CCCS mirrors controlling current", () => {
    // I forces 1 mA through V1; F1 mirrors ×2 into R=1k.
    // i(V1) = +1 mA (into + terminal), i_out = 2 mA out of "out" → v(out) = −2 V.
    const c = circuit([
      { type: "I", name: "I1", n: ["0", "a"], dc: 0.001 },
      { type: "V", name: "V1", n: ["a", "0"], dc: 0 },
      { type: "F", name: "F1", n: ["out", "0"], control: "V1", gain: 2 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "i(v1)")).toBeCloseTo(0.001, 9);
    expect(sig(r, "v(out)")).toBeCloseTo(-2, 9);
  });

  test("CCVS converts sense current to voltage", () => {
    // 2 mA through V1 → v(out) = H·i = 1k·2m = 2 V (drive via F loop).
    const c = circuit([
      { type: "I", name: "I1", n: ["0", "a"], dc: 0.002 },
      { type: "V", name: "V1", n: ["a", "0"], dc: 0 },
      { type: "H", name: "H1", n: ["out", "0"], control: "V1", gain: 1000 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(2, 9);
  });

  test("bridge circuit balances", () => {
    // Wheatstone bridge, ratio-matched → v(diff) = 0.
    const c = circuit([
      { type: "V", name: "V1", n: ["top", "0"], dc: 10 },
      { type: "R", name: "R1", n: ["top", "a"], value: 1000 },
      { type: "R", name: "R2", n: ["a", "0"], value: 2000 },
      { type: "R", name: "R3", n: ["top", "b"], value: 500 },
      { type: "R", name: "R4", n: ["b", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(a)")).toBeCloseTo((10 * 2) / 3, 9);
    expect(sig(r, "v(b)")).toBeCloseTo((10 * 2) / 3, 9);
  });

  test("inductor is a DC short, capacitor a DC open", () => {
    // L parallel: shorts mid to ground. C parallel to R1: carries no DC, so
    // the source current is set by R1 alone (5 V / 1 k).
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
      { type: "R", name: "R1", n: ["in", "mid"], value: 1000 },
      { type: "L", name: "L1", n: ["mid", "0"], value: 0.001 },
      { type: "C", name: "C1", n: ["in", "mid"], value: 1e-6 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(mid)")).toBeCloseTo(0, 9); // L shorted to ground
    expect(sig(r, "i(l1)")).toBeCloseTo(0.005, 9);
    expect(sig(r, "i(v1)")).toBeCloseTo(-0.005, 9); // R1 only — C is open
  });
});

describe("DC sweep — analytical suite", () => {
  test("voltage divider sweep traces a line", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 0 },
      { type: "R", name: "R1", n: ["in", "mid"], value: 1000 },
      { type: "R", name: "R2", n: ["mid", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "dc", source: "V1", start: 0, stop: 10, step: 2 });
    expect(r.stats.points).toBe(6);
    for (let i = 0; i <= 5; i++) {
      const vin = i * 2;
      expect(r.axis[i]).toBeCloseTo(vin, 9);
      expect(sig(r, "v(mid)", i)).toBeCloseTo(vin / 2, 9);
    }
  });

  test("nested sweeps produce outer×inner samples, inner fastest", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 0 },
      { type: "I", name: "I1", n: ["0", "mid"], dc: 0 },
      { type: "R", name: "R1", n: ["in", "mid"], value: 1000 },
      { type: "R", name: "R2", n: ["mid", "0"], value: 2000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "dc",
      source: "V1",
      start: 0,
      stop: 2,
      step: 1,
      second: { source: "I1", start: 0, stop: 0.002, step: 0.001 },
    });
    expect(r.stats.points).toBe(9);
    // Superposition: v(mid) = (2/3)·vin + (R1∥R2)·i with R1∥R2 = 666.67 Ω.
    let k = 0;
    for (let o = 0; o < 3; o++) {
      for (let i = 0; i < 3; i++) {
        const expected = (2 / 3) * (o * 1) + ((1000 * 2000) / 3000) * (i * 0.001);
        expect(sig(r, "v(mid)", k)).toBeCloseTo(expected, 9);
        k += 1;
      }
    }
    expect(r.axis2Name).toBe("sweep I1");
  });
});
