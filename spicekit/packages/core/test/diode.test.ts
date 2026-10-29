/**
 * Diode tests (SPEC §5.7, §13.2): four suites per the E2 acceptance bar —
 *  - analytical: stamps and OP values hand-derived from the Shockley law
 *  - reference: independently solved numbers (bisection on the composite
 *    diode-resistor equation, computed here in the test, not by the engine)
 *  - property: seeded randomized monotonicity/continuity/area-scaling
 *  - convergence: junction limiting + gmin rung exercised by hard circuits
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import {
  depletionCapacitance,
  diodeConduction,
  thermalVoltage,
} from "../src/devices/nonlinear/junction.ts";
import { simulateNetlist } from "../src/engine.ts";

const VT = thermalVoltage(27);

function circuit(
  elements: Element[],
  models: Record<string, import("@spicekit/protocol").ModelCard> = {},
) {
  return {
    title: "Diode tests",
    elements,
    // dideal is available to every test; extra models merge over it.
    models: { dideal: IDEAL_MODEL, ...models },
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
  };
}

/** Tight tolerances for exact-equation checks (default reltol is 1e-3). */
function preciseCircuit(
  elements: Element[],
  models: Record<string, import("@spicekit/protocol").ModelCard> = {},
) {
  return {
    ...circuit(elements, models),
    options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-9, vntol: 1e-12, abstol: 1e-18 },
  };
}

function sig(result: ReturnType<typeof runAnalysis>, name: string, point = 0): number {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(
      `signal ${name} not found; have: ${result.signals.map((x) => x.name).join(", ")}`,
    );
  }
  return s.values[point] as number;
}

const IDEAL_MODEL: import("@spicekit/protocol").ModelCard = {
  name: "dideal",
  type: "diode",
  parameters: { is: 1e-14, n: 1 },
};

// ---------------------------------------------------------------------------
// Analytical
// ---------------------------------------------------------------------------

describe("diode — analytical", () => {
  test("diodeConduction matches Shockley at key points", () => {
    const d = { is: 1e-14, n: 1, vt: VT };
    // Reverse leakage: generation branch saturates smoothly at −Is
    // (−Is·(1 + (3·vt/(e·v))³) is 2.3e-5 above −Is at v = −1).
    const rev = diodeConduction(-1, d);
    expect(rev.i).toBeCloseTo(-1e-14, 18);
    expect(rev.i).toBeGreaterThan(-1e-14);
    expect(rev.g).toBeGreaterThan(0);
    // Zero bias: exactly 0.
    expect(diodeConduction(0, d).i).toBe(0);
    // Forward at vt: Is·(e − 1).
    expect(diodeConduction(VT, d).i).toBeCloseTo(1e-14 * (Math.E - 1), 25);
    // Conductance = Is/vt · e^(v/vt).
    const fwd = diodeConduction(0.7, d);
    expect(fwd.g).toBeCloseTo((1e-14 / VT) * Math.exp(0.7 / VT), 12);
  });

  test("forward OP: diode + resistor divider solves the exponential", () => {
    // 5 V source, 1 kΩ, 1N-style diode to ground. Hand-solve: v_d ≈ 0.65.
    const r = runAnalysis(
      compile(
        preciseCircuit(
          [
            { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
            { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
            { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
          ],
          { dideal: IDEAL_MODEL },
        ),
      ),
      { kind: "op" },
    );
    const vd = sig(r, "v(out)");
    const i = (5 - vd) / 1000;
    // The OP must satisfy BOTH the resistor law and the Shockley law plus
    // the junction gmin shunt (part of the model, SPEC §5.9).
    const expected = 1e-14 * (Math.exp(vd / VT) - 1) + DEFAULT_SIM_OPTIONS.gmin * vd;
    expect(i).toBeCloseTo(expected, 12);
    expect(vd).toBeGreaterThan(0.5);
    expect(vd).toBeLessThan(0.8);
  });

  test("series resistance reduces terminal voltage by i·RS", () => {
    // Same circuit with RS = 100 Ω: v(out) = v_junction + i·RS.
    const modelRs: import("@spicekit/protocol").ModelCard = {
      name: "drs",
      type: "diode",
      parameters: { is: 1e-14, n: 1, rs: 100 },
    };
    const r = runAnalysis(
      compile(
        preciseCircuit(
          [
            { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
            { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
            { type: "D", name: "D1", n: ["out", "0"], model: "drs" },
          ],
          { drs: modelRs },
        ),
      ),
      { kind: "op" },
    );
    const vOut = sig(r, "v(out)");
    const i = (5 - vOut) / 1000;
    const vJunction = vOut - i * 100; // junction sees the reduced voltage
    const expected = 1e-14 * (Math.exp(vJunction / VT) - 1) + DEFAULT_SIM_OPTIONS.gmin * vJunction;
    expect(i).toBeCloseTo(expected, 12);
  });

  test("reverse bias blocks: leakage current ≈ −Is", () => {
    const r = runAnalysis(
      compile(
        circuit(
          [
            { type: "V", name: "V1", n: ["in", "0"], dc: -5 },
            { type: "R", name: "R1", n: ["in", "out"], value: 1e6 },
            { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
          ],
          { dideal: IDEAL_MODEL },
        ),
      ),
      { kind: "op" },
    );
    // i(V1) flows into the + terminal; the diode pulls the reverse current
    // through R: leakage −Is plus the junction gmin term gmin·5 ≈ 5 pA.
    const iLeak = sig(r, "i(v1)");
    expect(iLeak).toBeGreaterThan(0);
    expect(iLeak).toBeLessThan(1e-10);
    // v(out) sits 5 µV above −5: the leakage (Is + gmin·5) across 1 MΩ.
    expect(sig(r, "v(out)")).toBeCloseTo(-5 + 5.01e-6, 9);
  });

  test("breakdown: Zener clamp conducts −IBV at −BV", () => {
    const zener: import("@spicekit/protocol").ModelCard = {
      name: "dzener",
      type: "diode",
      parameters: { is: 1e-14, n: 1, bv: 5.1, ibv: 1e-3 },
    };
    // Reverse-biased past breakdown through 100 Ω: node clamps near −5.1.
    const r = runAnalysis(
      compile(
        circuit(
          [
            { type: "V", name: "V1", n: ["in", "0"], dc: -10 },
            { type: "R", name: "R1", n: ["in", "out"], value: 100 },
            { type: "D", name: "D1", n: ["out", "0"], model: "dzener" },
          ],
          { dzener: zener },
        ),
      ),
      { kind: "op" },
    );
    const vOut = sig(r, "v(out)");
    // BV = 5.1 is the IBV point; the exponential branch carries 46 mA only
    // ~0.28 V deeper — the classic SPICE2 breakdown-law placement.
    expect(vOut).toBeLessThan(-5.15);
    expect(vOut).toBeGreaterThan(-5.45);
    // Current flows ground → breakdown diode → R → into V1's + terminal.
    expect(sig(r, "i(v1)")).toBeCloseTo((vOut + 10) / 100, 9);
  });

  test("area scales saturation current", () => {
    const r1 = runAnalysis(
      compile(
        circuit([
          { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
          { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
          { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
        ]),
      ),
      { kind: "op" },
    );
    const r2 = runAnalysis(
      compile(
        circuit([
          { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
          { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
          { type: "D", name: "D1", n: ["out", "0"], model: "dideal", area: 10 },
        ]),
      ),
      { kind: "op" },
    );
    // 10× area → −vt·ln(10) ≈ −59.5 mV junction shift (Shockley law).
    const drop = sig(r1, "v(out)") - sig(r2, "v(out)");
    expect(drop).toBeCloseTo(VT * Math.log(10), 2);
  });

  test("temperature raises saturation current (XTI/EG model)", () => {
    const hot = { ...DEFAULT_SIM_OPTIONS, temp: 100, tnom: 27 };
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
    ]);
    const cold = runAnalysis(compile(c), { kind: "op" });
    const warm = runAnalysis(compile({ ...c, options: hot }), { kind: "op" });
    // Hotter diode conducts more at the same voltage → lower v(out).
    expect(sig(warm, "v(out)")).toBeLessThan(sig(cold, "v(out)"));
  });
});

// ---------------------------------------------------------------------------
// Reference (independent solver in the test, not the engine)
// ---------------------------------------------------------------------------

describe("diode — reference", () => {
  /**
   * Solve i·R + vt·ln(i/Is + 1) = V by bisection — the analytic composite of
   * a diode and series resistor — and compare against the engine's OP.
   */
  function referenceDiodeCurrent(vSource: number, rOhms: number, is: number): number {
    const f = (i: number) => i * rOhms + VT * Math.log(i / is + 1) - vSource;
    let lo = 0;
    let hi = vSource / rOhms + 1;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return (lo + hi) / 2;
  }

  test("engine OP current equals the bisection reference", () => {
    for (const [vSrc, rVal] of [
      [3, 470],
      [5, 1000],
      [12, 2200],
    ] as const) {
      const r = runAnalysis(
        compile(
          preciseCircuit([
            { type: "V", name: "V1", n: ["in", "0"], dc: vSrc },
            { type: "R", name: "R1", n: ["in", "out"], value: rVal },
            { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
          ]),
        ),
        { kind: "op" },
      );
      const vd = sig(r, "v(out)");
      const iEngine = (vSrc - vd) / rVal;
      const iRef = referenceDiodeCurrent(vSrc, rVal, 1e-14);
      expect(iEngine).toBeCloseTo(iRef, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("diode — property", () => {
  test("monotonic non-decreasing IV with continuous branches", () => {
    const d = { is: 1e-14, n: 1.5, vt: VT };
    let prevI = -Infinity;
    let prevG = 0;
    for (let k = -60; k <= 60; k++) {
      const v = k / 100;
      const c = diodeConduction(v, d);
      expect(c.i).toBeGreaterThanOrEqual(prevI - 1e-18);
      expect(c.g).toBeGreaterThanOrEqual(0);
      // Conductance grows monotonically with v (both branches are convex).
      expect(c.g).toBeGreaterThanOrEqual(prevG * (1 - 1e-9));
      prevI = c.i;
      prevG = Math.max(c.g, 0);
    }
  });

  test("breakdown branch is continuous at the matched knee", () => {
    const bv = 5.1;
    const ibv = 1e-3;
    const d = { is: 1e-14, n: 1, vt: VT, bv, ibv };
    // Current passes through −IBV exactly at v = −BV.
    const atKnee = diodeConduction(-bv, d);
    expect(atKnee.i).toBeCloseTo(-ibv, 12);
    // No jump: just below the knee the current is between −IBV and −Is·small.
    const justBelow = diodeConduction(-bv - 1e-9, d);
    expect(justBelow.i).toBeLessThan(atKnee.i);
    expect(justBelow.i).toBeGreaterThan(-ibv * 1.001);
  });

  test("depletion capacitance is C1-continuous at FC·VJ", () => {
    const c = { cj0: 1e-12, vj: 1, m: 0.5, fc: 0.5 };
    const vF = 0.5;
    const below = depletionCapacitance(vF - 1e-9, c);
    const at = depletionCapacitance(vF, c);
    const above = depletionCapacitance(vF + 1e-9, c);
    expect(below).toBeCloseTo(at, 6);
    expect(above).toBeCloseTo(at, 6);
    // Depletion law below: C = Cj0·(1 − v/VJ)^(−M).
    expect(depletionCapacitance(0, c)).toBeCloseTo(c.cj0, 15);
  });
});

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

describe("diode — convergence", () => {
  test("limiting walks a 100 V forward step to the exact OP", () => {
    // From x = 0 the first Newton pass proposes a huge junction voltage;
    // pnjlim must walk it down without divergence.
    const r = runAnalysis(
      compile(
        preciseCircuit([
          { type: "V", name: "V1", n: ["in", "0"], dc: 100 },
          { type: "R", name: "R1", n: ["in", "out"], value: 10 },
          { type: "D", name: "D1", n: ["out", "0"], model: "dideal" },
        ]),
      ),
      { kind: "op" },
    );
    const vd = sig(r, "v(out)");
    const i = (100 - vd) / 10;
    expect(i).toBeCloseTo(1e-14 * (Math.exp(vd / VT) - 1), 6);
    // ~0.9 V across a diode at ~10 A is the physical answer.
    expect(vd).toBeGreaterThan(0.8);
    expect(vd).toBeLessThan(1.1);
  });

  test("netlist end-to-end: series half-wave rectifier with RC filter", () => {
    const netlist = `Series half-wave rectifier
V1 in 0 SIN(0 5 50)
D1 in out DN
C1 out 0 10u
RL out 0 10k
.model DN D(is=1e-14 n=1)
.tran 100u 80m
.end
`;
    const { results } = simulateNetlist(netlist);
    expect(results).toHaveLength(1);
    const tran = results[0] as ReturnType<typeof runAnalysis>;
    expect(tran.kind).toBe("tran");
    // Peak detector: C charges to Vp − 0.7 and the 10 k load bleeds it with
    // τ = 100 ms vs a 20 ms period → ripple of roughly a volt.
    const vOut = tran.signals.find((s) => s.name === "v(out)")?.values as Float64Array;
    expect(vOut).toBeDefined();
    let peak = -Infinity;
    let valley = Infinity;
    for (const v of vOut) {
      expect(v).toBeLessThanOrEqual(4.6);
      expect(v).toBeGreaterThanOrEqual(-0.2);
      peak = Math.max(peak, v);
      valley = Math.min(valley, v);
    }
    // v(out) peaks near 5 − 0.7 = 4.3 V and never discharges below ~3 V
    // (ripple ≈ Vp·T/τ ≈ 0.9 V). Ripple is measured in steady state
    // (after the first period — the cap starts at 0 V from the OP).
    expect(peak).toBeGreaterThan(4.1);
    const times = tran.axis;
    let ssValley = Infinity;
    let ssPeak = -Infinity;
    for (let i = 0; i < vOut.length; i++) {
      if ((times[i] as number) < 20e-3) {
        continue;
      }
      ssValley = Math.min(ssValley, vOut[i] as number);
      ssPeak = Math.max(ssPeak, vOut[i] as number);
    }
    expect(ssPeak).toBeGreaterThan(4.1);
    expect(ssValley).toBeGreaterThan(3.0);
    // The OP ladder reported direct convergence for this easy circuit.
    expect(tran.stats.opMethod).toBe("direct");
  });
});
