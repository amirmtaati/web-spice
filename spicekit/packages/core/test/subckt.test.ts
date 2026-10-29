/**
 * Subcircuit expansion (E3, SPEC §5.2): flattening, hierarchical names,
 * port mapping, nested instances, parameter scoping, model scoping, and
 * the built-in op-amp macromodels.
 */
import { describe, expect, test } from "bun:test";

import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { expandSubcircuits } from "../src/compiler/subckt.ts";
import { builtinSubckt } from "../src/models/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function sig(result: RunResult, name: string, point = 0): number {
  const s = result.signals.find((x) => x.name === name);
  if (s === undefined) {
    throw new Error(
      `signal ${name} not found; have: ${result.signals.map((x) => x.name).join(", ")}`,
    );
  }
  return s.values[point] as number;
}

const DIVIDER_NETLIST = `subckt divider
.subckt DIV A B P
  R1 A P 1k
  R2 P B 1k
.ends
V1 in 0 10
X1 in 0 mid DIV
.op
.end
`;

describe("subcircuit flattening", () => {
  test("X instance flattens with hierarchical node and element names", () => {
    const ir = parseNetlist(DIVIDER_NETLIST);
    const flat = expandSubcircuits(ir);
    const names = flat.elements.map((e) => e.name.toLowerCase());
    expect(names).toContain("x1.r1");
    expect(names).toContain("x1.r2");
    expect(names).not.toContain("x1");
    const r1 = flat.elements.find((e) => e.name.toLowerCase() === "x1.r1");
    // Port P maps to the external node "mid"; A maps to "in".
    expect(r1?.type === "R" && r1.n).toEqual(["in", "mid"]);
  });

  test("X-wrapped divider produces the correct operating point", () => {
    const ir = parseNetlist(DIVIDER_NETLIST);
    const r = runAnalysis(compile(ir), { kind: "op" });
    expect(sig(r, "v(mid)")).toBeCloseTo(5, 9);
  });

  test("two instances of one subckt do not collide", () => {
    const ir = parseNetlist(`two dividers
.subckt DIV A B P
  R1 A P 1k
  R2 P B 3k
.ends
V1 in 0 8
X1 in 0 m1 DIV
X2 in 0 m2 DIV
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // Each divider: 3k bottom leg → v = 8·3/4 = 6 at the port node.
    expect(sig(r, "v(m1)")).toBeCloseTo(6, 9);
    expect(sig(r, "v(m2)")).toBeCloseTo(6, 9);
  });

  test("nested subckts flatten with joined paths", () => {
    const ir = parseNetlist(`nested
.subckt LEAF A P
  R1 A P 1k
.ends
.subckt MID A P
  Xleaf A P LEAF
  R2 A P 1k
.ends
V1 in 0 10
Xmid in out MID
.op
.end
`);
    const flat = expandSubcircuits(ir);
    const names = flat.elements.map((e) => e.name.toLowerCase());
    expect(names).toContain("xmid.xleaf.r1");
    expect(names).toContain("xmid.r2");
    const r = runAnalysis(compile(ir), { kind: "op" });
    // xmid.r2 ∥ (xmid.xleaf.r1) = 500 Ω to ground; no drop (no current) —
    // v(out) = 10, both resistors see the full voltage.
    expect(sig(r, "v(out)")).toBeCloseTo(10, 9);
  });

  test("port count mismatch reports E_PARSE", () => {
    const ir = parseNetlist(`bad arity
.subckt DIV A B P
  R1 A P 1k
.ends
V1 in 0 8
X1 in 0 DIV
.op
.end
`);
    expect(() => compile(ir)).toThrow(/expects 3 nodes, got 2/);
  });

  test("unknown subcircuit name reports E_UNKNOWN_MODEL", () => {
    const ir = parseNetlist(`unknown sub
V1 in 0 8
X1 in 0 NOSUCH
.op
.end
`);
    expect(() => compile(ir)).toThrow(/unknown subcircuit/i);
  });
});

describe("subcircuit parameters", () => {
  test("instance params override subckt defaults", () => {
    const ir = parseNetlist(`param divider
.subckt DIV A B P params: RA=1k RB=1k
  R1 A P {RA}
  R2 P B {RB}
.ends
V1 in 0 12
X1 in 0 mid DIV params: RB=2k
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // v(mid) = 12·RB/(RA+RB) = 8 V with the instance override.
    expect(sig(r, "v(mid)")).toBeCloseTo(8, 9);
  });

  test("defaults apply when the instance passes no params", () => {
    const ir = parseNetlist(`param divider defaults
.subckt DIV A B P params: RA=1k RB=3k
  R1 A P {RA}
  R2 P B {RB}
.ends
V1 in 0 12
X1 in 0 mid DIV
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    expect(sig(r, "v(mid)")).toBeCloseTo(9, 9);
  });

  test("params may reference global parameters", () => {
    const ir = parseNetlist(`global param in subckt
.param VD=10
.subckt DIV A B P params: RA=1k RB={2*RA}
  R1 A P {RA}
  R2 P B {RB}
.ends
V1 in 0 {VD}
X1 in 0 mid DIV params: RA={VD/10}
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // RA = 1k (from VD), RB = 2k → v(mid) = 12·2/3… wait VDD is {VD}=10:
    expect(sig(r, "v(mid)")).toBeCloseTo(10 * (2 / 3), 9);
  });
});

describe("subcircuit model scoping", () => {
  test("models defined inside a subckt are scoped to their instances", () => {
    const ir = parseNetlist(`scoped models
.subckt DIODE_LOAD A P params: ISD=1e-12
  R1 A P 100
  D1 P 0 DMOD
  .model DMOD d (is={ISD})
.ends
V1 in 0 5
X1 in out DIODE_LOAD
X2 in out2 DIODE_LOAD params: ISD=1e-13
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // Both instances share the body-scoped model; the circuit solves.
    expect(Number.isFinite(sig(r, "v(out)"))).toBe(true);
    expect(Number.isFinite(sig(r, "v(out2)"))).toBe(true);
    const flat = expandSubcircuits(ir);
    // Body model got a prefixed card per instance.
    expect(flat.models["x1.dmod"]).toBeDefined();
    expect(flat.models["x2.dmod"]).toBeDefined();
  });

  test("global models remain visible inside subckts", () => {
    const ir = parseNetlist(`global model visibility
.subckt RESISTOR_DIV A P
  R1 A P 1k
  D1 P 0 GLOBALD
.ends
.model GLOBALD d (is=1e-14)
V1 in 0 5
X1 in out RESISTOR_DIV
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // D1 clamps nothing at 5 V reverse… forward: P node is out, D1 anode at
    // out, cathode ground → out clamps near a forward drop? No: current
    // flows A→P through R1 into D1 → out ≈ 0.6-0.7 V forward bias.
    const vout = sig(r, "v(out)");
    expect(vout).toBeGreaterThan(0.5);
    expect(vout).toBeLessThan(0.9);
  });
});

describe("built-in op-amp macromodels", () => {
  test("builtinSubckt resolves the ideal op-amp", () => {
    const sub = builtinSubckt("opamp_ideal");
    expect(sub).toBeDefined();
    expect(sub?.ports).toEqual(["INP", "INN", "OUT"]);
    const names = sub?.circuit.elements.map((e) => e.name.toLowerCase());
    expect(names).toContain("rin");
    expect(names).toContain("e1");
  });

  test("non-inverting amplifier with the ideal op-amp: gain = 1 + R2/R1", () => {
    const ir = parseNetlist(`ideal non-inverting amp
.subckt OPAMP_IDEAL INP INN OUT
  RIN INP INN 1meg
  E1 OUT 0 INP INN 1e6
.ends
V1 in 0 1
X1 in fb out OPAMP_IDEAL
R1 fb 0 1k
R2 out fb 3k
.op
.end
`);
    const r = runAnalysis(compile(ir), { kind: "op" });
    // Finite open-loop gain (1e6) and the 1 MΩ Rin loading the feedback
    // divider leave a ~1e-5 residue on the ideal 4.000 V.
    expect(sig(r, "v(out)")).toBeCloseTo(4, 4);
    expect(sig(r, "v(fb)")).toBeCloseTo(1, 4);
  });
});
