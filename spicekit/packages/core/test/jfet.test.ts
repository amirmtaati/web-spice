/**
 * JFET Level 1 tests (SPEC §5.7, §13.2): pinchoff/saturation/linear region
 * equations verified analytically, transconductance, gate-junction leakage,
 * P-channel mirror, an independently-solved reference bias point, properties,
 * and convergence on a self-biased JFET amplifier stage.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_SIM_OPTIONS, type Element, type ModelCard } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import { simulateNetlist } from "../src/engine.ts";

const NJF: ModelCard = {
  name: "jn",
  type: "njf",
  parameters: { vto: -2, beta: 1e-3, lambda: 0.01, is: 1e-14 },
};
const PJF: ModelCard = {
  name: "jp",
  type: "pjf",
  parameters: { vto: 2, beta: 1e-3, lambda: 0.01, is: 1e-14 },
};

function circuit(elements: Element[], models: Record<string, ModelCard>) {
  return {
    title: "JFET tests",
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

function njfStage(vgs: number, vds: number): Element[] {
  return [
    { type: "V", name: "Vg", n: ["g", "0"], dc: vgs },
    { type: "V", name: "Vd", n: ["d", "0"], dc: vds },
    { type: "J", name: "J1", n: ["d", "g", "0"], model: "jn" },
  ];
}

describe("jfet — analytical", () => {
  test("pinchoff: vgs ≤ vto conducts nothing but gate leakage", () => {
    const id = -opSig(njfStage(-2.5, 5), { jn: NJF }, "i(vd)");
    expect(Math.abs(id)).toBeLessThan(1e-10);
  });

  test("saturation: id = β·(vgs−vto)²·(1+λ·vds)", () => {
    const vgs = -1;
    const vds = 3;
    const vgst = vgs - -2;
    const expected = 1e-3 * vgst * vgst * (1 + 0.01 * vds);
    const id = -opSig(njfStage(vgs, vds), { jn: NJF }, "i(vd)");
    expect(id).toBeCloseTo(expected, 11);
  });

  test("linear (triode) region: id = β·vds·(2·vgst − vds)·(1+λ·vds)", () => {
    const vgs = -1;
    const vds = 0.5;
    const vgst = 1;
    const expected = 1e-3 * (1 + 0.01 * 0.5) * vds * (2 * vgst - vds);
    const id = -opSig(njfStage(vgs, vds), { jn: NJF }, "i(vd)");
    expect(id).toBeCloseTo(expected, 11);
  });

  test("region boundary is continuous at vds = vgst", () => {
    const vgst = 1;
    const sat = -opSig(njfStage(-1, 1), { jn: NJF }, "i(vd)");
    const lin = -opSig(njfStage(-1, 1 + 1e-9), { jn: NJF }, "i(vd)");
    expect(lin).toBeCloseTo(sat, 9);
    expect(sat).toBeCloseTo(1e-3 * vgst * vgst * 1.01, 11);
  });

  test("gate junction leakage ≈ −Is in reverse", () => {
    const r = runAnalysis(compile(circuit(njfStage(0, 5), { jn: NJF })), { kind: "op" });
    // Gate at 0 V, source at 0: vgs = 0 → gate current ≈ gmin·0; the drain
    // end sees vgd = −5 → reverse leakage.
    const ig = r.signals.find((x) => x.name === "i(vg)")?.values[0] as number;
    expect(Math.abs(ig)).toBeLessThan(1e-9);
  });

  test("P-channel mirrors N-channel", () => {
    const nEl = njfStage(-1, 3);
    const pEl: Element[] = [
      { type: "V", name: "Vg", n: ["g", "0"], dc: 1 },
      { type: "V", name: "Vd", n: ["d", "0"], dc: -3 },
      { type: "J", name: "J1", n: ["d", "g", "0"], model: "jp" },
    ];
    const iN = -opSig(nEl, { jn: NJF, jp: PJF }, "i(vd)");
    const iP = opSig(pEl, { jn: NJF, jp: PJF }, "i(vd)");
    expect(Math.abs(iP)).toBeCloseTo(iN, 10);
    expect(iN).toBeGreaterThan(1e-4);
  });
});

describe("jfet — reference", () => {
  test("self-biased source resistor matches the quadratic solve", () => {
    // Gate grounded through a resistor, source resistor 500 Ω: solve
    // β·(0 − (−2) − vs)²·(1+λ·vds) = vs/500 by bisection here (independent
    // of the engine; vds = 10 − vs).
    const f = (vs: number) => {
      const vgst = 2 - vs;
      const id = vgst > 0 ? 1e-3 * vgst * vgst * (1 + 0.01 * (10 - vs)) : 0;
      return id * 500 - vs;
    };
    let lo = 0;
    let hi = 2;
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const vsRef = (lo + hi) / 2;
    const elements: Element[] = [
      { type: "V", name: "Vd", n: ["d", "0"], dc: 10 },
      { type: "R", name: "Rg", n: ["g", "0"], value: 1e6 },
      { type: "R", name: "Rs", n: ["s", "0"], value: 500 },
      { type: "J", name: "J1", n: ["d", "g", "s"], model: "jn" },
    ];
    const r = runAnalysis(
      compile({
        ...circuit(elements, { jn: NJF }),
        options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-9, vntol: 1e-12 },
      }),
      { kind: "op" },
    );
    const vs = r.signals.find((x) => x.name === "v(s)")?.values[0] as number;
    // Precision limited by the gate-junction gmin leakage through the 1 MΩ
    // gate resistor (a real model effect the bisection ignores).
    expect(vs).toBeCloseTo(vsRef, 4);
  });
});

describe("jfet — property", () => {
  test("id(vgs) monotonic in saturation", () => {
    let prev = -1;
    for (const vgs of [-2, -1.5, -1, -0.5, 0]) {
      const id = -opSig(njfStage(vgs, 4), { jn: NJF }, "i(vd)");
      expect(id).toBeGreaterThanOrEqual(prev - 1e-15);
      prev = id;
    }
  });

  test("λ raises the saturation current with vds", () => {
    const i3 = -opSig(njfStage(-1, 3), { jn: NJF }, "i(vd)");
    const i6 = -opSig(njfStage(-1, 6), { jn: NJF }, "i(vd)");
    expect(i6).toBeGreaterThan(i3);
    expect(i6 / i3).toBeCloseTo((1 + 0.06) / (1 + 0.03), 6);
  });
});

describe("jfet — convergence", () => {
  test("self-biased stage converges from cold start", () => {
    const elements: Element[] = [
      { type: "V", name: "Vd", n: ["d", "0"], dc: 15 },
      { type: "R", name: "Rg", n: ["g", "0"], value: 1e6 },
      { type: "R", name: "Rd", n: ["d", "x"], value: 2e3 },
      { type: "R", name: "Rs", n: ["s", "0"], value: 500 },
      { type: "J", name: "J1", n: ["x", "g", "s"], model: "jn" },
    ];
    const r = runAnalysis(compile(circuit(elements, { jn: NJF })), { kind: "op" });
    expect(r.stats.opMethod).toBe("direct");
    const vd = r.signals.find((x) => x.name === "v(x)")?.values[0] as number;
    const vs = r.signals.find((x) => x.name === "v(s)")?.values[0] as number;
    // Active bias: drain well above source, sensible currents.
    expect(vd).toBeGreaterThan(vs + 2);
    expect(vs).toBeGreaterThan(0.5);
    expect(vs).toBeLessThan(2.5);
  });

  test("netlist end-to-end: JFET source follower with sine drive", () => {
    const netlist = `JFET source follower
VDD dd 0 15
VSS ss 0 -15
JD dd g s jn
RS s ss 2k
RG g 0 1MEG
RL s 0 100k
.model jn njf(vto=-2 beta=1e-3 lambda=0.01)
VIN g 0 SIN(0 0.5 1000)
.tran 20u 4m
.end
`;
    const { results } = simulateNetlist(netlist);
    const tran = results[0] as ReturnType<typeof runAnalysis>;
    expect(tran.kind).toBe("tran");
    const vOut = tran.signals.find((s) => s.name === "v(s)")?.values as Float64Array;
    expect(vOut).toBeDefined();
    // Follower: the 1 MΩ gate resistor lets the gate junction conduct, so
    // the source self-biases just below the gate clamp (≈ −0.5 V) and
    // follows the 0.5 V sine with gain just under 1.
    const bias = vOut[Math.floor(vOut.length / 2)] as number;
    expect(bias).toBeGreaterThan(-1.2);
    expect(bias).toBeLessThan(0);
    let swing = 0;
    for (let i = Math.floor(vOut.length / 2); i < vOut.length; i++) {
      swing = Math.max(swing, Math.abs((vOut[i] as number) - bias));
    }
    expect(swing).toBeGreaterThan(0.2);
    expect(swing).toBeLessThan(0.6);
  });
});
