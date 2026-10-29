/**
 * Nonlinear device AC linearization — analytical suite (E3, SPEC §5.5
 * "linearize at OP"). Expected values derived from the hand-computed small
 * signal models: diode dynamic conductance, MOSFET/JFET common-source gain,
 * BJT common-emitter gain, switch states.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { BOLTZMANN, CHARGE } from "../src/math/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "AC nonlinear",
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

const VT = (BOLTZMANN * (273.15 + 27)) / CHARGE; // thermal voltage at 27 °C

describe("AC — diode small signal", () => {
  test("dynamic conductance matches Is/vt·e^(v/vt) at the bias point", () => {
    const vBias = 0.75;
    const isD = 1e-14;
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["a", "0"], dc: vBias, ac: { mag: 1 } },
        { type: "D", name: "D1", n: ["a", "0"], model: "DM" },
      ],
      {
        models: { dm: { name: "DM", type: "diode", parameters: { is: isD, rs: 0 } } },
      },
    );
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1,
      fstop: 1,
    });
    const expected = (isD / VT) * Math.exp(vBias / VT);
    expect(sig(r, "im(v1)")).toBeCloseTo(expected, 7);
  });

  test("diode-loaded divider attenuation follows 1/(1 + R·gm)", () => {
    const vBias = 0.75;
    const isD = 1e-14;
    const rs = 100;
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["in", "0"], dc: vBias, ac: { mag: 1 } },
        { type: "R", name: "R1", n: ["in", "out"], value: rs },
        { type: "D", name: "D1", n: ["out", "0"], model: "DM" },
      ],
      {
        models: { dm: { name: "DM", type: "diode", parameters: { is: isD, rs: 0 } } },
        options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-10, vntol: 1e-12 },
      },
    );
    const compiled = compile(c);
    // Bias point: the diode sits below vBias by its own current × R.
    const op = runAnalysis(compiled, { kind: "op" });
    const vOut = op.signals.find((s) => s.name === "v(out)")?.values[0] ?? 0;
    const r = runAnalysis(compiled, {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1,
      fstop: 1,
    });
    const gm = (isD / VT) * Math.exp(vOut / VT);
    expect(sig(r, "vm(out)")).toBeCloseTo(1 / (1 + rs * gm), 8);
    expect(sig(r, "vp(out)")).toBeCloseTo(0, 5);
  });
});

describe("AC — MOSFET common-source gain", () => {
  test("gain = −gm·RD in saturation (λ = 0)", () => {
    // KP=1e-2, W/L=1 → β=0.01; VGS=2, VTO=1 → vgst=1, Id=5 mA, gm=0.01 S.
    const RD = 1000;
    const beta = 1e-2;
    const vgst = 1;
    const c = circuit(
      [
        { type: "V", name: "VDD", n: ["vdd", "0"], dc: 10 },
        { type: "R", name: "RD", n: ["vdd", "out"], value: RD },
        { type: "M", name: "M1", n: ["out", "gate", "0", "0"], model: "NM" },
        { type: "V", name: "VG", n: ["gate", "0"], dc: 2, ac: { mag: 1 } },
      ],
      {
        models: {
          nm: { name: "NM", type: "nmos", parameters: { vto: 1, kp: beta, lambda: 0 } },
        },
      },
    );
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    const gm = beta * vgst;
    expect(sig(r, "vm(out)")).toBeCloseTo(gm * RD, 6);
    const phase = sig(r, "vp(out)");
    expect(Math.abs(Math.abs(phase) - 180)).toBeLessThan(1e-6);
  });
});

describe("AC — BJT common-emitter gain", () => {
  test("midband gain = −gm·RC with gm from the analytic bias current", () => {
    // VCC=12, RC=2k, VBE pinned at 0.69 V: Ic = Is·e^(vbe/vt) ≈ 4.3 mA,
    // VCE = 12 − Ic·RC ≈ 3.4 V (active region), q1 = 1 (VAF = ∞).
    const RC = 2000;
    const vbe = 0.69;
    const isQ = 1e-14;
    const c = circuit(
      [
        { type: "V", name: "VCC", n: ["vcc", "0"], dc: 12 },
        { type: "R", name: "RC", n: ["vcc", "out"], value: RC },
        { type: "Q", name: "Q1", n: ["out", "base", "0"], model: "NPN1" },
        { type: "V", name: "VB", n: ["base", "0"], dc: vbe, ac: { mag: 1 } },
      ],
      {
        models: {
          npn1: { name: "NPN1", type: "npn", parameters: { is: isQ, bf: 100, br: 1 } },
        },
      },
    );
    const compiled = compile(c);
    const op = runAnalysis(compiled, { kind: "op" });
    const vce = op.signals.find((s) => s.name === "v(out)")?.values[0] ?? 0;
    expect(vce).toBeGreaterThan(1); // active region sanity check
    const ic = isQ * Math.exp(vbe / VT);
    const r = runAnalysis(compiled, {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    const gm = ic / VT;
    expect(sig(r, "vm(out)")).toBeCloseTo(gm * RC, 4);
    const phase = sig(r, "vp(out)");
    expect(Math.abs(Math.abs(phase) - 180)).toBeLessThan(1e-3);
  });
});

describe("AC — JFET common-source gain", () => {
  test("gain = −gm·RD with gm = 2·β·vgst", () => {
    // VTO = −2, β = 1e-3, vgs = 0 → vgst = 2, Id = 4 mA, gm = 4 mS.
    const RD = 2000;
    const beta = 1e-3;
    const vgst = 2;
    const c = circuit(
      [
        { type: "V", name: "VDD", n: ["vdd", "0"], dc: 12 },
        { type: "R", name: "RD", n: ["vdd", "out"], value: RD },
        { type: "J", name: "J1", n: ["out", "gate", "0"], model: "NJ" },
        { type: "V", name: "VG", n: ["gate", "0"], dc: 0, ac: { mag: 1 } },
      ],
      {
        models: {
          nj: { name: "NJ", type: "njf", parameters: { vto: -2, beta, lambda: 0 } },
        },
      },
    );
    const r = runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    const gm = 2 * beta * vgst;
    expect(sig(r, "vm(out)")).toBeCloseTo(gm * RD, 6);
    const phase = sig(r, "vp(out)");
    expect(Math.abs(Math.abs(phase) - 180)).toBeLessThan(1e-6);
  });
});

describe("AC — switch states", () => {
  const model = { name: "SW", type: "sw", parameters: { ron: 1, roff: 1e12, vt: 1 } };

  function switchCircuit(control: number): RunResult {
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["in", "0"], dc: 0, ac: { mag: 1 } },
        { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
        { type: "S", name: "S1", n: ["out", "0"], ctrl: ["nc", "0"], model: "SW" },
        { type: "V", name: "VC", n: ["nc", "0"], dc: control },
      ],
      { models: { sw: model } },
    );
    return runAnalysis(compile(c), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
  }

  test("ON switch conducts: v(out) ≈ Ron/(R1+Ron)", () => {
    const r = switchCircuit(5);
    expect(sig(r, "vm(out)")).toBeCloseTo(1 / 1001, 9);
  });

  test("OFF switch blocks: v(out) ≈ 1", () => {
    const r = switchCircuit(-5);
    // Divider leaves a 1/Roff residue: Roff/(Roff + R1) = 1 − 1e-9.
    expect(sig(r, "vm(out)")).toBeCloseTo(1e12 / (1e12 + 1000), 8);
  });
});
