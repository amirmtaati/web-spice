/**
 * Compiler tests (SPEC §5.2): node/branch indexing, param resolution,
 * pre-flight checks with typed located errors.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";

import { compile } from "../src/compiler/index.ts";

function ir(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "T",
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

function r(name: string, a: string, b: string, value: number | string): Element {
  return { type: "R", name, n: [a, b], value };
}

describe("compiler — indexing", () => {
  test("nodes indexed in first-seen order; ground is -1 and case-insensitive", () => {
    const c = compile(ir([r("R1", "IN", "0", 1000), r("R2", "in", "OUT", 1000)]));
    expect(c.nodeCount).toBe(2);
    expect(c.nodeNames).toEqual(["IN", "OUT"]);
    expect(c.elements[0]?.nodes).toEqual([0, -1]);
    expect(c.elements[1]?.nodes).toEqual([0, 1]);
  });

  test("V and L allocate branch unknowns in element order", () => {
    const c = compile(
      ir([
        // Island 1: V source with load
        { type: "V", name: "V1", n: ["a", "0"], dc: 5 },
        r("R2", "a", "0", 1000),
        // Island 2: inductor with DC path
        { type: "L", name: "L1", n: ["b", "0"], value: 1e-3 },
        r("R3", "b", "0", 1000),
        // Island 3: E output c-d, each node grounded, control nodes at ground
        { type: "E", name: "E1", n: ["c", "d", "0", "0"], gain: 2 },
        r("R4", "c", "0", 1000),
        r("R5", "d", "0", 1000),
        // Island 4: H (branch owner) + F (borrows V1's branch) + I
        { type: "H", name: "H1", n: ["e", "0"], control: "V1", gain: 1 },
        { type: "F", name: "F1", n: ["e", "0"], control: "V1", gain: 1 },
        r("R6", "e", "0", 1000),
        // Island 5: I source needs a DC path at its node (MNA requirement)
        { type: "I", name: "I1", n: ["g", "0"], dc: 0.001 },
        r("R7", "g", "0", 1000),
      ]),
    );
    expect(c.branchCount).toBe(4); // V1, L1, E1, H1 (F uses V1's branch)
    expect(c.branchOwners).toEqual(["V1", "L1", "E1", "H1"]);
    // Branch fields hold absolute MNA offsets (after the 6 nodes).
    expect(c.elements.find((e) => e.name === "V1")?.branch).toBe(6);
    expect(c.elements.find((e) => e.name === "L1")?.branch).toBe(7);
    expect(c.elements.find((e) => e.name === "E1")?.branch).toBe(8);
    expect(c.elements.find((e) => e.name === "H1")?.branch).toBe(9);
    const f = c.elements.find((e) => e.name === "F1");
    expect(f?.controlBranch).toBe(6);
  });

  test("params resolve (chained, case-insensitive)", () => {
    const c = compile(
      ir([r("R1", "a", "0", "{RLOAD*2}")], {
        params: { rload: "1k", scale: 3 },
      }),
    );
    expect(c.elements[0]?.value).toBe(2000);
    expect(c.params.rload).toBe(1000);
  });
});

describe("compiler — pre-flight checks", () => {
  test("duplicate element name", () => {
    expect(() => compile(ir([r("R1", "a", "0", 1000), r("r1", "b", "0", 1000)]))).toThrow(
      /Duplicate element name/,
    );
  });

  test("no ground", () => {
    expect(() => compile(ir([r("R1", "a", "b", 1000)]))).toThrow(/no ground/i);
    try {
      compile(ir([r("R1", "a", "b", 1000)]));
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_NO_GROUND");
    }
  });

  test("floating node: capacitor-only connection", () => {
    // node b hangs off C1 only (R1 connects a-0)
    const els: Element[] = [
      r("R1", "a", "0", 1000),
      { type: "C", name: "C1", n: ["a", "b"], value: 1e-6 },
      { type: "C", name: "C2", n: ["b", "0"], value: 1e-6 },
    ];
    try {
      compile(ir(els));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_FLOATING_NODE");
      expect((e as { message: string }).message).toContain('"b"');
    }
  });

  test("floating node: current-source island", () => {
    const els: Element[] = [
      r("R1", "a", "0", 1000),
      { type: "I", name: "I1", n: ["a", "b"], dc: 0.001 },
      { type: "I", name: "I2", n: ["b", "0"], dc: 0.001 },
    ];
    expect(() => compile(ir(els))).toThrow(/no DC path to ground/);
  });

  test("voltage-source loop", () => {
    const els: Element[] = [
      { type: "V", name: "V1", n: ["a", "0"], dc: 5 },
      { type: "V", name: "V2", n: ["a", "0"], dc: 5 },
      r("R1", "a", "0", 1000),
    ];
    try {
      compile(ir(els));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_VSOURCE_LOOP");
      expect((e as { message: string }).message).toContain("V1");
      expect((e as { message: string }).message).toContain("V2");
    }
  });

  test("E/H sources count as voltage definitions in loops", () => {
    const els: Element[] = [
      { type: "V", name: "V1", n: ["a", "0"], dc: 5 },
      { type: "E", name: "E1", n: ["a", "0", "a", "0"], gain: 1 },
      r("R1", "a", "0", 1000),
    ];
    expect(() => compile(ir(els))).toThrow(/Voltage-source loop/);
  });

  test("unknown model reference", () => {
    const els: Element[] = [
      r("R1", "a", "0", 1000),
      { type: "D", name: "D1", n: ["a", "0"], model: "nope" },
    ];
    try {
      compile(ir(els));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_UNKNOWN_MODEL");
    }
  });

  test("known model reference passes", () => {
    const els: Element[] = [
      r("R1", "a", "0", 1000),
      { type: "D", name: "D1", n: ["a", "0"], model: "dx" },
    ];
    const c = compile(ir(els, { models: { dx: { name: "dx", type: "diode", parameters: {} } } }));
    expect(c.elements[1]?.type).toBe("D");
  });

  test("F/H controlling element must be a V source", () => {
    const els: Element[] = [
      r("R1", "a", "0", 1000),
      { type: "F", name: "F1", n: ["a", "0"], control: "R1", gain: 1 },
    ];
    expect(() => compile(ir(els))).toThrow(/not a voltage source/);
  });

  test("K coupling must be in (0,1) and reference real inductors", () => {
    expect(() =>
      compile(
        ir([
          { type: "L", name: "L1", n: ["a", "0"], value: 1e-3 },
          { type: "L", name: "L2", n: ["b", "0"], value: 1e-3 },
          { type: "K", name: "K1", inductors: ["L1", "L2"], coupling: 1.0 },
          r("R1", "a", "0", 1000),
        ]),
      ),
    ).toThrow(/coupling coefficient/);
    expect(() =>
      compile(
        ir([
          { type: "L", name: "L1", n: ["a", "0"], value: 1e-3 },
          { type: "K", name: "K1", inductors: ["L1", "L9"], coupling: 0.5 },
          r("R1", "a", "0", 1000),
        ]),
      ),
    ).toThrow(/unknown inductor/);
  });

  test("invalid values rejected", () => {
    expect(() => compile(ir([r("R1", "a", "0", 0)]))).toThrow(/resistance/);
    expect(() =>
      compile(ir([{ type: "L", name: "L1", n: ["a", "0"], value: -1 }, r("R1", "a", "0", 1000)])),
    ).toThrow(/inductance/);
  });

  test("B compiles from E3; X stays explicit E_NOT_IMPLEMENTED; S needs a model", () => {
    // B (behavioral source) is implemented from E3: it compiles, and the
    // expression itself is validated by the device's dual compiler.
    const bCompiled = compile(
      ir([
        r("R1", "a", "0", 1000),
        { type: "B", name: "B1", n: ["a", "0"], kind: "V", expr: "1" } as Element,
      ]),
    );
    const bEl = bCompiled.elements.find((e) => e.name === "B1");
    expect(bEl?.kind).toBe("V");
    expect(bEl?.expr).toBe("1");
    expect(bEl?.branch).toBeDefined(); // V-kind owns a branch unknown
    try {
      compile(
        ir([
          r("R1", "a", "0", 1000),
          { type: "X", name: "X1", n: ["a", "0"], subckt: "sub" } as Element,
        ]),
      );
      throw new Error("should have thrown for X");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_NOT_IMPLEMENTED");
    }
    // S is simulated from E2 — a missing model card is the error now.
    try {
      compile(
        ir([
          r("R1", "a", "0", 1000),
          { type: "S", name: "S1", n: ["a", "0"], ctrl: ["b", "0"], model: "sw" },
        ]),
      );
      throw new Error("should have thrown for S without a model");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_UNKNOWN_MODEL");
    }
  });
});

describe("compiler — warnings and defaults", () => {
  test("V without DC warns and defaults to 0", () => {
    const c = compile(ir([r("R1", "a", "0", 1000), { type: "V", name: "V1", n: ["a", "0"] }]));
    expect(c.elements[1]?.dc).toBe(0);
    expect(c.warnings.some((w) => w.elementName === "V1")).toBe(true);
  });

  test("source defaults: V with wave only keeps dc undefined -> 0 with warning", () => {
    const c = compile(
      ir([
        r("R1", "a", "0", 1000),
        {
          type: "V",
          name: "V1",
          n: ["a", "0"],
          wave: {
            kind: "PULSE",
            v1: 0,
            v2: 5,
            delay: 0,
            rise: 1e-9,
            fall: 1e-9,
            width: 1e-3,
            period: 2e-3,
          },
        },
      ]),
    );
    expect(c.elements[1]?.dc).toBe(0);
  });
});
