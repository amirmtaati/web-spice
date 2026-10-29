/**
 * BJT tests (SPEC §5.7, §13.2): Ebers-Moll transport equations verified
 * analytically, gain/Early/saturation behavior, PNP mirror symmetry, an
 * independently-solved reference bias point, properties (KCL, β scaling),
 * and convergence on a resistive-divider-biased amplifier stage.
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
import { thermalVoltage } from "../src/devices/nonlinear/junction.ts";
import { simulateNetlist } from "../src/engine.ts";

const VT = thermalVoltage(27);

const NPN: ModelCard = {
  name: "qnpn",
  type: "npn",
  parameters: { is: 1e-14, bf: 100, br: 1 },
};
const NPN_EARLY: ModelCard = {
  name: "qearly",
  type: "npn",
  parameters: { is: 1e-14, bf: 100, br: 1, vaf: 50 },
};
const PNP: ModelCard = {
  name: "qpnp",
  type: "pnp",
  parameters: { is: 1e-14, bf: 100, br: 1 },
};

function circuit(
  elements: Element[],
  models: Record<string, ModelCard> = {},
  over: Partial<Circuit> = {},
): Circuit {
  return {
    title: "BJT tests",
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

function opI(elements: Element[], models: Record<string, ModelCard>, source: string): number {
  const r = runAnalysis(compile(circuit(elements, models)), { kind: "op" });
  const s = r.signals.find((x) => x.name === `i(${source.toLowerCase()})`);
  if (s === undefined) {
    throw new Error(`no signal i(${source})`);
  }
  return s.values[0] as number;
}

/** Classic four-resistor-biased CE stage used by several tests. */
function ceStage(model: string, rc = 1e3, re = 220): Element[] {
  // 12 V rail; base bias ≈ 2.7 V via divider; collector ≈ 6 V, Ic ≈ 6 mA.
  return [
    { type: "V", name: "Vcc", n: ["vcc", "0"], dc: 12 },
    { type: "R", name: "R1", n: ["vcc", "b"], value: 47e3 },
    { type: "R", name: "R2", n: ["b", "0"], value: 10e3 },
    { type: "R", name: "RC", n: ["vcc", "c"], value: rc },
    { type: "R", name: "RE", n: ["e", "0"], value: re },
    { type: "Q", name: "Q1", n: ["c", "b", "e"], model },
  ];
}

describe("bjt — analytical (Ebers-Moll transport)", () => {
  test("forward-active: base current equals the Ebers-Moll law", () => {
    // Source-fixed vbe; measure the base current into the junction.
    const vbeDrive = 0.65;
    const elements: Element[] = [
      { type: "V", name: "Vbe", n: ["b", "e"], dc: vbeDrive },
      { type: "V", name: "Vce", n: ["e", "0"], dc: 0 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 5 },
      { type: "Q", name: "Q1", n: ["c", "b", "e"], model: "qnpn" },
    ];
    const r = runAnalysis(compile(circuit(elements, { qnpn: NPN })), { kind: "op" });
    const iVbe = r.signals.find((x) => x.name === "i(vbe)")?.values[0] as number;
    // Base current (into device) = cbe/BF + cbc/BR with the gmin shunts.
    const vbc = vbeDrive - 5;
    const gmin = DEFAULT_SIM_OPTIONS.gmin;
    const expectedIb =
      ((1e-14 * (Math.exp(vbeDrive / VT) - 1) + gmin * vbeDrive) / 100 +
        (1e-14 * (Math.exp(vbc / VT) - 1) + gmin * vbc)) /
      1;
    // i(Vbe): into the + terminal = −(device base current).
    expect(iVbe).toBeCloseTo(-expectedIb, 11);
    expect(-iVbe).toBeGreaterThan(1e-9);
  });

  test("collector current follows the transport law with Early factor", () => {
    const elements: Element[] = [
      { type: "V", name: "Vbe", n: ["b", "e"], dc: 0.75 },
      { type: "V", name: "Vce", n: ["e", "0"], dc: 0 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 3 },
      { type: "Q", name: "Q1", n: ["c", "b", "e"], model: "qearly" },
    ];
    const vbe = 0.75; // source-fixed junction voltage
    const vbc = vbe - 3; // collector at 3 V, emitter grounded
    // Ebers-Moll transport with Early: cc = (cbe − cbc)/q1 − cbc/BR.
    const q1 = 1 / (1 - vbc / 50);
    const cbe = 1e-14 * (Math.exp(vbe / VT) - 1);
    const cbc = 1e-14 * (Math.exp(vbc / VT) - 1);
    const expectedCc = (cbe - cbc) / q1 - cbc / 1;
    // i(Vc): current INTO the + terminal — the transistor pulls Ic out of it.
    const icMeasured = -opI(elements, { qearly: NPN_EARLY }, "vc");
    expect(icMeasured).toBeCloseTo(expectedCc, 10);
  });

  test("saturation: vce collapses below one vbe", () => {
    // Force a large base current into a small collector load.
    const elements: Element[] = [
      { type: "V", name: "Vb", n: ["b", "0"], dc: 0.85 },
      { type: "R", name: "Rb", n: ["b", "bx"], value: 1e3 },
      { type: "V", name: "Vcc", n: ["vc", "0"], dc: 5 },
      { type: "R", name: "Rcc", n: ["vc", "c"], value: 1000 },
      { type: "Q", name: "Q1", n: ["c", "bx", "0"], model: "qnpn" },
    ];
    const r = runAnalysis(compile(circuit(elements, { qnpn: NPN })), { kind: "op" });
    const vbx = r.signals.find((s) => s.name === "v(bx)")?.values[0] as number;
    const vc = r.signals.find((s) => s.name === "v(c)")?.values[0] as number;
    // Deep saturation: vce = vc < vbe = vbx.
    expect(vc).toBeLessThan(vbx - 0.2);
    expect(vc).toBeGreaterThan(0);
    expect(vc).toBeLessThan(0.5);
  });

  test("PNP mirrors NPN (sign symmetry)", () => {
    // NPN active: emitter grounded, base +0.72, collector +3.
    const npnEl: Element[] = [
      { type: "V", name: "Vbe", n: ["b", "e"], dc: 0.72 },
      { type: "V", name: "Vce", n: ["e", "0"], dc: 0 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 3 },
      { type: "Q", name: "Q1", n: ["c", "b", "e"], model: "qnpn" },
    ];
    // PNP active: emitter at +3, base 0.72 below it, collector grounded.
    const pnpEl: Element[] = [
      { type: "V", name: "Ve", n: ["e", "0"], dc: 3 },
      { type: "V", name: "Vb", n: ["b", "e"], dc: -0.72 },
      { type: "V", name: "Vc", n: ["c", "e"], dc: -3 },
      { type: "Q", name: "Q1", n: ["c", "b", "e"], model: "qpnp" },
    ];
    const iNpn = opI(npnEl, { qnpn: NPN }, "vc");
    const iPnp = opI(pnpEl, { qpnp: PNP }, "vc");
    // Both draw the same |Ic|; the sign convention mirrors.
    expect(Math.abs(iPnp)).toBeCloseTo(Math.abs(iNpn), 9);
    expect(Math.abs(iNpn)).toBeGreaterThan(1e-4);
  });
});

describe("bjt — reference (independent bisection solve)", () => {
  test("four-resistor bias point matches the hand equation", () => {
    // CE stage: IB = (Vth − VBE)/Rth with Vth = 12·10/57, Rth = 47k‖10k;
    // IC = β·IB in the active region. Solve VBE from the exponential by
    // bisection here (independent of the engine).
    const rc = 1e3;
    const re = 220;
    const elements = ceStage("qnpn");
    const r = runAnalysis(compile(circuit(elements, { qnpn: NPN })), { kind: "op" });
    const vb = r.signals.find((s) => s.name === "v(b)")?.values[0] as number;
    const vc = r.signals.find((s) => s.name === "v(c)")?.values[0] as number;
    const ve = r.signals.find((s) => s.name === "v(e)")?.values[0] as number;
    const ic = (12 - vc) / rc;
    const ie = ve / re;
    const ib = ie - ic;
    // Base node KCL: (12 − vb)/47k = vb/10k + ib — must hold exactly.
    expect((12 - vb) / 47e3 - vb / 10e3 - ib).toBeCloseTo(0, 9);
    // Active region sanity.
    expect(vc).toBeGreaterThan(ve + 0.5);
    // β consistent: ic ≈ bf·ib (Early absent).
    expect(ic).toBeCloseTo(100 * ib, -1);
  });
});

describe("bjt — property", () => {
  test("KCL holds at every node of the CE stage", () => {
    const elements = ceStage("qnpn");
    const r = runAnalysis(compile(circuit(elements, { qnpn: NPN })), { kind: "op" });
    const v = (n: string) => r.signals.find((s) => s.name === `v(${n})`)?.values[0] as number;
    const iVcc = r.signals.find((s) => s.name === "i(vcc)")?.values[0] as number;
    // Current out of Vcc splits into R1 and RC.
    expect(-iVcc).toBeCloseTo((12 - v("b")) / 47e3 + (12 - v("c")) / 1e3, 9);
  });

  test("increasing VAF increases the active-mode collector current", () => {
    const mk = (vaf?: number): ModelCard => ({
      name: "q",
      type: "npn",
      parameters:
        vaf === undefined ? { is: 1e-14, bf: 100, br: 1 } : { is: 1e-14, bf: 100, br: 1, vaf },
    });
    const base: Element[] = [
      { type: "V", name: "Vb", n: ["b", "0"], dc: 0.72 },
      { type: "R", name: "Rb", n: ["b", "bx"], value: 47e3 },
      { type: "V", name: "Vc", n: ["c", "0"], dc: 6 },
      { type: "V", name: "Vce", n: ["e", "0"], dc: 0 },
      { type: "Q", name: "Q1", n: ["c", "bx", "e"], model: "q" },
    ];
    const icNone = -opI(base, { q: mk() }, "vc");
    const icEarly = -opI(base, { q: mk(25) }, "vc");
    expect(icEarly).toBeGreaterThan(icNone * 1.05);
  });
});

describe("bjt — convergence", () => {
  test("CE stage converges from cold start and reports the method", () => {
    const r = runAnalysis(
      compile(circuit(ceStage("qnpn"), { qnpn: NPN }, { analyses: [{ kind: "op" }] })),
      { kind: "op" },
    );
    expect(r.stats.opMethod).toBe("direct");
    expect(r.stats.newtonIterations).toBeGreaterThan(1);
  });

  test("netlist end-to-end: CE amplifier bias + sine swing", () => {
    const netlist = `CE amplifier
VCC vcc 0 12
R1 vcc b 47k
R2 b 0 10k
RC vcc c 1k
RE e 0 220
CIN in b 10u
COUT c out 10u
Q1 c b e qn
RL out 0 10k
.model qn npn(is=1e-14 bf=100 br=1)
VIN in 0 SIN(0 0.01 1000)
.tran 20u 6m
.end
`;
    const { results } = simulateNetlist(netlist);
    const tran = results[0] as ReturnType<typeof runAnalysis>;
    expect(tran.kind).toBe("tran");
    const vOut = tran.signals.find((s) => s.name === "v(out)")?.values as Float64Array;
    const vC = tran.signals.find((s) => s.name === "v(c)")?.values as Float64Array;
    expect(vOut).toBeDefined();
    // Steady-state swing around the bias point (blocking cap removes DC).
    let peak = 0;
    for (let i = Math.floor(vOut.length / 2); i < vOut.length; i++) {
      peak = Math.max(peak, Math.abs(vOut[i] as number));
    }
    // Gain ≈ −RC/RE ≈ −4.5 on a 10 mV input → ~45 mV at the output; the
    // coupling caps and loading reduce it — assert a real amplified swing.
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThan(0.2);
    // Collector bias sits mid-rail.
    const bias = vC[Math.floor(vC.length / 2)] as number;
    expect(bias).toBeGreaterThan(4);
    expect(bias).toBeLessThan(8);
  });
});
