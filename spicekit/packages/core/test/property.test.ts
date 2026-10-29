/**
 * Property-based invariants (SPEC §13.3) with a seeded PRNG (reproducible
 * in CI; fast-check adoption deferred — zero runtime deps rule, SPEC §12.4):
 *
 *  1. KCL: random passive networks satisfy KCL at every node < abstol scale.
 *  2. Reordering elements does not change the solution beyond tolerance.
 *  3. Impedance/source scaling preserves voltage ratios.
 *  4. formatExact/parseValue round trip bit-exactly across 1e-15…1e12.
 *  5. Parser fuzzer: random input never crashes with a non-EngineError and
 *     never hangs (fixed budget, SPEC §13.4).
 */
import { describe, expect, test } from "bun:test";
import { type Circuit, DEFAULT_SIM_OPTIONS, type Element, EngineError } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import { formatExact, parseNetlist, parseValue } from "../src/parser/index.ts";

/** Mulberry32: small, fast, seedable — deterministic runs in CI. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PassiveNet {
  elements: Element[];
  nodeNames: string[];
  resistors: { name: string; a: string; b: string; g: number }[];
  vSources: { name: string; plus: string; value: number }[];
  iSources: { name: string; plus: string; value: number }[];
}

/** Random connected passive network: spanning tree + extra R + sources. */
function randomNetwork(rand: () => number): PassiveNet {
  const nodeCount = 2 + Math.floor(rand() * 5); // 2..6 non-ground nodes
  const nodeNames = Array.from({ length: nodeCount }, (_, i) => `n${i + 1}`);
  const all = ["0", ...nodeNames];
  const resistors: PassiveNet["resistors"] = [];
  const elements: Element[] = [];
  let rn = 0;

  const addR = (a: string, b: string): void => {
    const name = `R${++rn}`;
    const r = 10 + rand() * 990;
    resistors.push({ name, a, b, g: 1 / r });
    elements.push({ type: "R", name, n: [a, b], value: r });
  };

  // Spanning tree over all nodes (guarantees DC paths to ground).
  const connected = ["0"];
  const rest = [...nodeNames];
  while (rest.length > 0) {
    const a = connected[Math.floor(rand() * connected.length)] as string;
    const b = rest.splice(Math.floor(rand() * rest.length), 1)[0] as string;
    addR(a, b);
    connected.push(b);
  }
  // Extra resistors.
  const extra = Math.floor(rand() * nodeCount);
  for (let i = 0; i < extra; i++) {
    const a = all[Math.floor(rand() * all.length)] as string;
    let b = all[Math.floor(rand() * all.length)] as string;
    if (a === b) {
      b = a === "0" ? "n1" : "0";
    }
    addR(a, b);
  }
  // 1-2 voltage sources at DISTINCT nodes (two sources on one node would be
  // a V-source loop, which the compiler rightly rejects).
  const vSources: PassiveNet["vSources"] = [];
  const shuffled = [...nodeNames].sort(() => rand() - 0.5);
  const vCount = 1 + (rand() > 0.6 ? 1 : 0);
  for (let i = 0; i < Math.min(vCount, shuffled.length); i++) {
    const plus = shuffled[i] as string;
    const name = `V${i + 1}`;
    const value = 1 + rand() * 9;
    vSources.push({ name, plus, value });
    elements.push({ type: "V", name, n: [plus, "0"], dc: value });
  }
  // Optional current sources.
  const iSources: PassiveNet["iSources"] = [];
  if (rand() > 0.5) {
    const plus = nodeNames[Math.floor(rand() * nodeCount)] as string;
    const name = "I1";
    const value = (rand() - 0.5) * 0.01;
    iSources.push({ name, plus, value });
    elements.push({ type: "I", name, n: [plus, "0"], dc: value });
  }
  return { elements, nodeNames, resistors, vSources, iSources };
}

function toCircuit(elements: Element[]): Circuit {
  return {
    title: "Property",
    elements,
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
  };
}

describe("property — KCL residuals on random passive networks", () => {
  test("sum of currents at every node is ~0 (50 seeded networks)", () => {
    const rand = rng(0xc1fc);
    for (let trial = 0; trial < 50; trial++) {
      const net = randomNetwork(rand);
      const result = runAnalysis(compile(toCircuit(net.elements)), { kind: "op" });
      const v = new Map<string, number>();
      for (const n of net.nodeNames) {
        v.set(n, result.signals.find((s) => s.name === `v(${n})`)?.values[0] ?? 0);
      }
      const iOf = (name: string): number =>
        result.signals.find((s) => s.name === `i(${name.toLowerCase()})`)?.values[0] ?? 0;
      const vGrounded = (n: string): number => (n === "0" ? 0 : (v.get(n) as number));

      let worst = 0;
      for (const nodeName of net.nodeNames) {
        let leaving = 0;
        for (const r of net.resistors) {
          if (r.a === nodeName) {
            leaving += r.g * (vGrounded(r.a) - vGrounded(r.b));
          } else if (r.b === nodeName) {
            leaving += r.g * (vGrounded(r.b) - vGrounded(r.a));
          }
        }
        for (const vs of net.vSources) {
          const i = iOf(vs.name); // current INTO the + terminal
          if (vs.plus === nodeName) {
            leaving += i;
          }
        }
        for (const is of net.iSources) {
          if (is.plus === nodeName) {
            leaving += is.value; // current leaves the + node
          }
        }
        const scale = 1e-3 + 1e-9; // milliamp-scale currents + abs floor
        worst = Math.max(worst, Math.abs(leaving) / scale);
      }
      expect(worst).toBeLessThan(1);
    }
  });
});

describe("property — invariances", () => {
  test("reordering elements preserves the solution", () => {
    const rand = rng(0x0bde);
    for (let trial = 0; trial < 20; trial++) {
      const net = randomNetwork(rand);
      const r1 = runAnalysis(compile(toCircuit(net.elements)), { kind: "op" });
      const shuffled = [...net.elements].sort(() => rand() - 0.5);
      const r2 = runAnalysis(compile(toCircuit(shuffled)), { kind: "op" });
      for (const n of net.nodeNames) {
        const a = r1.signals.find((s) => s.name === `v(${n})`)?.values[0] as number;
        const b = r2.signals.find((s) => s.name === `v(${n})`)?.values[0] as number;
        expect(Math.abs(a - b)).toBeLessThan(1e-9);
      }
    }
  });

  test("scaling R and V by α scales node voltages by α", () => {
    const rand = rng(0x5ca1e);
    for (let trial = 0; trial < 20; trial++) {
      const net = randomNetwork(rand);
      const alpha = 2 + rand() * 3;
      const scaled = net.elements.map((el): Element => {
        if (el.type === "R") {
          return { ...el, value: (el.value as number) * alpha };
        }
        if (el.type === "V") {
          return { ...el, dc: (el.dc as number) * alpha };
        }
        return el;
      });
      const r1 = runAnalysis(compile(toCircuit(net.elements)), { kind: "op" });
      const r2 = runAnalysis(compile(toCircuit(scaled)), { kind: "op" });
      for (const n of net.nodeNames) {
        const a = r1.signals.find((s) => s.name === `v(${n})`)?.values[0] as number;
        const b = r2.signals.find((s) => s.name === `v(${n})`)?.values[0] as number;
        expect(Math.abs(b - a * alpha)).toBeLessThan(1e-6 * alpha + 1e-9);
      }
    }
  });
});

describe("property — formatExact/parseValue round trip", () => {
  test("bit-exact across magnitudes 1e-15…1e12", () => {
    const rand = rng(0xf0be);
    for (let i = 0; i < 2000; i++) {
      const exponent = -15 + rand() * 27;
      const mantissa = rand() * 2 - 1;
      const value = mantissa * 10 ** exponent;
      const text = formatExact(value);
      expect(parseValue(text)).toBe(value);
    }
    // Extremes and specials.
    for (const value of [0, 1e-15, 1e12, 4.7e3, 0.1, -0.3, 123456789.12345679]) {
      expect(parseValue(formatExact(value))).toBe(value);
    }
  });
});

describe("property — parser fuzzer (SPEC §13.4)", () => {
  const ALPHABET =
    " RCLVKI0123456789.=(){},+-*/^;*\n\t%$#@!\"'`~[]:\\|?<>abcdegijklmnoprstuxyz".split("");

  test("random garbage either parses or raises E_PARSE — never anything else", () => {
    const rand = rng(0xf424);
    for (let i = 0; i < 3000; i++) {
      const len = Math.floor(rand() * 60);
      let text = "";
      for (let j = 0; j < len; j++) {
        text += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      }
      try {
        parseNetlist(text); // may succeed (e.g. title-only) — fine
      } catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        expect((error as EngineError).code).toBe("E_PARSE");
      }
    }
  });

  test("mutated valid netlists behave the same way", () => {
    const base = [
      "Fuzz",
      "R1 in out 4.7k",
      "C1 out 0 100n IC=0",
      "V1 in 0 DC 5 AC 1 PULSE(0 5 1u 10n 10n 1m 2m)",
      ".param rl=1k",
      ".model dx diode is=2.52n",
      ".subckt s a b",
      "R2 a b 1k",
      ".ends s",
      ".options reltol=1e-4",
      ".tran 1u 10m",
      ".probe v(out)",
    ].join("\n");
    const rand = rng(0xabcd);
    for (let i = 0; i < 3000; i++) {
      const chars = base.split("");
      const mutations = 1 + Math.floor(rand() * 4);
      for (let m = 0; m < mutations; m++) {
        const op = rand();
        const pos = Math.floor(rand() * chars.length);
        if (op < 0.4) {
          chars[pos] = ALPHABET[Math.floor(rand() * ALPHABET.length)] as string;
        } else if (op < 0.7) {
          chars.splice(pos, 1);
        } else {
          chars.splice(pos, 0, ALPHABET[Math.floor(rand() * ALPHABET.length)] as string);
        }
      }
      try {
        parseNetlist(chars.join(""));
      } catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        expect((error as EngineError).code).toBe("E_PARSE");
      }
    }
  });
});
