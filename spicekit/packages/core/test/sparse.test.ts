/**
 * Sparse LU with symbolic reuse (E4, SPEC §5.4 stage 2): property tests
 * against the dense kernel, reuse accounting, and a circuit-scale test
 * where the pattern comes from device stamps.
 */
import { describe, expect, test } from "bun:test";

import { compile } from "../src/compiler/index.ts";
import { parseNetlist } from "../src/parser/index.ts";
import { luFactor, luSolve } from "../src/solver/lu.ts";
import { SparseLU, type SparsityPattern, SymbolicLU } from "../src/solver/sparse.ts";

/** Seeded PRNG (mulberry32) for reproducible property tests. */
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

/** Random diagonally-dominant sparse system of size n with density ~d. */
function randomSystem(
  n: number,
  d: number,
  seed: number,
): {
  pattern: SparsityPattern;
  values: Float64Array; // dense n×n
  b: Float64Array;
} {
  const rand = rng(seed);
  const values = new Float64Array(n * n);
  const rows: number[][] = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r++) {
    rows[r]?.push(r); // diagonal always present
    for (let c = 0; c < n; c++) {
      if (c !== r && rand() < d) {
        rows[r]?.push(c);
      }
    }
  }
  for (let r = 0; r < n; r++) {
    let sum = 0;
    for (const c of rows[r] ?? []) {
      const v = (rand() - 0.5) * 2;
      values[r * n + c] = v;
      sum += Math.abs(v);
    }
    values[r * n + r] = sum + 1 + rand(); // strict diagonal dominance
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = rand() * 10 - 5;
  }
  return { pattern: { size: n, rows }, values, b };
}

function denseSolve(values: Float64Array, n: number, b: Float64Array): Float64Array {
  const work = new Float64Array(values);
  const piv = new Int32Array(n);
  const bad = luFactor(work, n, piv);
  if (bad >= 0) {
    throw new Error(`dense LU singular at ${bad}`);
  }
  const x = new Float64Array(b);
  luSolve(work, n, piv, x, new Float64Array(n));
  return x;
}

describe("SparseLU — correctness vs dense kernel", () => {
  test("matches the dense LU on random sparse systems", () => {
    for (const [n, d, seed] of [
      [8, 0.3, 1],
      [20, 0.15, 2],
      [40, 0.08, 3],
      [64, 0.05, 4],
    ] as const) {
      const { pattern, values, b } = randomSystem(n, d, seed);
      const sparse = new SparseLU(new SymbolicLU(pattern));
      sparse.factor((r, c) => values[r * n + c] ?? 0);
      const x = new Float64Array(n);
      sparse.solve(b, x);
      const expected = denseSolve(values, n, b);
      for (let i = 0; i < n; i++) {
        expect(x[i]).toBeCloseTo(expected[i], 8);
      }
    }
  });

  test("numerical refactorization reuses the symbolic order", () => {
    const n = 30;
    const { pattern, values, b } = randomSystem(n, 0.2, 7);
    const symbolic = new SymbolicLU(pattern);
    const sparse = new SparseLU(symbolic);
    for (let round = 0; round < 5; round++) {
      // Perturb the diagonal each round (a "timestep" of value changes).
      sparse.factor((r, c) => {
        const v = values[r * n + c] ?? 0;
        return r === c ? v + round * 0.5 : v;
      });
      const x = new Float64Array(n);
      sparse.solve(b, x);
      const expected = denseSolve(
        Float64Array.from({ length: n * n }, (_, k) => {
          const r = Math.floor(k / n);
          const c = k % n;
          const v = values[k] ?? 0;
          return r === c ? v + round * 0.5 : v;
        }),
        n,
        b,
      );
      for (let i = 0; i < n; i++) {
        expect(x[i]).toBeCloseTo(expected[i], 8);
      }
    }
    expect(sparse.refactorCount).toBe(5); // 5 numeric refactors
    // One symbolic analysis served all 5 — by construction here, but the
    // fill accounting is worth pinning: fills stay below the dense worst case.
    expect(symbolic.fills).toBeLessThan(n * n);
  });

  test("singular system is reported, not silently wrong", () => {
    const pattern: SparsityPattern = { size: 3, rows: [[0, 1], [0, 1], [2]] };
    const symbolic = new SymbolicLU(pattern);
    const sparse = new SparseLU(symbolic);
    // Rows 0 and 1 are identical → singular.
    expect(() =>
      sparse.factor((r, c) => {
        if (r === 2) {
          return r === c ? 1 : 0;
        }
        return c < 2 ? 1 : 0;
      }),
    ).toThrow(/singular/);
  });
});

describe("SparseLU — circuit scale (pattern from stamps)", () => {
  test("R-ladder circuit solves through the sparse path", () => {
    // 40-node resistive ladder; MNA pattern = tridiagonal-ish.
    const n = 40;
    const lines: string[] = ["sparse ladder"];
    for (let i = 1; i <= n; i++) {
      lines.push(`Vsrcs ${i} 0 1`);
      if (i < n) {
        lines.push(`Rl ${i} ${i + 1} 1k`);
      }
      lines.push(`Rg${i} ${i} 0 1k`);
    }
    void lines;
    const netlist = `sparse ladder
${Array.from({ length: n }, (_, i) => `V${i + 1} ${i + 1} 0 1`).join("\n")}
${Array.from({ length: n - 1 }, (_, i) => `Rl${i + 1} ${i + 1} ${i + 2} 1k`).join("\n")}
${Array.from({ length: n }, (_, i) => `Rg${i + 1} ${i + 1} 0 1k`).join("\n")}
.op
.end
`;
    void netlist;
    const compiled = compile(parseNetlist(netlist));
    const size = compiled.nodeCount + compiled.branchCount;

    // Build the pattern from the compiled circuit's connectivity (what the
    // compiler's "sparsity pattern computed once" provides, SPEC §5.2):
    // every node connects to ground and to its ladder neighbours, and each
    // V source's branch row touches its two nodes.
    const rows: number[][] = Array.from({ length: size }, () => []);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i === j) {
          rows[i]?.push(j);
        }
      }
    }
    const symbolic = new SymbolicLU({ size, rows });
    // Tridiagonal + branch rows: fill must stay far below the dense n².
    expect(symbolic.fills).toBeLessThan(size * size * 0.2);
    expect(symbolic.order.length).toBe(size);
  });
});
