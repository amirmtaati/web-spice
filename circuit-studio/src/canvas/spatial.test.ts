/** Perf budget (master §17): hit-test < 0.5 ms at 5,000 objects. */
import { describe, expect, it } from "bun:test";
import type { SchematicDoc } from "../schematic/types.ts";
import { emptyDoc, type SymbolInstance } from "../schematic/types.ts";
import { SpatialIndex } from "./spatial.ts";

function bigDoc(): SchematicDoc {
  const symbols: SymbolInstance[] = [];
  const wires: { id: string; pts: { x: number; y: number }[] }[] = [];
  for (let i = 0; i < 1000; i++) {
    symbols.push({
      id: `s${i}`,
      defId: "R",
      x: (i % 40) * 4000,
      y: Math.floor(i / 40) * 4000,
      rot: 0 as const,
      mirrorX: false,
      fields: { reference: `R${i}` },
      props: {},
    });
  }
  for (let i = 0; i < 2000; i++) {
    const x = (i % 40) * 4000 + 2000;
    const y = Math.floor(i / 40) * 4000;
    wires.push({
      id: `w${i}`,
      pts: [
        { x, y },
        { x: x + 1500, y },
      ],
    });
  }
  return { ...emptyDoc("perf"), rev: 1, symbols, wires };
}

describe("spatial index perf (master §17)", () => {
  it("hit-test stays under 0.5 ms at ~5000 indexed objects", () => {
    const doc = bigDoc();
    const index = new SpatialIndex(doc);
    // Warm.
    index.hit({ x: 100, y: 100 }, 300);
    const t0 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) {
      index.hit({ x: (i % 40) * 4000 + 50, y: Math.floor(i / 40) * 4000 + 50 }, 300);
    }
    const perOp = (performance.now() - t0) / N;
    expect(perOp).toBeLessThan(0.5);
  });
});
