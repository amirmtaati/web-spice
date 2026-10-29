/**
 * Netlist parser tests (SPEC §5.1): element cards, continuation lines,
 * comments, suffixes, expressions, waveforms, directives, diagnostics.
 */
import { describe, expect, test } from "bun:test";

import { parseNetlist, serializeNetlist, tryParseNetlist } from "../src/parser/index.ts";
import { parseValue } from "../src/parser/suffix.ts";

describe("parser — element cards", () => {
  test("basic linear elements", () => {
    const c = parseNetlist(
      [
        "Test",
        "R1 in out 4.7k",
        "C1 out 0 100n IC=0",
        "L1 1 2 10u IC=1m",
        "K1 L1 L2 0.99",
        "V1 in 0 DC 5",
        "I1 out 0 1m",
        ".op",
      ].join("\n"),
    );
    expect(c.title).toBe("Test");
    expect(c.elements).toHaveLength(6);
    expect(c.elements[0]).toEqual({ type: "R", name: "R1", n: ["in", "out"], value: 4700 });
    expect(c.elements[1]?.type).toBe("C");
    expect((c.elements[1] as { value: number }).value).toBeCloseTo(1e-7, 20);
    expect((c.elements[1] as { ic: number }).ic).toBe(0);
    expect((c.elements[2] as { value: number }).value).toBeCloseTo(1e-5, 20);
    expect((c.elements[2] as { ic: number }).ic).toBeCloseTo(0.001, 20);
    expect(c.elements[3]).toEqual({
      type: "K",
      name: "K1",
      inductors: ["L1", "L2"],
      coupling: 0.99,
    });
    expect(c.elements[4]).toEqual({ type: "V", name: "V1", n: ["in", "0"], dc: 5 });
    expect(c.elements[5]).toEqual({ type: "I", name: "I1", n: ["out", "0"], dc: 0.001 });
  });

  test("dependent sources E/G/F/H", () => {
    const c = parseNetlist(
      ["Dep", "E1 out 0 in 0 100", "G1 out 0 in 0 1m", "F1 out 0 V1 2", "H1 out 0 V1 1k"].join(
        "\n",
      ),
    );
    expect(c.elements[0]).toMatchObject({
      type: "E",
      name: "E1",
      n: ["out", "0", "in", "0"],
      gain: 100,
    });
    expect(c.elements[1]).toMatchObject({ type: "G", name: "G1", gm: 0.001 });
    expect(c.elements[2]).toMatchObject({
      type: "F",
      name: "F1",
      n: ["out", "0"],
      control: "V1",
      gain: 2,
    });
    expect(c.elements[3]).toMatchObject({ type: "H", name: "H1", control: "V1", gain: 1000 });
  });

  test("expression values with braces (possibly spaced)", () => {
    const c = parseNetlist("X\nR1 1 2 {Rload*2}\nR2 2 0 { Rload * 4 }");
    expect(c.elements[0]?.value).toBe("Rload*2");
    expect(c.elements[1]?.value).toBe("Rload * 4");
  });

  test("value units tolerated (10kohm, 47uf)", () => {
    const c = parseNetlist("U\nR1 1 0 10kohm\nC1 1 0 47uf");
    expect(c.elements[0]?.value).toBe(10000);
    expect(c.elements[1]?.value).toBeCloseTo(4.7e-5, 20);
  });

  test("resistor temperature coefficients", () => {
    const c = parseNetlist("T\nR1 1 0 1k TC=0.001, 0.000002");
    expect(c.elements[0]).toMatchObject({ type: "R", tc1: 0.001, tc2: 0.000002 });
  });

  test("nonlinear device cards parse (simulate from E2)", () => {
    const c = parseNetlist(
      [
        "NL",
        ".model dn 1n4148 is=2.52n rs=0.568 n=1.75 cjo=4p m=0.4 bv=100",
        "D1 a b dn 2",
        ".model qn 2n3904 bf=300",
        "Q1 c b e qn 1.5",
        ".model mn 2n7000 vto=2",
        "M1 d g s 0 mn W=1u L=0.5u",
        ".model jn 2n5457",
        "J1 d g s jn",
      ].join("\n"),
    );
    expect(c.elements[0]).toEqual({ type: "D", name: "D1", n: ["a", "b"], model: "dn", area: 2 });
    expect(c.elements[1]).toEqual({
      type: "Q",
      name: "Q1",
      n: ["c", "b", "e"],
      model: "qn",
      area: 1.5,
    });
    expect(c.elements[2]).toMatchObject({ type: "M", name: "M1", model: "mn", w: 1e-6, l: 5e-7 });
    expect(c.elements[3]).toEqual({ type: "J", name: "J1", n: ["d", "g", "s"], model: "jn" });
    expect(c.models.dn?.type).toBe("1n4148");
    expect(c.models.dn?.parameters.is).toBeCloseTo(2.52e-9, 20);
  });
});

describe("parser — sources and waveforms", () => {
  test("SIN with and without parens", () => {
    const c = parseNetlist("W\nV1 1 0 SIN(0 1 1k)\nV2 2 0 SIN 0 2 10k 1m 1e3");
    expect(c.elements[0]?.wave).toEqual({ kind: "SIN", offset: 0, amp: 1, freq: 1000 });
    expect(c.elements[1]?.wave).toEqual({
      kind: "SIN",
      offset: 0,
      amp: 2,
      freq: 10000,
      delay: 0.001,
      damping: 1000,
    });
  });

  test("PULSE", () => {
    const c = parseNetlist("W\nV1 1 0 PULSE(0 5 1u 10n 10n 1m 2m)");
    expect(c.elements[0]?.wave).toEqual({
      kind: "PULSE",
      v1: 0,
      v2: 5,
      delay: 1e-6,
      rise: 1e-8,
      fall: 1e-8,
      width: 1e-3,
      period: 2e-3,
    });
  });

  test("PWL across continuation lines with REPEAT", () => {
    const c = parseNetlist("W\nV1 1 0 PWL(0 0\n+ 1m 1\n+ 2m 0) REPEAT");
    expect(c.elements[0]?.wave).toEqual({
      kind: "PWL",
      points: [
        [0, 0],
        [0.001, 1],
        [0.002, 0],
      ],
      repeat: true,
    });
  });

  test("DC + AC + waveform combined", () => {
    const c = parseNetlist("W\nV1 in 0 DC 2 AC 1 90 SIN(2 1 100)");
    const v = c.elements[0] as {
      dc?: unknown;
      ac?: { mag: number; phase?: number };
      wave?: { kind: string };
    };
    expect(v.dc).toBe(2);
    expect(v.ac).toEqual({ mag: 1, phase: 90 });
    expect(v.wave?.kind).toBe("SIN");
  });

  test("bare value means DC", () => {
    const c = parseNetlist("W\nV1 1 0 5\nI1 1 0 -1m");
    expect(c.elements[0]?.dc).toBe(5);
    expect(c.elements[1]?.dc).toBe(-0.001);
  });
});

describe("parser — structure and directives", () => {
  test("title, comments, blank lines, continuation, case-insensitive keywords", () => {
    const c = parseNetlist(
      [
        "My Circuit Title",
        "* full-line comment",
        "R1 1 0 1k ; inline comment",
        "+",
        "V1 1 0 dc 5",
        ".OP",
        "",
        ".end",
        "R2 9 9 1 ignored after .end",
      ].join("\n"),
    );
    expect(c.title).toBe("My Circuit Title");
    expect(c.elements).toHaveLength(2);
    expect(c.analyses).toEqual([{ kind: "op" }]);
  });

  test("a leading '*' line IS the title (SPICE rule)", () => {
    const c = parseNetlist("* title-looking comment\nR1 1 0 1k");
    expect(c.title).toBe("* title-looking comment");
    expect(c.elements).toHaveLength(1);
  });

  test("the first line is always the title (SPICE rule)", () => {
    const c = parseNetlist("R99 1 2 3k");
    expect(c.title).toBe("R99 1 2 3k");
    expect(c.elements).toHaveLength(0);
  });

  test(".param assignments", () => {
    const c = parseNetlist("P\n.param rload=1k vdd={2.5*2}\nR1 1 0 {rload}");
    expect(c.params.rload).toBe(1000);
    expect(c.params.vdd).toBe("2.5*2");
    expect(c.elements[0]?.value).toBe("rload");
  });

  test(".model card", () => {
    const c = parseNetlist("M\n.model d1n4148 diode (is=2.52n n=1.75 bv=100)");
    const m = c.models.d1n4148;
    expect(m?.type).toBe("diode");
    expect(m?.parameters.is).toBeCloseTo(2.52e-9, 20);
    expect(m?.parameters.n).toBe(1.75);
    expect(m?.parameters.bv).toBe(100);
  });

  test(".subckt with ports and params, nested elements", () => {
    const c = parseNetlist(
      [
        "S",
        ".subckt div a b params: ratio=0.5",
        "R1 a mid {1k*ratio}",
        "R2 mid b 1k",
        ".ends div",
      ].join("\n"),
    );
    const sub = c.subcircuits.div;
    expect(sub?.name).toBe("div");
    expect(sub?.ports).toEqual(["a", "b"]);
    expect(sub?.circuit.elements).toHaveLength(2);
    expect(sub?.circuit.params.ratio).toBe(0.5);
    expect(c.elements).toHaveLength(0); // X instantiation parses from E3
  });

  test("nested subcircuits", () => {
    const c = parseNetlist(
      [
        "N",
        ".subckt inner x y",
        "R1 x y 1",
        ".ends inner",
        ".subckt outer p q",
        "R9 p q 1",
        ".ends outer",
      ].join("\n"),
    );
    expect(c.subcircuits.inner).toBeDefined();
    expect(c.subcircuits.outer).toBeDefined();
  });

  test(".options known keys", () => {
    const c = parseNetlist("O\n.options reltol=1e-4 method=be temp=40 trtol=2");
    expect(c.options.reltol).toBe(1e-4);
    expect(c.options.method).toBe("be");
    expect(c.options.temp).toBe(40);
    expect(c.options.trtol).toBe(2);
  });

  test("analysis cards", () => {
    const c = parseNetlist(
      ["A", ".op", ".dc V1 0 5 0.5 V2 1 2 0.1", ".tran 1u 10m 1m 5u UIC", ".ac dec 10 1 100k"].join(
        "\n",
      ),
    );
    expect(c.analyses[0]).toEqual({ kind: "op" });
    expect(c.analyses[1]).toEqual({
      kind: "dc",
      source: "V1",
      start: 0,
      stop: 5,
      step: 0.5,
      second: { source: "V2", start: 1, stop: 2, step: 0.1 },
    });
    const tran = c.analyses[2] as {
      kind: string;
      tstep: number;
      tstop: number;
      tstart: number;
      tmax: number;
      uic: boolean;
    };
    expect(tran.kind).toBe("tran");
    expect(tran.tstep).toBeCloseTo(1e-6, 20);
    expect(tran.tstop).toBeCloseTo(0.01, 20);
    expect(tran.tstart).toBeCloseTo(0.001, 20);
    expect(tran.tmax).toBeCloseTo(5e-6, 20);
    expect(tran.uic).toBe(true);
    expect(c.analyses[3]).toEqual({
      kind: "ac",
      sweep: "dec",
      points: 10,
      fstart: 1,
      fstop: 100000,
    });
  });

  test(".ic and .probe", () => {
    const c = parseNetlist("I\n.ic v(out)=2.5 v(mid)=1\n.probe v(out) i(R1)");
    expect(c.ic).toEqual({ out: 2.5, mid: 1 });
    expect(c.probes).toEqual([{ signal: "v(out)" }, { signal: "i(r1)" }]);
  });
});

describe("parser — diagnostics", () => {
  function firstDiag(text: string): { line: number; column: number; message: string } {
    const r = tryParseNetlist(text);
    expect(r.circuit).toBeUndefined();
    const d = r.diagnostics[0];
    expect(d).toBeDefined();
    return d as { line: number; column: number; message: string };
  }

  test("unknown element type", () => {
    const d = firstDiag("T\nZ1 1 0 1k");
    expect(d.line).toBe(2);
    expect(d.column).toBe(1);
    expect(d.message).toMatch(/Unknown element type/);
  });

  test("missing operand points at end of card", () => {
    const d = firstDiag("T\nR1 1 0");
    expect(d.line).toBe(2);
    expect(d.message).toMatch(/missing operand/i);
  });

  test("invalid value", () => {
    const d = firstDiag("T\nR1 1 0 ?bad?");
    expect(d.line).toBe(2);
    expect(d.column).toBe(8);
    expect(d.message).toMatch(/Invalid value/);
  });

  test("continuation without preceding card", () => {
    const d = firstDiag("T\n+ 1 2 3");
    expect(d.line).toBe(2);
    expect(d.message).toMatch(/Continuation/);
  });

  test("unterminated subckt", () => {
    const d = firstDiag("T\n.subckt s a b\nR1 a b 1");
    expect(d.message).toMatch(/Unterminated .subckt/);
  });

  test("unknown directive", () => {
    const d = firstDiag("T\n.nodeset v(1)=0");
    expect(d.message).toMatch(/Unsupported directive/);
  });

  test("unknown .options key", () => {
    const d = firstDiag("T\n.options bogus=1");
    expect(d.message).toMatch(/Unknown .options key/);
  });

  test("PWL monotonicity enforced", () => {
    const d = firstDiag("T\nV1 1 0 PWL(0 0 0 1)");
    expect(d.message).toMatch(/strictly increasing/);
  });

  test(".include without resolver", () => {
    const d = firstDiag("T\n.include lib.inc");
    expect(d.message).toMatch(/IncludeResolver/);
  });
});

describe("parser — serializer round trip", () => {
  function roundTrip(text: string): void {
    const ir = parseNetlist(text);
    const again = parseNetlist(serializeNetlist(ir));
    expect(again).toEqual(ir);
  }

  test("linear circuit with all extras", () => {
    roundTrip(
      [
        "Round trip",
        "R1 in out 4.7k TC=0.001",
        "C1 out 0 100n IC=0",
        "L1 1 2 10u",
        "K1 L1 L2 0.99",
        "V1 in 0 DC 5 AC 1 0 PULSE(0 5 1u 10n 10n 1m 2m)",
        "I1 out 0 1m",
        "E1 out 0 in 0 100",
        "G1 out 0 in 0 1m",
        "F1 out 0 V1 2",
        "H1 out 0 V1 1k",
        ".model dx diode is=2.52n",
        ".param rload=1k",
        ".options reltol=1e-4 method=be",
        ".ic v(out)=2.5",
        ".op",
        ".tran 1u 10m",
        ".probe v(out) i(r1)",
      ].join("\n"),
    );
  });

  test("subcircuit round trip", () => {
    roundTrip(
      [
        "Sub",
        ".subckt div a b params: ratio=0.5",
        "R1 a mid {1k*ratio}",
        "R2 mid b 1k",
        ".ends div",
      ].join("\n"),
    );
  });

  test("exact double formatting survives (4.7k stays exact)", () => {
    const c = parseNetlist("E\nR1 1 0 4.7k\nR2 1 0 0.0001");
    const text = serializeNetlist(c);
    const again = parseNetlist(text);
    expect((again.elements[0] as { value: number }).value).toBe(4700);
    expect((again.elements[1] as { value: number }).value).toBe(0.0001);
  });

  test("PWL round trip keeps doubles", () => {
    roundTrip("P\nV1 1 0 PWL(0 0 0.001 2.5 0.002 0)");
  });
});

describe("parser — helpers", () => {
  test("parseValue rejects garbage", () => {
    expect(() => parseValue("abc")).toThrow();
  });
});
