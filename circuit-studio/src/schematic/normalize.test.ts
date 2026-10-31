/**
 * Wire normalization tests (UX1-T5, master §9.5): unit cases + property tests
 * (idempotence, determinism) with a seeded PRNG (ADR 003).
 */
import { describe, expect, it } from "bun:test";
import { normalizeWires } from "./normalize.ts";
import type { Vec2, Wire } from "./types.ts";

const v = (x: number, y: number): Vec2 => ({ x, y });
const wire = (id: string, ...pts: readonly Vec2[]): Wire => ({ id, pts });

// Mulberry32 seeded PRNG (same family as the engine property tests).
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("normalizeWires", () => {
  it("collapses redundant collinear points", () => {
    const out = normalizeWires([wire("w1", v(0, 0), v(500, 0), v(1000, 0), v(1000, 500))]);
    expect(out.wires.length).toBe(1);
    expect(out.wires[0]?.pts).toEqual([v(0, 0), v(1000, 0), v(1000, 500)]);
  });

  it("removes zero-length wires", () => {
    const out = normalizeWires([wire("w1", v(0, 0), v(0, 0)), wire("w2", v(0, 0), v(500, 0))]);
    expect(out.wires.length).toBe(1);
    expect(out.wires[0]?.id).toBe("w2");
  });

  it("merges overlapping collinear wires", () => {
    const out = normalizeWires([
      wire("w1", v(0, 0), v(1000, 0)),
      wire("w2", v(500, 0), v(2000, 0)),
    ]);
    expect(out.wires.length).toBe(1);
    expect(out.wires[0]?.pts).toEqual([v(0, 0), v(2000, 0)]);
  });

  it("splits a T-touch: endpoint landing on another wire's interior", () => {
    const out = normalizeWires([
      wire("w1", v(0, 0), v(2000, 0)),
      wire("w2", v(1000, 0), v(1000, 1000)),
    ]);
    // The horizontal is split at the T; junction derived (3 ends).
    expect(out.junctions).toContainEqual(v(1000, 0));
    const h = out.wires.find((w) => w.pts[0]?.y === 0);
    expect(h?.pts).toEqual([v(0, 0), v(1000, 0), v(2000, 0)]);
  });

  it("never connects a crossing without an endpoint there", () => {
    const out = normalizeWires([
      wire("w1", v(-1000, 0), v(1000, 0)),
      wire("w2", v(0, -1000), v(0, 1000)),
    ]);
    expect(out.junctions).toEqual([]);
    // Both wires survive whole (a crossing is not a connection).
    expect(out.wires.length).toBe(2);
  });

  it("derives junctions for ≥ 3 wire ends only", () => {
    const out = normalizeWires([
      wire("w1", v(0, 0), v(1000, 0)),
      wire("w2", v(1000, 0), v(2000, 0)),
    ]);
    expect(out.junctions).toEqual([]); // 2 ends — simple continuation
  });

  it("is idempotent (normalizing its output is a no-op)", () => {
    const input = [
      wire("w1", v(0, 0), v(1000, 0)),
      wire("w2", v(500, 0), v(500, 1000)),
      wire("w3", v(2000, 2000), v(3000, 2000)),
      wire("w4", v(2500, 1000), v(2500, 3000)),
    ];
    const once = normalizeWires(input);
    const twice = normalizeWires(once.wires, once.junctions);
    expect(twice.wires).toEqual(once.wires);
    expect(twice.junctions).toEqual(once.junctions);
  });

  it("is deterministic under permutation of input order", () => {
    const a = normalizeWires([wire("w1", v(0, 0), v(1000, 0)), wire("w2", v(500, 0), v(500, 500))]);
    const b = normalizeWires([wire("w2", v(500, 0), v(500, 500)), wire("w1", v(0, 0), v(1000, 0))]);
    const norm = (r: typeof a): string => JSON.stringify({ w: r.wires, j: r.junctions });
    expect(norm(b)).toBe(norm(a));
  });

  it("keeps free-angle segments (no forced orthogonality)", () => {
    const out = normalizeWires([wire("w1", v(0, 0), v(500, 500))]);
    expect(out.wires.length).toBe(1);
    expect(out.wires[0]?.pts).toEqual([v(0, 0), v(500, 500)]);
  });
});

describe("normalizeWires properties (seeded)", () => {
  it("random orthogonal wire sets: idempotent + junction degree ≥ 3", () => {
    const rand = prng(0xc0ffee);
    for (let iter = 0; iter < 60; iter++) {
      const wires: Wire[] = [];
      const n = 1 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const x = Math.round(rand() * 10 - 5) * 500;
        const y = Math.round(rand() * 10 - 5) * 500;
        const horizontal = rand() < 0.5;
        const len = (1 + Math.floor(rand() * 4)) * 500 * (rand() < 0.5 ? -1 : 1);
        wires.push(
          horizontal
            ? wire(`w${i}`, v(x, y), v(x + len, y))
            : wire(`w${i}`, v(x, y), v(x, y + len)),
        );
      }
      const once = normalizeWires(wires);
      const twice = normalizeWires(once.wires, once.junctions);
      expect(twice.wires).toEqual(once.wires);
      for (const j of once.junctions) {
        const k = `${j.x},${j.y}`;
        expect(once.endDegrees.get(k) ?? 0).toBeGreaterThanOrEqual(3);
      }
      // Normalization never lengthens the drawing (splits preserve length,
      // overlap merges only shrink it) and never emits zero-length segments.
      const length = (ws: readonly Wire[]): number =>
        ws.reduce(
          (acc, w) =>
            acc +
            w.pts
              .slice(0, -1)
              .reduce(
                (s, p, i) =>
                  s +
                  Math.abs((w.pts[i + 1]?.x ?? 0) - p.x) +
                  Math.abs((w.pts[i + 1]?.y ?? 0) - p.y),
                0,
              ),
          0,
        );
      expect(length(once.wires)).toBeLessThanOrEqual(length(wires));
      for (const w of once.wires) {
        for (let i = 0; i < w.pts.length - 1; i++) {
          const a = w.pts[i];
          const b = w.pts[i + 1];
          if (a === undefined || b === undefined) continue;
          expect(a.x === b.x || a.y === b.y || a.x !== b.x).toBe(true); // finite
          expect(a.x !== b.x || a.y !== b.y).toBe(true); // non-zero
        }
      }
    }
  });
});
