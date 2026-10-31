/** ERC tests (UX1-T9, master §9.9). */
import { describe, expect, it } from "bun:test";
import { runErc } from "./erc.ts";
import type { SchematicDoc, SymbolInstance, Vec2, Wire } from "./types.ts";
import { emptyDoc } from "./types.ts";

const v = (x: number, y: number): Vec2 => ({ x, y });

let idc = 200;
function inst(
  defId: string,
  x: number,
  y: number,
  fields: Record<string, string> = {},
): SymbolInstance {
  idc += 1;
  return {
    id: `i${idc}`,
    defId,
    x,
    y,
    rot: 0,
    mirrorX: false,
    fields: { reference: `${defId}${idc}`, ...fields },
    props: {},
  };
}

function doc(symbols: readonly SymbolInstance[], wires: readonly Vec2[][] = []): SchematicDoc {
  return {
    ...emptyDoc("erc"),
    rev: 1,
    symbols,
    wires: wires.map((pts, i): Wire => ({ id: `w${i}`, pts })),
  };
}

describe("runErc", () => {
  it("flags missing ground on any non-empty sheet", () => {
    const issues = runErc(doc([inst("R", 0, 0)]));
    expect(issues.some((i) => i.rule === "missing-ground" && i.severity === "error")).toBe(true);
  });

  it("a wired R + V + grounds is clean", () => {
    const d = doc(
      [
        inst("V_DC", 0, 0),
        inst("R", 3000, 0),
        inst("GND", -1000, 2000, { net: "GND" }),
        inst("GND", 8000, 2000, { net: "GND" }),
      ],
      [
        [v(-1000, 0), v(-1000, 2000)],
        [v(1000, 0), v(2000, 0)],
        [v(4000, 0), v(5000, 0)],
        [v(4000, 0), v(4000, 2000)],
        [v(3000, 2000), v(4000, 2000)],
      ],
    );
    // V.n→R? R pins at (2000,0)/(4000,0) — V.n at (1000,0)→R.a(2000,0) OK;
    // R.b(4000,0)→ stub (5000,0) dangling; C absent. Expect only dangling-info.
    const issues = runErc(d);
    expect(issues.some((i) => i.rule === "missing-ground")).toBe(false);
    expect(issues.some((i) => i.rule === "duplicate-reference")).toBe(false);
  });

  it("detects duplicate references", () => {
    const a = inst("R", 0, 0, { reference: "R1" });
    const b = inst("R", 5000, 0, { reference: "R1" });
    const issues = runErc(doc([a, b]));
    const dup = issues.find((i) => i.rule === "duplicate-reference");
    expect(dup?.severity).toBe("error");
    expect(dup?.items.length).toBe(2);
  });

  it("detects unconnected pins but respects no-connect flags", () => {
    const r = inst("R", 0, 0);
    const d1 = { ...doc([r]), noConnects: [] };
    const issues1 = runErc(d1);
    expect(issues1.filter((i) => i.rule === "unconnected-pin").length).toBe(2);

    const nc = inst("OPAMP", 0, 0); // inp/inn/out
    const d2 = {
      ...doc([nc]),
      noConnects: [
        { id: "nc1", at: v(-1000, -500) },
        { id: "nc2", at: v(-1000, 500) },
        { id: "nc3", at: v(1000, 0) },
      ],
    };
    const issues2 = runErc(d2);
    expect(issues2.filter((i) => i.rule === "unconnected-pin").length).toBe(0);
  });

  it("detects output-to-output conflicts", () => {
    const a = inst("G_BUF", 0, 0);
    const b = inst("G_BUF", 6000, 0);
    const d = doc([a, b], [[v(1000, 0), v(7000, 0)]]);
    const issues = runErc(d);
    expect(issues.some((i) => i.rule === "output-conflict" && i.severity === "error")).toBe(true);
  });

  it("detects unanchored labels", () => {
    const d = {
      ...doc([inst("R", 0, 0)]),
      labels: [{ id: "l1", kind: "local" as const, text: "x", at: v(9000, 9000), rot: 0 as const }],
    };
    const issues = runErc(d);
    expect(issues.some((i) => i.rule === "unanchored-label")).toBe(true);
  });

  it("detects floating nets (single-pin nets)", () => {
    const d = doc([inst("R", 0, 0), inst("C", 4000, 0)], [[v(1000, 0), v(3000, 0)]]);
    const issues = runErc(d);
    expect(issues.filter((i) => i.rule === "unconnected-pin").length).toBe(2);
  });
});
