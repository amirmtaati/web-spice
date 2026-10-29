/**
 * .noise analysis (E3, SPEC §5.5): hand-derived spectral densities —
 * resistor Johnson noise, divider combination (4kT·R_eff), input-referred
 * values, diode/MOSFET shot & thermal noise, flicker 1/f shape, integration.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { BOLTZMANN, CHARGE } from "../src/math/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "Noise",
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

const KT = BOLTZMANN * (273.15 + 27);
const FOURKT = 4 * KT;

describe(".noise — resistors", () => {
  test("1 kΩ to an AC-grounded node: 4.07 nV/√Hz", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 1 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "noise",
      output: "v(out)",
      source: "V1",
      sweep: "lin",
      points: 3,
      fstart: 1000,
      fstop: 1000,
    });
    const expected = Math.sqrt(FOURKT * 1000);
    expect(sig(r, "onoise_spectrum")).toBeCloseTo(expected, 15);
    // Input transfer is exactly 1 (source pins the node): in == out density.
    expect(sig(r, "inoise_spectrum")).toBeCloseTo(expected, 15);
  });

  test("divider: total density = √(4kT·(R1∥R2))", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 10 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "R", name: "R2", n: ["out", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "noise",
      output: "v(out)",
      source: "V1",
      sweep: "lin",
      points: 2,
      fstart: 100,
      fstop: 100,
    });
    const reff = 500;
    expect(sig(r, "onoise_spectrum")).toBeCloseTo(Math.sqrt(FOURKT * reff), 15);
    // Input-referred: divide by |H|² = 0.25.
    expect(sig(r, "inoise_spectrum")).toBeCloseTo(Math.sqrt(FOURKT * reff) / 0.5, 15);
  });

  test("integrated RMS over a white band = density·√bandwidth", () => {
    const c = circuit([
      { type: "V", name: "V1", n: ["in", "0"], dc: 1 },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "noise",
      output: "v(out)",
      source: "V1",
      sweep: "lin",
      points: 101,
      fstart: 10,
      fstop: 10010,
    });
    const density = Math.sqrt(FOURKT * 1000);
    const expectedRms = density * Math.sqrt(10010 - 10);
    const note = r.stats.notes.find((n) => n.startsWith("integrated onoise")) ?? "";
    const value = Number.parseFloat(
      note
        .split("=")[1]
        ?.replace(/V\(rms\)/, "")
        .trim() ?? "0",
    );
    expect(value).toBeCloseTo(expectedRms, 12);
  });
});

describe(".noise — diode shot noise", () => {
  test("shot density 2qI through the dynamic impedance", () => {
    const isD = 1e-14;
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["in", "0"], dc: 0.75 },
        { type: "R", name: "R1", n: ["in", "out"], value: 100 },
        { type: "D", name: "D1", n: ["out", "0"], model: "DM" },
      ],
      {
        models: { dm: { name: "DM", type: "diode", parameters: { is: isD, rs: 0 } } },
        options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-10, vntol: 1e-12 },
      },
    );
    const compiled = compile(c);
    const op = runAnalysis(compiled, { kind: "op" });
    const vOut = op.signals.find((s) => s.name === "v(out)")?.values[0] ?? 0;
    const vt = KT / CHARGE;
    const id = isD * Math.exp(vOut / vt);
    const gd = id / vt;
    const zEff = 1 / (gd + 1 / 100); // dynamic impedance at the output node
    // Diode shot + R1 thermal (in is AC-grounded, same transfer).
    const expectedPsd = (2 * CHARGE * id + FOURKT / 100) * zEff * zEff;
    const r = runAnalysis(compiled, {
      kind: "noise",
      output: "v(out)",
      source: "V1",
      sweep: "lin",
      points: 2,
      fstart: 1000,
      fstop: 1000,
    });
    expect(sig(r, "onoise_spectrum")).toBeCloseTo(Math.sqrt(expectedPsd), 14);
  });

  test("flicker (KF) adds 1/f: ratio between decades matches", () => {
    const isD = 1e-14;
    const kf = 1e-14;
    const af = 1;
    const c = circuit(
      [
        { type: "V", name: "V1", n: ["in", "0"], dc: 0.75 },
        { type: "R", name: "R1", n: ["in", "out"], value: 100 },
        { type: "D", name: "D1", n: ["out", "0"], model: "DM" },
      ],
      {
        models: {
          dm: { name: "DM", type: "diode", parameters: { is: isD, rs: 0, kf, af } },
        },
        options: { ...DEFAULT_SIM_OPTIONS, reltol: 1e-10, vntol: 1e-12 },
      },
    );
    const compiled = compile(c);
    const op = runAnalysis(compiled, { kind: "op" });
    const vOut = op.signals.find((s) => s.name === "v(out)")?.values[0] ?? 0;
    const vt = KT / CHARGE;
    const id = isD * Math.exp(vOut / vt);
    const gd = id / vt;
    const zEff = 1 / (gd + 1 / 100);
    const psdAt = (f: number): number =>
      (2 * CHARGE * id + (kf * id) / f + FOURKT / 100) * zEff * zEff;
    const r = runAnalysis(compiled, {
      kind: "noise",
      output: "v(out)",
      source: "V1",
      sweep: "dec",
      points: 1,
      fstart: 10,
      fstop: 10000,
    });
    // dec 1 pt/decade from 10 to 10k → points at 10, 100, 1k, 10k.
    expect(r.axis.length).toBe(4);
    expect(sig(r, "onoise_spectrum", 0)).toBeCloseTo(Math.sqrt(psdAt(10)), 14);
    expect(sig(r, "onoise_spectrum", 3)).toBeCloseTo(Math.sqrt(psdAt(10000)), 14);
  });
});

describe(".noise — MOSFET channel thermal", () => {
  test("(8/3)kT·gm at the drain", () => {
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
    const r = runAnalysis(compile(c), {
      kind: "noise",
      output: "v(out)",
      source: "VG",
      sweep: "lin",
      points: 2,
      fstart: 1000,
      fstop: 1000,
    });
    const gm = beta * 1;
    // MOS channel noise + RD thermal: (8/3)kT·gm·RD² + 4kT/RD·RD²
    const expected = ((8 / 3) * KT * gm + FOURKT / RD) * RD * RD;
    expect(sig(r, "onoise_spectrum")).toBeCloseTo(Math.sqrt(expected), 10);
  });
});

describe(".noise — end-to-end via netlist", () => {
  test(".noise card parses and runs with an op-amp stage", () => {
    const netlist = `noisy amp
.subckt OPAMP_IDEAL INP INN OUT
  RIN INP INN 1meg
  E1 OUT 0 INP INN 1e6
.ends
V1 in 0 DC 0 AC 1
RS in inn 1k
X1 0 inn out OPAMP_IDEAL
R1 inn 0 100k
R2 out inn 100k
.noise v(out) V1 dec 10 1k 100k
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "noise" });
    expect(r.kind).toBe("noise");
    expect(r.axis.length).toBe(21); // dec 10/decade over two decades + 1
    // Gain −100: RS (1k) noise reflected to the output = 4kT·1k·(100)².
    const expected = FOURKT * 1000 * 100 * 100;
    expect(sig(r, "onoise_spectrum", 0)).toBeCloseTo(Math.sqrt(expected), 8);
    // Input-referred = output / 100² = the resistor's own density.
    expect(sig(r, "inoise_spectrum", 0)).toBeCloseTo(Math.sqrt(FOURKT * 1000), 8);
  });
});
