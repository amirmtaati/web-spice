/**
 * Switch tests (SPEC §5.7): voltage- and current-controlled switches with
 * hysteresis and smooth transition — state machine semantics, conductance
 * values, Newton state-flip handling, transient switching, and a
 * current-controlled switch driven by a V-source branch.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_SIM_OPTIONS, type Element, type ModelCard } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import { simulateNetlist } from "../src/engine.ts";

const SW: ModelCard = {
  name: "sw",
  type: "sw",
  parameters: { ron: 1, roff: 1e12, vt: 1, vh: 0.2 },
};
const SW_SMOOTH: ModelCard = {
  name: "sws",
  type: "sw",
  parameters: { ron: 1, roff: 1e9, vt: 2, smooth: 0.5 },
};
const CSW: ModelCard = {
  name: "csw",
  type: "csw",
  parameters: { ron: 1, roff: 1e12, it: 1e-3, ih: 1e-4 },
};

function circuit(elements: Element[], models: Record<string, ModelCard>) {
  return {
    title: "Switch tests",
    elements,
    models,
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
  };
}

function opSig(elements: Element[], models: Record<string, ModelCard>, name: string): number {
  const r = runAnalysis(compile(circuit(elements, models)), { kind: "op" });
  const s = r.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(`no signal ${name}`);
  }
  return s.values[0] as number;
}

describe("switch — voltage controlled (S)", () => {
  test("closed above threshold+hysteresis: divider conducts", () => {
    // Control at 2 V (vt=1, vh=0.2): ON. Switch from in to out, 1Ω to ground.
    const elements: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 2 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const vOut = opSig(elements, { sw: SW }, "v(out)");
    // ON: Rl (1Ω) vs Ron (1Ω) → half the source.
    expect(vOut).toBeCloseTo(1, 9);
  });

  test("open below threshold−hysteresis: output isolated", () => {
    const elements: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 0.5 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const vOut = opSig(elements, { sw: SW }, "v(out)");
    // OFF: RoFF = 1e12 vs Rl 1Ω → v(out) ≈ 2·1/(1+1e12) ≈ 0.
    expect(vOut).toBeLessThan(1e-9);
  });

  test("hysteresis band holds the previous state", () => {
    // Control exactly at vt = 1 (inside [0.8, 1.2]): the card state decides.
    const elementsOn: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 1 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw", on: true },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const elementsOff: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 1 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw", on: false },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const vOn = opSig(elementsOn, { sw: SW }, "v(out)");
    const vOff = opSig(elementsOff, { sw: SW }, "v(out)");
    expect(vOn).toBeCloseTo(1, 9);
    expect(vOff).toBeLessThan(1e-9);
  });

  test("smooth transition interpolates the conductance", () => {
    // Control mid-band (vt=2, smooth=0.5 → band [1.75, 2.25]): log-mean of
    // 1e-9 and 1 S → √(1e-9) ≈ 3.16e-5 S → divider ≈ 3.16e-5/(1+3.16e-5).
    const elements: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 2 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sws" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const vOut = opSig(elements, { sws: SW_SMOOTH }, "v(out)");
    const gMid = Math.sqrt(1e-9);
    expect(vOut).toBeCloseTo((2 * gMid) / (1 + gMid), 9);
  });

  test("smooth transition reaches both rails at the band edges", () => {
    const mk = (vc: number): Element[] => [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: vc },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sws" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const low = opSig(mk(0), { sws: SW_SMOOTH }, "v(out)");
    const high = opSig(mk(4), { sws: SW_SMOOTH }, "v(out)");
    expect(low).toBeLessThan(1e-6);
    expect(high).toBeCloseTo(2 / 2, 6); // Ron = 1Ω vs Rl = 1Ω
  });
});

describe("switch — current controlled (W)", () => {
  test("closes when the control current exceeds IT", () => {
    // The control loop pushes 2 mA INTO Vctl's + terminal (the W switch
    // senses the branch current with that sign); it = 1 mA → closes.
    const elements: Element[] = [
      { type: "V", name: "Vdrive", n: ["p", "0"], dc: 2 },
      { type: "R", name: "Rs", n: ["p", "q"], value: 1000 },
      { type: "V", name: "Vctl", n: ["q", "0"], dc: 0 },
      { type: "V", name: "Vsrc", n: ["in", "0"], dc: 2 },
      { type: "W", name: "W1", n: ["in", "out"], control: "Vctl", model: "csw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const r = runAnalysis(compile(circuit(elements, { csw: CSW })), { kind: "op" });
    const iCtl = r.signals.find((x) => x.name === "i(vctl)")?.values[0] as number;
    expect(Math.abs(iCtl)).toBeGreaterThan(1e-3);
    // The W switch conducts: v(out) ≈ 1 V (divider with Ron).
    const vOut = r.signals.find((x) => x.name === "v(out)")?.values[0] as number;
    expect(vOut).toBeCloseTo(1, 6);
  });

  test("opens when the control current is below IT − IH", () => {
    const elements: Element[] = [
      { type: "V", name: "Vdrive", n: ["p", "0"], dc: 0.1 },
      { type: "R", name: "Rs", n: ["p", "q"], value: 1000 },
      { type: "V", name: "Vctl", n: ["q", "0"], dc: 0 },
      { type: "V", name: "Vsrc", n: ["in", "0"], dc: 2 },
      { type: "W", name: "W1", n: ["in", "out"], control: "Vctl", model: "csw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const vOut = opSig(elements, { csw: CSW }, "v(out)");
    expect(vOut).toBeLessThan(1e-9);
  });
});

describe("switch — transient", () => {
  test("pulse-driven switch toggles the output", () => {
    const netlist = `Switch toggle
Vs in 0 5
Vctl c 0 PULSE(0 5 1u 1n 1n 2u 4u)
S1 in out c 0 sw
Rl out 0 1
.model sw sw(ron=1 roff=1e12 vt=2.5)
.tran 10n 12u uic
.end
`;
    const { results } = simulateNetlist(netlist);
    const tran = results[0] as ReturnType<typeof runAnalysis>;
    const vOut = tran.signals.find((s) => s.name === "v(out)")?.values as Float64Array;
    expect(vOut).toBeDefined();
    let high = 0;
    let low = 0;
    for (const v of vOut) {
      if ((v as number) > 2) {
        high += 1;
      } else {
        low += 1;
      }
    }
    // The switch closes on each pulse: both states are visited repeatedly.
    expect(high).toBeGreaterThan(10);
    expect(low).toBeGreaterThan(10);
  });
});

describe("switch — reference (independent arithmetic)", () => {
  test("loaded divider with finite ROFF matches the exact two-resistor solution", () => {
    // OFF state with ROFF = 1e9 (not infinite): the exact divider is
    // v(out) = Vs·Rl/(Rl + Ron + ROFF) with the switch open.
    const swRef: ModelCard = {
      name: "swr",
      type: "sw",
      parameters: { ron: 10, roff: 1e9, vt: 2 },
    };
    const elements: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 5 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 1 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "swr" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1e6 },
    ];
    const vOut = opSig(elements, { swr: swRef }, "v(out)");
    const expected = (5 * 1e6) / (1e6 + 1e9);
    expect(vOut).toBeCloseTo(expected, 12);
  });

  test("W switch threshold from the controlling source's branch current", () => {
    // Control loop: 2 V across 1 kΩ → i(Vctl) = 2 mA > IT = 1.5 mA → ON.
    // Switched path (separate loop): divider 2 V over Ron=1 Ω + Rl=3 Ω.
    const elements: Element[] = [
      { type: "V", name: "Vdrive", n: ["p", "0"], dc: 2 },
      { type: "R", name: "Rs", n: ["p", "q"], value: 1e3 },
      { type: "V", name: "Vctl", n: ["q", "0"], dc: 0 },
      { type: "V", name: "Vsrc", n: ["in", "0"], dc: 2 },
      { type: "W", name: "W1", n: ["in", "out"], control: "Vctl", model: "csw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 3 },
    ];
    const vOut = opSig(elements, { csw: CSW }, "v(out)");
    // Exact divider arithmetic for the ON state.
    expect(vOut).toBeCloseTo((2 * 3) / (1 + 3), 9);
  });
});

describe("switch — property", () => {
  test("conductance is monotone across the smooth band", () => {
    // Interpolate at three band points: below, mid, above — the resulting
    // divider output must be ordered.
    const mk = (control: number) => {
      const elements: Element[] = [
        { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
        { type: "V", name: "Vc", n: ["c", "0"], dc: control },
        { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sws" },
        { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
      ];
      return opSig(elements, { sws: SW_SMOOTH }, "v(out)");
    };
    const below = mk(1.8);
    const mid = mk(2.0);
    const above = mk(2.2);
    expect(below).toBeLessThan(mid);
    expect(mid).toBeLessThan(above);
  });

  test("complementary polarity: swapping control rails flips the state", () => {
    const mk = (vControl: number) => {
      const elements: Element[] = [
        { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
        { type: "V", name: "Vc", n: ["c", "0"], dc: vControl },
        { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw" },
        { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
      ];
      return opSig(elements, { sw: SW }, "v(out)");
    };
    const high = mk(3); // > vt + vh → ON
    const low = mk(0.5); // < vt − vh → OFF
    expect(high).toBeCloseTo(1, 9);
    expect(low).toBeLessThan(1e-9);
  });
});

describe("switch — convergence", () => {
  test("hard-switching divider converges from cold start and reports iterations", () => {
    // Cold start (x=0): the control sits below vt → switch starts OFF, the
    // first solve raises the control above vt+vh → state flip mid-Newton.
    // The analysis must re-solve and converge.
    const elements: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 3 },
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw" },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const r = runAnalysis(compile(circuit(elements, { sw: SW })), { kind: "op" });
    const vOut = r.signals.find((x) => x.name === "v(out)")?.values[0] as number;
    expect(vOut).toBeCloseTo(1, 9);
    expect(r.stats.newtonIterations).toBeGreaterThan(0);
    expect(Number.isFinite(r.stats.newtonIterations)).toBe(true);
  });

  test("switch network with hysteresis memory converges to the card state", () => {
    const elementsOn: Element[] = [
      { type: "V", name: "Vs", n: ["in", "0"], dc: 2 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 1 }, // exactly at vt
      { type: "S", name: "S1", n: ["in", "out"], ctrl: ["c", "0"], model: "sw", on: false },
      { type: "R", name: "Rl", n: ["out", "0"], value: 1 },
    ];
    const r = runAnalysis(compile(circuit(elementsOn, { sw: SW })), { kind: "op" });
    const vOut = r.signals.find((x) => x.name === "v(out)")?.values[0] as number;
    // on:false card inside the hysteresis band stays OFF.
    expect(vOut).toBeLessThan(1e-9);
  });
});
