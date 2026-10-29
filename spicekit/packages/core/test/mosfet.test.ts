/**
 * MOSFET Level 1 tests (SPEC §5.7, §13.2): Shichman-Hodges region equations
 * verified analytically, body effect, λ channel-length modulation, P-channel
 * mirror symmetry, an independently-solved reference point, properties, and
 * the CMOS fixtures (inverter VTC + ring oscillator) from the acceptance bar.
 */
import { describe, expect, test } from "bun:test";

import {
  type Circuit,
  DEFAULT_SIM_OPTIONS,
  type Element,
  type ModelCard,
} from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import { simulateNetlist } from "../src/engine.ts";

const NMOS: ModelCard = {
  name: "mn",
  type: "nmos",
  parameters: { vto: 1, kp: 1e-3, lambda: 0.01, gamma: 0.5, phi: 0.6 },
};
const PMOS: ModelCard = {
  name: "mp",
  type: "pmos",
  parameters: { vto: -1, kp: 1e-3, lambda: 0.01 },
};
// CMOS pair with capacitors for a realistic ring oscillator.
const CMOS_N: ModelCard = {
  name: "cmn",
  type: "nmos",
  parameters: { vto: 0.8, kp: 2e-4, lambda: 0.01, tox: 1e-8, cgso: 1e-9, cgdo: 1e-9 },
};
const CMOS_P: ModelCard = {
  name: "cmp",
  type: "pmos",
  parameters: { vto: -0.8, kp: 2e-4, lambda: 0.01, tox: 1e-8, cgso: 1e-9, cgdo: 1e-9 },
};

function circuit(
  elements: Element[],
  models: Record<string, ModelCard>,
  over: Partial<Circuit> = {},
): Circuit {
  return {
    title: "MOS tests",
    elements,
    models,
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
    ...over,
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

/** NMOS with source grounded, bulk tied to source, gate/drive from sources. */
function nmosStage(vgs: number, vds: number, model = "mn"): Element[] {
  return [
    { type: "V", name: "Vg", n: ["g", "0"], dc: vgs },
    { type: "V", name: "Vd", n: ["d", "0"], dc: vds },
    { type: "M", name: "M1", n: ["d", "g", "0", "0"], model, w: 10e-6, l: 1e-6 },
  ];
}

describe("mosfet — analytical (Shichman-Hodges regions)", () => {
  test("cutoff: vgs < vto conducts only gmin leakage", () => {
    const id = -opSig(nmosStage(0.5, 3), { mn: NMOS }, "i(vd)");
    // Channel off; the bulk-drain junction gmin carries gmin·vds.
    expect(Math.abs(id)).toBeLessThan(1e-10);
    expect(id).toBeCloseTo(DEFAULT_SIM_OPTIONS.gmin * 3, 11);
  });

  test("saturation: id = β/2·(vgs−vto)²·(1+λ·vds)", () => {
    const vgs = 3;
    const vds = 5;
    const beta = 1e-3 * (10e-6 / 1e-6); // KP·W/L = 0.01
    const vgst = vgs - 1;
    const expected = (beta / 2) * vgst * vgst * (1 + 0.01 * vds);
    // Body effect: bulk tied to source → vbs = 0 → von = VTO exactly.
    const id = -opSig(nmosStage(vgs, vds), { mn: NMOS }, "i(vd)");
    expect(id).toBeCloseTo(expected, 10);
  });

  test("linear region: id = β·vds·(vgst − vds/2)", () => {
    const vgs = 3;
    const vds = 0.5;
    const beta = 1e-3 * 10;
    const vgst = vgs - 1;
    const expected = beta * vds * (vgst - vds / 2) * (1 + 0.01 * vds);
    const id = -opSig(nmosStage(vgs, vds), { mn: NMOS }, "i(vd)");
    expect(id).toBeCloseTo(expected, 10);
  });

  test("body effect raises the threshold when vbs < 0", () => {
    // Bulk held at −1 V: von = VTO + γ·(√(PHI+1) − √PHI).
    const elements: Element[] = [
      { type: "V", name: "Vg", n: ["g", "0"], dc: 3 },
      { type: "V", name: "Vd", n: ["d", "0"], dc: 5 },
      { type: "V", name: "Vs", n: ["s", "0"], dc: 1 },
      { type: "V", name: "Vb", n: ["b", "0"], dc: 0 },
      { type: "M", name: "M1", n: ["d", "g", "s", "b"], model: "mn", w: 10e-6, l: 1e-6 },
    ];
    // vgs = 2, vbs = −1, vds = 4.
    const gamma = 0.5;
    const phi = 0.6;
    const von = 1 + gamma * (Math.sqrt(phi + 1) - Math.sqrt(phi));
    const beta = 1e-3 * 10;
    const vgst = 2 - von;
    const expected = (beta / 2) * vgst * vgst * (1 + 0.01 * 4);
    const id = -opSig(elements, { mn: NMOS }, "i(vd)");
    expect(id).toBeCloseTo(expected, 10);
    // Body effect must reduce the current vs the vbs = 0 case.
    const idNoBody = -opSig(nmosStage(3, 5), { mn: NMOS }, "i(vd)");
    expect(id).toBeLessThan(idNoBody);
  });

  test("P-channel mirrors N-channel", () => {
    // NMOS: s grounded, g = 3, d = 5. PMOS: s = 5, g = 2 (vgs = −3), d = 0.
    const nEl = nmosStage(3, 5);
    const pEl: Element[] = [
      { type: "V", name: "Vs", n: ["s", "0"], dc: 5 },
      { type: "V", name: "Vg", n: ["g", "0"], dc: 2 },
      { type: "V", name: "Vd", n: ["d", "0"], dc: 0 },
      { type: "M", name: "M1", n: ["d", "g", "s", "s"], model: "mp", w: 10e-6, l: 1e-6 },
    ];
    const iN = -opSig(nEl, { mp: PMOS, mn: NMOS }, "i(vd)");
    const iP = opSig(pEl, { mp: PMOS, mn: NMOS }, "i(vd)");
    expect(Math.abs(iP)).toBeCloseTo(iN, 10);
    expect(iN).toBeGreaterThan(1e-4);
  });

  test("drain/source swap preserves the channel current", () => {
    // The MOSFET is symmetric (γ = 0 so the bulk tie cannot break it):
    // identical node potentials give the same channel current, mirrored in
    // sign because the terminal roles swap.
    const noGamma: ModelCard = {
      name: "m0",
      type: "nmos",
      parameters: { vto: 1, kp: 1e-3, lambda: 0.01 },
    };
    const fwd = -opSig(nmosStage(3, 2, "m0"), { m0: noGamma }, "i(vd)");
    const swapped = opSig(
      [
        { type: "V", name: "Vg", n: ["g", "0"], dc: 3 },
        { type: "V", name: "Vs", n: ["s", "0"], dc: 2 },
        { type: "M", name: "M1", n: ["0", "g", "s", "0"], model: "m0", w: 10e-6, l: 1e-6 },
      ],
      { m0: noGamma },
      "i(vs)",
    );
    expect(swapped).toBeCloseTo(-fwd, 10);
  });
});

describe("mosfet — reference", () => {
  test("source-follower bias matches the quadratic solve", () => {
    // Gate at 3 V through nothing, source resistor 1 k to ground: solve
    // β/2·(3 − vto − vs)² = vs/1k by bisection here (independent).
    const beta = 1e-3 * 10;
    const f = (vs: number) => {
      const vgst = 3 - 1 - vs;
      const id = vgst > 0 ? (beta / 2) * vgst * vgst * (1 + 0.01 * (5 - vs)) : 0;
      return id * 1000 - vs;
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
      { type: "V", name: "Vg", n: ["g", "0"], dc: 3 },
      { type: "R", name: "Rs", n: ["s", "0"], value: 1000 },
      { type: "V", name: "Vd", n: ["d", "0"], dc: 5 },
      { type: "M", name: "M1", n: ["d", "g", "s", "s"], model: "mn", w: 10e-6, l: 1e-6 },
    ];
    const r = runAnalysis(
      compile(
        circuit(
          elements,
          { mn: { ...NMOS } },
          { options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-9, vntol: 1e-12 } },
        ),
      ),
      { kind: "op" },
    );
    const vs = r.signals.find((x) => x.name === "v(s)")?.values[0] as number;
    expect(vs).toBeCloseTo(vsRef, 6);
  });
});

describe("mosfet — property", () => {
  test("id(vgs) is monotonic and continuous across regions", () => {
    let prev = -1;
    for (const vgs of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4]) {
      const id = -opSig(nmosStage(vgs, 5), { mn: NMOS }, "i(vd)");
      expect(id).toBeGreaterThanOrEqual(prev - 1e-15);
      prev = id;
    }
  });

  test("λ raises the saturation current with vds", () => {
    const i5 = -opSig(nmosStage(3, 5), { mn: NMOS }, "i(vd)");
    const i8 = -opSig(nmosStage(3, 8), { mn: NMOS }, "i(vd)");
    expect(i8).toBeGreaterThan(i5);
    expect(i8 / i5).toBeCloseTo((1 + 0.01 * 8) / (1 + 0.01 * 5), 6);
  });
});

// ---------------------------------------------------------------------------
// Fixtures: CMOS inverter VTC and ring oscillator
// ---------------------------------------------------------------------------

describe("mosfet — fixtures", () => {
  test("CMOS inverter VTC: rail-to-rail with high gain near threshold", () => {
    const elements = (vin: number): Element[] => [
      { type: "V", name: "Vdd", n: ["dd", "0"], dc: 5 },
      { type: "V", name: "Vin", n: ["in", "0"], dc: vin },
      { type: "M", name: "MN", n: ["out", "in", "0", "0"], model: "cmn", w: 20e-6, l: 1e-6 },
      { type: "M", name: "MP", n: ["out", "in", "dd", "dd"], model: "cmp", w: 20e-6, l: 1e-6 },
    ];
    const models = { cmn: CMOS_N, cmp: CMOS_P };
    const vHigh = opSig(elements(0), models, "v(out)");
    const vLow = opSig(elements(5), models, "v(out)");
    const vMid = opSig(elements(2.5), models, "v(out)");
    // Rails within a few hundred mV (λ leakage through the off device).
    expect(vLow).toBeLessThan(0.4);
    expect(vHigh).toBeGreaterThan(4.6);
    // Mid-input: both devices on, output in the high-gain region.
    expect(vMid).toBeGreaterThan(0.5);
    expect(vMid).toBeLessThan(4.5);
    // A DC sweep traces the full VTC.
    const r = runAnalysis(
      compile(
        circuit(elements(0), models, {
          analyses: [{ kind: "dc", source: "Vin", start: 0, stop: 5, step: 0.25 }],
        }),
      ),
      { kind: "dc", source: "Vin", start: 0, stop: 5, step: 0.25 },
    );
    const vout = r.signals.find((s) => s.name === "v(out)")?.values as Float64Array;
    expect(vout.length).toBe(21);
    expect(vout[0] as number).toBeGreaterThan(4.6); // vin=0 → out high
    expect(vout[20] as number).toBeLessThan(0.4); // vin=5 → out low
    // Monotonic falling VTC.
    for (let i = 1; i < vout.length; i++) {
      expect(vout[i] as number).toBeLessThanOrEqual((vout[i - 1] as number) + 1e-9);
    }
  });

  test("ring oscillator: 3-stage CMOS ring oscillates in transient", () => {
    const netlist = `3-stage ring oscillator
VDD dd 0 5
MN1 n1 in 0 0 cmn W=20u L=1u
MP1 n1 in dd dd cmp W=20u L=1u
MN2 n2 n1 0 0 cmn W=20u L=1u
MP2 n2 n1 dd dd cmp W=20u L=1u
MN3 in n2 0 0 cmn W=20u L=1u
MP3 in n2 dd dd cmp W=20u L=1u
C1 n1 0 1p
C2 n2 0 1p
C3 in 0 1p
.model cmn nmos(vto=0.8 kp=2e-4 lambda=0.01 tox=1e-8 cgso=2e-10 cgdo=2e-10)
.model cmp pmos(vto=-0.8 kp=2e-4 lambda=0.01 tox=1e-8 cgso=2e-10 cgdo=2e-10)
.tran 0.1n 60n uic
.end
`;
    const { results } = simulateNetlist(netlist);
    const tran = results[0] as ReturnType<typeof runAnalysis>;
    expect(tran.kind).toBe("tran");
    const v1 = tran.signals.find((s) => s.name === "v(n1)")?.values as Float64Array;
    expect(v1).toBeDefined();
    // The ring toggles: both logic levels are visited after start-up, and
    // the oscillation is sustained (hundreds of switching events).
    let lo = Infinity;
    let hi = -Infinity;
    let transitions = 0;
    for (let i = Math.floor(v1.length / 3); i < v1.length; i++) {
      lo = Math.min(lo, v1[i] as number);
      hi = Math.max(hi, v1[i] as number);
      if (
        i > Math.floor(v1.length / 3) &&
        (v1[i] as number) > 2.5 !== (v1[i - 1] as number) > 2.5
      ) {
        transitions += 1;
      }
    }
    expect(hi).toBeGreaterThan(3.5);
    expect(lo).toBeLessThan(1.5);
    expect(transitions).toBeGreaterThan(50);
    // Meyer capacitances are not charge-conserving: switching events produce
    // ~1 V of supply-rail overshoot (the same artifact ngspice-1 models
    // show; BSIM/charge-conserving models land with a later milestone).
    expect(hi).toBeLessThan(6.5);
    expect(lo).toBeGreaterThan(-1.5);
  });
});
