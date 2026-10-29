/**
 * Model library tests (SPEC §22 E2 "model library"). Covers the three
 * library jobs: parameter schemas (unknown names warn, defaults match the
 * devices), type/element compatibility (E_BAD_MODEL on mismatch), and the
 * built-in cards (resolvable without a .model card, netlist card wins on
 * name collision, every card simulates).
 */
import { describe, expect, test } from "bun:test";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import {
  BUILTIN_MODEL_CARDS,
  builtinModel,
  builtinModelNames,
  knownModelParams,
  MODEL_PARAM_SPECS,
  MODEL_TYPES_BY_ELEMENT,
  modelSpecsFor,
  specDefault,
  unknownModelParams,
} from "../src/models/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function opNode(netlist: string, node: string): number {
  const compiled = compile(parseNetlist(netlist));
  const r = runAnalysis(compiled, { kind: "op" });
  const sig = r.signals.find((s) => s.name === `v(${node.toLowerCase()})`);
  if (sig === undefined) {
    throw new Error(`node ${node} not probed; signals: ${r.signals.map((s) => s.name).join(", ")}`);
  }
  return sig.values[0] as number;
}

describe("parameter schemas", () => {
  test("every model type the devices implement has a schema", () => {
    const implemented = ["d", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "sw", "csw"];
    for (const type of implemented) {
      const specs = modelSpecsFor(type);
      expect(specs).toBeDefined();
      expect((specs ?? []).length).toBeGreaterThan(3);
    }
    // And nothing outside the implemented set sneaks in.
    expect(Object.keys(MODEL_PARAM_SPECS).sort()).toEqual([...implemented].sort());
  });

  test("schema defaults agree with the device defaults (spot checks)", () => {
    // Values must mirror the device modules; a drift here means a card that
    // omits a parameter no longer matches the documented SPICE default.
    expect(specDefault("d", "is")).toBe(1e-14);
    expect(specDefault("d", "n")).toBe(1);
    expect(specDefault("d", "m")).toBe(0.5);
    expect(specDefault("npn", "bf")).toBe(100);
    expect(specDefault("npn", "is")).toBe(1e-16);
    expect(specDefault("nmos", "kp")).toBe(2e-5);
    expect(specDefault("nmos", "vto")).toBe(0);
    expect(specDefault("pmos", "vto")).toBe(0); // sign comes from the element
    expect(specDefault("njf", "vto")).toBe(-2);
    expect(specDefault("pjf", "vto")).toBe(-2); // sign comes from the element
    expect(specDefault("sw", "ron")).toBe(1);
    expect(specDefault("csw", "it")).toBe(0);
    expect(specDefault("sw", "roff")).toBe(1e12);
  });

  test("aliases resolve: cjo and cj0 are the same diode parameter", () => {
    const known = knownModelParams("d");
    expect(known.has("cjo")).toBe(true);
    expect(known.has("cj0")).toBe(true);
    // The alias is recognized, so it never lands in unknownModelParams.
    expect(unknownModelParams("d", { cj0: 1e-12 })).toEqual([]);
  });

  test("unknown params are detected (typo trap)", () => {
    expect(unknownModelParams("d", { iss: 1e-15, IS: 5e-15, bogus: 3 })).toEqual(["iss", "bogus"]);
    expect(unknownModelParams("npn", { ikf: 0.05 })).toEqual(["ikf"]);
  });
});

describe("type/element compatibility", () => {
  test("D element with an nmos model card fails with E_BAD_MODEL", () => {
    const netlist = `bad model type
V1 a 0 1
D1 a 0 MX
.model MX nmos(vto=0.8)
.end`;
    expect(() => compile(parseNetlist(netlist))).toThrow(/cannot use a "nmos" model/);
    try {
      compile(parseNetlist(netlist));
    } catch (e) {
      expect((e as { code?: string }).code).toBe("E_BAD_MODEL");
    }
  });

  test("each element letter accepts exactly its documented model types", () => {
    expect(MODEL_TYPES_BY_ELEMENT.D).toEqual(["d"]);
    expect(MODEL_TYPES_BY_ELEMENT.Q).toEqual(["npn", "pnp"]);
    expect(MODEL_TYPES_BY_ELEMENT.M).toEqual(["nmos", "pmos"]);
    expect(MODEL_TYPES_BY_ELEMENT.J).toEqual(["njf", "pjf"]);
    expect(MODEL_TYPES_BY_ELEMENT.S).toEqual(["sw"]);
    expect(MODEL_TYPES_BY_ELEMENT.W).toEqual(["csw"]);
  });
});

describe("unknown-parameter warnings", () => {
  test("a typo'd model parameter warns instead of silently defaulting", () => {
    const netlist = `typo trap
V1 a 0 1
D1 a 0 DX
.model DX d(iss=1e-15 is=1e-14)
.end`;
    const compiled = compile(parseNetlist(netlist));
    const w = compiled.warnings.find((c) => c.code === "W_MODEL_PARAM_UNKNOWN");
    expect(w).toBeDefined();
    expect(w?.message).toContain("iss");
    expect(w?.elementName).toBe("D1");
  });

  test("known parameters never warn", () => {
    const netlist = `clean card
V1 a 0 1
D1 a 0 DX
.model DX d(is=1e-14 rs=1 cjo=2e-12 bv=75)
.end`;
    const compiled = compile(parseNetlist(netlist));
    expect(compiled.warnings.some((c) => c.code === "W_MODEL_PARAM_UNKNOWN")).toBe(false);
  });
});

describe("built-in cards", () => {
  test("registry is complete and sorted", () => {
    expect(builtinModelNames()).toEqual([...builtinModelNames()].sort());
    expect(builtinModelNames()).toContain("d_signal");
    expect(builtinModelNames()).toContain("npn_generic");
    expect(builtinModelNames()).toContain("nmos_5v");
  });

  test("elements resolve builtins without a .model card", () => {
    const netlist = `builtin diode, no card
V1 cc 0 5
D1 cc mid d_signal
R1 mid 0 1k
.end`;
    const vm = opNode(netlist, "mid");
    // d_signal: Is=2.52n, n=1.752 → soft knee, drop ≈ 0.55–0.75 V at ~4.4 mA.
    expect(vm).toBeGreaterThan(3.9);
    expect(vm).toBeLessThan(4.7);
  });

  test("a netlist .model card overrides the builtin of the same name", () => {
    // Card d_signal as an ideal diode: Is=1e-16, n=1 → sharp knee, drop ≈ 0.72 V.
    const netlist = `netlist card wins
V1 cc 0 5
D1 cc mid d_signal
R1 mid 0 1k
.model d_signal d(is=1e-16 n=1)
.end`;
    const withCard = opNode(netlist, "mid");
    const noCard = opNode(
      `no card
V1 cc 0 5
D1 cc mid d_signal
R1 mid 0 1k
.end`,
      "mid",
    );
    // The override must change the answer (a ~0.1 V knee difference at this
    // current), proving the card replaced the builtin.
    expect(Math.abs(withCard - noCard)).toBeGreaterThan(0.02);
  });

  test("every built-in card simulates in a minimal circuit", () => {
    const fixtures: Array<{ name: string; netlist: string; node: string }> = [
      {
        name: "d_ideal",
        netlist: `V1 cc 0 5\nD1 cc mid d_ideal\nR1 mid 0 1k\n.end`,
        node: "mid",
      },
      {
        name: "npn_generic",
        netlist: `VCC cc 0 12\nRB cc b 470k\nRC cc c 2k\nQ1 c b 0 npn_generic\n.end`,
        node: "c",
      },
      {
        name: "pnp_generic",
        netlist: `VCC cc 0 12\nRB cc b 470k\nRC c cc 2k\nQ1 c b 0 pnp_generic\n.end`,
        node: "c",
      },
      {
        name: "nmos_5v",
        netlist: `VDD dd 0 5\nMN out g 0 0 nmos_5v\nRG g dd 1meg\nRD out dd 10k\n.end`,
        node: "out",
      },
      {
        name: "pmos_5v",
        netlist: `VDD dd 0 5\nMP out g dd dd pmos_5v\nRG g 0 1meg\nRD out dd 10k\n.end`,
        node: "out",
      },
      {
        name: "nmos_4000",
        netlist: `VDD dd 0 15\nMN out g 0 0 nmos_4000\nRG g dd 1meg\nRD out dd 100k\n.end`,
        node: "out",
      },
      {
        name: "njf_generic",
        netlist: `VDD dd 0 12\nRD d dd 4.7k\nJ1 d g 0 njf_generic\nRG g 0 1meg\n.end`,
        node: "d",
      },
      {
        name: "pjf_generic",
        netlist: `VEE ee 0 -12\nRD d ee 4.7k\nJ1 d g 0 pjf_generic\nRG g 0 1meg\n.end`,
        node: "d",
      },
      {
        name: "sw_fast",
        netlist: `V1 cc 0 5\nR1 cc n1 1k\nS1 n1 0 cc 0 sw_fast\nR2 n1 0 1meg\n.end`,
        node: "n1",
      },
      {
        name: "csw_fast",
        netlist: `V1 cc 0 5\nVSENSE cc n1 0\nR1 n1 out 1k\nW1 out 0 vsense csw_fast\nR2 out 0 100\n.end`,
        node: "out",
      },
    ];
    for (const f of fixtures) {
      const netlist = `builtin ${f.name}\n${f.netlist}`;
      const value = opNode(netlist, f.node);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("builtinModel lookup is case-insensitive", () => {
    expect(builtinModel("D_Signal")?.type).toBe("d");
    expect(builtinModel("NPN_GENERIC")?.type).toBe("npn");
  });
});

describe("defaults equivalence", () => {
  test("an empty diode card matches the fully explicit default card", () => {
    const empty = `empty card
V1 cc 0 5
D1 cc mid de
R1 mid 0 1k
.model de d()
.end`;
    const explicit = `explicit defaults
V1 cc 0 5
D1 cc mid dx
R1 mid 0 1k
.model dx d(is=1e-14 rs=0 n=1 ibv=1e-3 cjo=0 m=0.5 vj=1 fc=0.5 tt=0 eg=1.11 xti=3)
.end`;
    expect(opNode(empty, "mid")).toBeCloseTo(opNode(explicit, "mid"), 10);
  });

  test("BUILTIN_MODEL_CARDS all have schema-valid types and known params", () => {
    for (const card of BUILTIN_MODEL_CARDS) {
      expect(modelSpecsFor(card.type)).toBeDefined();
      expect(unknownModelParams(card.type, card.parameters)).toEqual([]);
      expect(MODEL_TYPES_BY_ELEMENT).toBeDefined();
    }
  });
});
