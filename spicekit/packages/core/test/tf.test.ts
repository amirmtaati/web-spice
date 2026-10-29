/**
 * .tf transfer-function analysis (E3, SPEC §5.5): gain, input resistance,
 * output resistance on the DC-linearized network — all hand-derived.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "TF",
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

describe(".tf — resistive networks", () => {
  test("divider: gain 1/2, Rin 2k, Rout 500", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 10 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "R", name: "R2", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tf", output: "v(out)", source: "V1" });
    expect(sig(r, "transfer_function")).toBeCloseTo(0.5, 12);
    expect(sig(r, "input_impedance")).toBeCloseTo(2000, 9);
    // Driving-point resistance at out with the input zeroed: R1 ∥ R2 = 500.
    expect(sig(r, "output_impedance")).toBeCloseTo(500, 9);
  });

  test("loaded divider matches the exact fractions", () => {
    // R1 = 1k, R2 = 2k, RL = 3k: gain = R2∥RL / (R1 + R2∥RL) = 500/1500.
    const rp = (2000 * 3000) / 5000;
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 12 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "R", name: "R2", n: ["out", "0"], value: 2000 },
      { type: "R", name: "RL", n: ["out", "0"], value: 3000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tf", output: "v(out)", source: "V1" });
    expect(sig(r, "transfer_function")).toBeCloseTo(rp / (1000 + rp), 12);
    expect(sig(r, "input_impedance")).toBeCloseTo(1000 + rp, 9);
    // Driving-point resistance with the input zeroed: R1 ∥ (R2 ∥ RL).
    expect(sig(r, "output_impedance")).toBeCloseTo((1000 * rp) / (1000 + rp), 9);
  });

  test("v(node, ref) two-terminal output", () => {
    // Bridge: gain = v(a) − v(b) per volt = 2/3 − 1/3 = 1/3.
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 6 },
      { type: "R", name: "R1", n: ["in", "a"], value: 1000 },
      { type: "R", name: "R2", n: ["a", "0"], value: 2000 },
      { type: "R", name: "R3", n: ["in", "b"], value: 2000 },
      { type: "R", name: "R4", n: ["b", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tf", output: "v(a,b)", source: "V1" });
    expect(sig(r, "transfer_function")).toBeCloseTo(1 / 3, 12);
  });

  test("I input: transresistance and seen resistance", () => {
    // 1 A source into 1 kΩ: v = R·i → transresistance −1000 (source pulls
    // current out of out), seen resistance 1000.
    const c = circuit([
      { type: "I", name: "I1", n: ["out", "0"], dc: 0 },
      { type: "R", name: "R1", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tf", output: "v(out)", source: "I1" });
    expect(sig(r, "transfer_function")).toBeCloseTo(-1000, 9);
    expect(sig(r, "input_impedance")).toBeCloseTo(1000, 9);
  });

  test("VCCS: transconductance into a load with a sense branch", () => {
    // G1 drives 1 mA/V from out to 0; the sense branch carries the load
    // current out→mid→RL→0, which LEAVES the + terminal — so i(Vmeas) per
    // volt is −gm (the ngspice into-the-+ terminal convention).
    const c = circuit([
      { type: "V", name: "Vin", n: ["in", "0"], dc: 1 },
      { type: "G", name: "G1", n: ["out", "0", "in", "0"], gm: 1e-3 },
      { type: "V", name: "Vmeas", n: ["out", "mid"], dc: 0 },
      { type: "R", name: "RL", n: ["mid", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "tf", output: "i(Vmeas)", source: "Vin" });
    expect(sig(r, "transfer_function")).toBeCloseTo(-1e-3, 12);
    expect(sig(r, "input_impedance")).toBeCloseTo(Number.POSITIVE_INFINITY, 9);
  });
});

describe(".tf — nonlinear and active circuits", () => {
  test("MOSFET common-source: gain −gm·RD, Rin ∞, Rout RD", () => {
    const RD = 1000;
    const beta = 1e-2;
    const c = circuit(
      [
        { type: "V", name: "VDD", n: ["vdd", "0"], dc: 10 },
        { type: "R", name: "RD", n: ["vdd", "out"], value: RD },
        { type: "M", name: "M1", n: ["out", "gate", "0", "0"], model: "NM" },
        { type: "V", name: "VG", n: ["gate", "0"], dc: 2 },
      ],
      {
        models: { nm: { name: "NM", type: "nmos", parameters: { vto: 1, kp: beta, lambda: 0 } } },
      },
    );
    const r = runAnalysis(compile(c), { kind: "tf", output: "v(out)", source: "VG" });
    const gm = beta * 1; // vgst = 1
    expect(sig(r, "transfer_function")).toBeCloseTo(-gm * RD, 6);
    expect(sig(r, "input_impedance")).toBeCloseTo(Number.POSITIVE_INFINITY, 9);
    expect(sig(r, "output_impedance")).toBeCloseTo(RD, 3);
  });

  test("inverting amplifier with the ideal op-amp: gain −R2/R1, Rin R1", () => {
    const netlist = `inverting amp tf
.subckt OPAMP_IDEAL INP INN OUT
  RIN INP INN 1meg
  E1 OUT 0 INP INN 1e6
.ends
V1 in 0 0
X1 0 inn out OPAMP_IDEAL
R1 in inn 1k
R2 out inn 4k
.tf v(out) V1
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "tf" });
    expect(sig(r, "transfer_function")).toBeCloseTo(-4, 3);
    expect(sig(r, "input_impedance")).toBeCloseTo(1000, 2);
  });
});
