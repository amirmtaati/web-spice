/**
 * Behavioral B sources (E3, SPEC §5.6/§5.7): dual-number AD correctness
 * against finite differences, DC/OP behavior for both kinds, AC
 * linearization, transient drive, builtin functions, netlist card forms.
 */
import { describe, expect, test } from "bun:test";

import { type Circuit, DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import { runAnalysis } from "../src/analyses/index.ts";
import type { RunResult } from "../src/analyses/result.ts";
import { compile } from "../src/compiler/index.ts";
import { constDual, type DualEvalContext } from "../src/eval/dual.ts";
import { compileExpression, compileExpressionDual } from "../src/eval/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

function circuit(elements: Element[], extra: Partial<Circuit> = {}): Circuit {
  return {
    title: "B source",
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

describe("dual-number AD", () => {
  /** Evaluate a dual expression at v(a)=va, v(b)=vb. */
  function evalDual(
    src: string,
    va: number,
    vb: number,
  ): { value: number; dA: number; dB: number } {
    const compiled = compileExpressionDual(src);
    const slotA = compiled.operands.findIndex((o) => o.kind === "v" && o.name === "a");
    const slotB = compiled.operands.findIndex((o) => o.kind === "v" && o.name === "b");
    const ctx: DualEvalContext = {
      time: 0,
      tempC: 27,
      v: (name: string, slot: number) => {
        const grads = new Float64Array(compiled.nSlots);
        if (slot < grads.length) {
          grads[slot] = 1;
        }
        return { value: name === "a" ? va : vb, grads };
      },
      i: (name: string, slot: number) => {
        const grads = new Float64Array(compiled.nSlots);
        if (slot < grads.length) {
          grads[slot] = 1;
        }
        return { value: name === "vmeas" ? 0.5 : 0, grads };
      },
      param: (name: string) => {
        const table: Record<string, number> = { gain: 3, off: -0.5 };
        return constDual(compiled.nSlots, table[name] ?? 0);
      },
    };
    const d = compiled.fn(ctx);
    return {
      value: d.value,
      dA: slotA >= 0 ? (d.grads[slotA] as number) : 0,
      dB: slotB >= 0 ? (d.grads[slotB] as number) : 0,
    };
  }

  const CASES: { src: string; a: number; b: number }[] = [
    { src: "v(a) + v(b)", a: 1.3, b: -0.7 },
    { src: "2*v(a) - 3*v(b)", a: 0.4, b: 1.1 },
    { src: "v(a)*v(b) + 1", a: 1.5, b: -2 },
    { src: "v(a)/v(b)", a: 3, b: 4 },
    { src: "v(a)^2", a: 1.7, b: 9 },
    { src: "sin(v(a)) + cos(v(b))", a: 0.6, b: -1.2 },
    { src: "exp(v(a)*0.5) + log(v(b))", a: 1, b: 3 },
    { src: "sqrt(v(a)^2 + 1)", a: 2, b: 9 },
    { src: "abs(v(a)) * sgn(v(b))", a: -1.5, b: 2 },
    { src: "limit(v(a), -1, 1) + 5", a: 2.5, b: 9 },
    { src: "min(v(a), v(b)) + max(v(a), v(b))", a: 4, b: -2 },
    { src: "u(v(a)) + uramp(v(b))", a: -1, b: 3 },
    { src: "gain*v(a) + off", a: 2, b: 9 },
    { src: "v(a) > 0 ? v(a) : -v(a)", a: -3, b: 9 },
    { src: "tanh(v(a)) + sinh(v(b)*0.1)", a: 0.8, b: 1 },
    { src: "table(v(a) 0 0 1 10 2 25)", a: 1.5, b: 9 },
    { src: "i(vmeas)*2 + v(a)", a: 0.3, b: 9 },
    { src: "pow(v(a), 2) + atan2(v(b), 1)", a: 1.2, b: 0.5 },
  ];

  for (const c of CASES) {
    test(`value matches the real compiler: ${c.src}`, () => {
      const realCtx = {
        time: 0,
        tempC: 27,
        v: (name: string) => (name === "a" ? c.a : c.b),
        i: (name: string) => (name === "vmeas" ? 0.5 : 0),
        param: (name: string) => {
          const table: Record<string, number> = { gain: 3, off: -0.5 };
          const v = table[name];
          if (v === undefined) {
            throw new Error(`unknown param ${name}`);
          }
          return v;
        },
      };
      const realValue = compileExpression(c.src)(realCtx);
      const dual = evalDual(c.src, c.a, c.b);
      expect(dual.value).toBeCloseTo(realValue, 10);
    });
  }

  for (const c of CASES) {
    test(`AD gradient matches finite differences: ${c.src}`, () => {
      const h = 1e-6;
      const plus = evalDual(c.src, c.a + h, c.b);
      const minus = evalDual(c.src, c.a - h, c.b);
      const fdA = (plus.value - minus.value) / (2 * h);
      const d = evalDual(c.src, c.a, c.b);
      expect(d.dA).toBeCloseTo(fdA, 4);
    });
  }

  test("operand list captures distinct v()/i() accesses in order", () => {
    const compiled = compileExpressionDual("v(b) + v(a)*v(b) + i(V1)");
    expect(compiled.operands.map((o) => `${o.kind}(${o.name})`)).toEqual(["v(b)", "v(a)", "i(V1)"]);
    expect(compiled.nSlots).toBe(3);
  });
});

describe("B sources — OP behavior", () => {
  test("V-kind polynomial matches a hand-computed operating point", () => {
    // B1 out 0 V = 2*v(in); divider R1 = R2 = 1k from out to ground.
    // v(out) = 2·v(in)·(1k/2k)... wait: out is driven by B; R1/R2 divide it:
    // v(mid) = v(out)/2. With v(in) = 3: v(out) = 6, v(mid) = 3.
    const c = circuit([
      { type: "V", name: "Vin", n: ["in", "0"], dc: 3 },
      { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "2*v(in)" },
      { type: "R", name: "R1", n: ["out", "mid"], value: 1000 },
      { type: "R", name: "R2", n: ["mid", "0"], value: 1000 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(6, 9);
    expect(sig(r, "v(mid)")).toBeCloseTo(3, 9);
  });

  test("I-kind behaves like a controlled current source", () => {
    // B1 pushes I = 2·v(in) A into node out; R = 1 Ω load → v(out) = 2·v(in).
    const c = circuit([
      { type: "V", name: "Vin", n: ["in", "0"], dc: 2 },
      { type: "B", name: "B1", n: ["out", "0"], kind: "I", expr: "2*v(in)" },
      { type: "R", name: "R1", n: ["out", "0"], value: 1 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(4, 9);
  });

  test("nonlinear expression (square law) converges and matches the solve", () => {
    // v(out) = v(out)² / 10 + 0.1 → roots: x² − 10x + 1 = 0 → x ≈ 0.10051…
    const c = circuit([
      { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "v(out)*v(out)/10 + 0.1" },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    const root = (10 - Math.sqrt(100 - 4)) / 2;
    expect(sig(r, "v(out)")).toBeCloseTo(root, 8);
  });

  test("current-sensing operand i(vsrc) works", () => {
    // i(V1) = −2 A (load current leaves the + terminal — ngspice sign).
    // B pushes f = 2·i(V1) = −4 A out of node out → v(out) = +4 V.
    const c = circuit([
      { type: "V", name: "V1", n: ["a", "0"], dc: 2 },
      { type: "R", name: "R1", n: ["a", "0"], value: 1 },
      { type: "B", name: "B1", n: ["out", "0"], kind: "I", expr: "2*i(V1)" },
      { type: "R", name: "R2", n: ["out", "0"], value: 1 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(4, 8);
  });

  test("unknown operand or parameter reports E_PARSE with the element name", () => {
    const bad = circuit([
      { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "v(nowhere)" },
      { type: "R", name: "RL", n: ["out", "0"], value: 1e9 },
    ]);
    expect(() => runAnalysis(compile(bad), { kind: "op" })).toThrow(/nowhere/);
    const badParam = circuit([
      { type: "B", name: "B2", n: ["out", "0"], kind: "V", expr: "missing*2" },
      { type: "R", name: "RL2", n: ["out", "0"], value: 1e9 },
    ]);
    expect(() => runAnalysis(compile(badParam), { kind: "op" })).toThrow(/missing/);
  });

  test("circuit parameters resolve inside B expressions", () => {
    const c = circuit(
      [
        { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "amp*1" },
        { type: "R", name: "R1", n: ["out", "0"], value: 1e9 },
      ],
      { params: { amp: 7.5 } },
    );
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(7.5, 9);
  });
});

describe("B sources — AC linearization", () => {
  test("V-kind linear gain matches an equivalent E source", () => {
    // B with v(out) = 3*v(in): AC gain is exactly 3 at any frequency.
    const mk = (type: "B" | "E"): Circuit =>
      circuit([
        { type: "V", name: "Vin", n: ["in", "0"], dc: 0, ac: { mag: 1 } },
        type === "B"
          ? { type: "B", name: "X1", n: ["out", "0"], kind: "V", expr: "3*v(in)" }
          : ({ type: "E", name: "X1", n: ["out", "0", "in", "0"], gain: 3 } as Element),
        { type: "R", name: "RL", n: ["out", "0"], value: 1e6 },
      ]);
    const bRun = runAnalysis(compile(mk("B")), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    const eRun = runAnalysis(compile(mk("E")), {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 1000,
      fstop: 1000,
    });
    expect(sig(bRun, "vm(out)")).toBeCloseTo(3, 9);
    expect(sig(bRun, "vm(out)")).toBeCloseTo(sig(eRun, "vm(out)"), 9);
  });

  test("nonlinear B linearizes to the derivative at the bias point", () => {
    // f = 1 − (v−1)² has the exact root v = 0 (reached from x = 0);
    // ∂f/∂v = −2(v−1) = 2 at the root. Closed loop: v = 2v + vac →
    // |v| = |vac| with phase 180°.
    const c = circuit([
      { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "1 - (v(out) - 1)^2" },
      { type: "R", name: "RL", n: ["out", "0"], value: 1e9 },
    ]);
    const compiled = compile(c);
    const op = runAnalysis(compiled, { kind: "op" });
    expect(sig(op, "v(out)")).toBeCloseTo(0, 6);
    const r = runAnalysis(compiled, {
      kind: "ac",
      sweep: "lin",
      points: 1,
      fstart: 100,
      fstop: 100,
    });
    expect(sig(r, "vm(out)")).toBeCloseTo(1, 6);
    expect(Math.abs(Math.abs(sig(r, "vp(out)")) - 180)).toBeLessThan(1e-4);
  });
});

describe("B sources — transient", () => {
  test("sine drive through an RC matches the analytic low-pass", () => {
    // B drives v(in) = sin(2π·1000·t);  RC = 1k/1µF. ωRC = 2π →
    // |H| = 1/√(1+4π²) ≈ 0.1572. Simulate 10 cycles and measure the peak of
    // the final full cycle (startup transient decayed by e⁻⁹).
    const c = circuit([
      { type: "B", name: "B1", n: ["in", "0"], kind: "V", expr: "sin(2*pi*1000*time)" },
      { type: "R", name: "R1", n: ["in", "out"], value: 1000 },
      { type: "C", name: "C1", n: ["out", "0"], value: 1e-6 },
    ]);
    const r = runAnalysis(compile(c), {
      kind: "tran",
      tstep: 1e-5,
      tstop: 1e-2,
    });
    const w = 2 * Math.PI * 1000;
    const expected = 1 / Math.sqrt(1 + (w * 1e3 * 1e-6) ** 2);
    let peak = 0;
    const n = r.axis.length;
    for (let i = Math.floor((9 * n) / 10); i < n; i++) {
      peak = Math.max(peak, Math.abs(sig(r, "v(out)", i)));
    }
    expect(peak).toBeCloseTo(expected, 3);
  });
});

describe("B sources — netlist cards", () => {
  test("all three card spellings parse to the same IR", () => {
    const forms = ["B1 out 0 V = 2*v(a)", "B1 out 0 V 2*v(a)", "B1 out 0 V=2*v(a)"];
    for (const form of forms) {
      const ir = parseNetlist(`B card test\n${form}\n.end\n`);
      expect(ir.elements[0]).toEqual({
        type: "B",
        name: "B1",
        n: ["out", "0"],
        kind: "V",
        expr: "2*v(a)",
      });
    }
  });

  test("table() with whitespace-separated args survives the lexer", () => {
    const ir = parseNetlist("B table test\nB1 out 0 V = table(v(a) 0 0 1 10 2 25)\n.end\n");
    const el = ir.elements[0];
    expect(el.type === "B" && el.expr).toBe("table(v(a) 0 0 1 10 2 25)");
    // And it simulates: table at v(a) = 1.5 → 17.5 (midpoint of 10..25).
    const c = circuit([
      { type: "V", name: "Va", n: ["a", "0"], dc: 1.5 },
      { type: "B", name: "B1", n: ["out", "0"], kind: "V", expr: "table(v(a) 0 0 1 10 2 25)" },
      { type: "R", name: "R1", n: ["out", "0"], value: 1e9 },
    ]);
    const r = runAnalysis(compile(c), { kind: "op" });
    expect(sig(r, "v(out)")).toBeCloseTo(17.5, 9);
  });
});
