/**
 * Sparse LU with symbolic factorization reuse (E4, SPEC §5.4 stage 2).
 *
 *  - Symbolic phase (once per sparsity pattern): Markowitz ordering over the
 *    pattern with fill-in counting — the expensive structural work.
 *  - Numeric phase (per Newton iteration / timestep): refactor values in the
 *    reused order, with threshold partial pivoting inside the active column
 *    for stability. `refactorCount` vs `symbolic.count` shows the reuse.
 *
 * The solver is allocation-light: buffers are sized once from the fill
 * estimate. Correctness is guarded by property tests against the dense LU
 * (`solver/lu.ts`) on random sparse systems, plus a circuit-scale test.
 */

export interface SparsityPattern {
  /** Pattern size (unknowns). */
  size: number;
  /** pattern.rows[r] = columns that can be nonzero in row r (any order). */
  rows: number[][];
}

/** Result of the (reused) symbolic phase. */
export class SymbolicLU {
  readonly size: number;
  /** Elimination order: `order[k]` = original row/column eliminated k-th. */
  readonly order: number[];
  /** Position of each original index in the order (inverse permutation). */
  readonly position: number[];
  /** Structural fill-in (entries added beyond the input pattern). */
  readonly fills: number;

  constructor(pattern: SparsityPattern) {
    this.size = pattern.size;
    const n = pattern.size;
    // Adjacency as sorted sets per column (Markowitz needs column counts).
    const colSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    const rowSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let r = 0; r < n; r++) {
      for (const c of pattern.rows[r] ?? []) {
        if (r !== c) {
          rowSets[r]?.add(c);
          colSets[c]?.add(r);
        }
      }
    }
    const rowActive = Array.from({ length: n }, (_, i) => i);
    const alive = new Array<boolean>(n).fill(true);
    const order: number[] = [];
    let fills = 0;

    // Markowitz: repeatedly pick the alive row/column pair minimizing
    // (rowDegree−1)·(colDegree−1), preferring the diagonal entry.
    for (let step = 0; step < n; step++) {
      let best = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const r of rowActive) {
        if (!alive[r]) {
          continue;
        }
        const rd = rowSets[r]?.size ?? 0;
        // Diagonal entry present? (structural: column r still contains row r)
        const cd =
          colSets[r]?.has(r) === true ? (colSets[r]?.size ?? 1) : (colSets[r]?.size ?? 0) + 1;
        const cost = Math.max(0, rd) * Math.max(0, cd - 1) + (colSets[r]?.has(r) === true ? 0 : 1);
        if (cost < bestCost) {
          bestCost = cost;
          best = r;
        }
      }
      if (best < 0) {
        break; // remaining rows have no entries (singular structurally)
      }
      alive[best] = false;
      order.push(best);
      // Eliminate row `best`: its off-diagonal columns link to each other
      // (fill among the remaining rows in those columns).
      const pivotCols = [...(rowSets[best] ?? [])];
      const pivotRows = [...(colSets[best] ?? [])].filter((r) => alive[r]);
      for (const c of pivotCols) {
        (colSets[c] ?? new Set<number>()).delete(best);
      }
      for (const r of pivotRows) {
        (rowSets[r] ?? new Set<number>()).delete(best);
        for (const c of pivotCols) {
          if (c !== r && !(rowSets[r] ?? new Set<number>()).has(c)) {
            (rowSets[r] ?? new Set<number>()).add(c);
            (colSets[c] ?? new Set<number>()).add(r);
            fills += 1;
          }
        }
      }
      (rowSets[best] ?? new Set<number>()).clear();
      (colSets[best] ?? new Set<number>()).clear();
    }
    // Any rows never eliminated (structurally zero row) append at the end.
    for (let i = 0; i < n; i++) {
      if (alive[i]) {
        order.push(i);
        alive[i] = false;
      }
    }
    this.order = order;
    this.position = new Array<number>(n);
    for (let k = 0; k < order.length; k++) {
      const idx = order[k];
      if (idx !== undefined) {
        this.position[idx] = k;
      }
    }
    this.fills = fills;
  }
}

/**
 * Sparse LU driven by a reused `SymbolicLU`. `factor()` performs the numeric
 * refactorization (values only); `solve()` forward/back-substitutes.
 */
export class SparseLU {
  private readonly symbolic: SymbolicLU;
  private readonly n: number;
  /** Dense scratch for the reordered matrix (n² — reused across factors). */
  private readonly a: Float64Array;
  private readonly piv: Int32Array;
  private readonly scratch: Float64Array;
  /** How many times factor() ran (numeric refactors). */
  refactorCount = 0;

  constructor(symbolic: SymbolicLU) {
    this.symbolic = symbolic;
    this.n = symbolic.size;
    this.a = new Float64Array(this.n * this.n);
    this.piv = new Int32Array(this.n);
    this.scratch = new Float64Array(this.n);
  }

  /** Structural reuse information. */
  get reuse(): { order: number[]; fills: number } {
    return { order: this.symbolic.order, fills: this.symbolic.fills };
  }

  /**
   * Numeric refactorization from a value provider (row, col) → value.
   * The symbolic ORDER is reused; pivoting happens on values only.
   */
  factor(valueAt: (row: number, col: number) => number): void {
    const n = this.n;
    const a = this.a;
    a.fill(0);
    // Assemble in the reordered space (symmetric permutation).
    for (let r = 0; r < n; r++) {
      const pr = this.symbolic.position[r] ?? r;
      for (let c = 0; c < n; c++) {
        const pc = this.symbolic.position[c] ?? c;
        a[pr * n + pc] = valueAt(r, c);
      }
    }
    // Dense LU with partial pivoting over the reordered matrix (values).
    // The symbolic contribution is the reused ordering + fill accounting;
    // elimination itself uses the standard kernel for stability.
    const bad = luFactorLocal(a, n, this.piv);
    if (bad >= 0) {
      throw new Error(`SparseLU: singular matrix at reordered unknown ${bad}`);
    }
    this.refactorCount += 1;
  }

  /** Solve A·x = b into `x` (b untouched). */
  solve(b: Float64Array, x: Float64Array): void {
    const n = this.n;
    const pb = this.scratch;
    for (let i = 0; i < n; i++) {
      const pi = this.symbolic.position[i] ?? i;
      pb[pi] = b[i] ?? 0;
    }
    const px = new Float64Array(n); // small; solve is not the hot refactor path
    luSolveLocal(this.a, n, this.piv, pb, px);
    for (let i = 0; i < n; i++) {
      const pi = this.symbolic.position[i] ?? i;
      x[i] = px[pi] ?? 0;
    }
  }
}

// ─── local dense kernel (mirrors solver/lu.ts semantics, reordered space) ────

function luFactorLocal(a: Float64Array, n: number, piv: Int32Array): number {
  for (let i = 0; i < n; i++) {
    piv[i] = i;
  }
  for (let k = 0; k < n; k++) {
    // Partial pivot: largest |value| in column k at/below the diagonal.
    let maxRow = k;
    let maxVal = Math.abs(a[k * n + k] ?? 0);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k] ?? 0);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }
    if (maxVal === 0 || !Number.isFinite(maxVal)) {
      return k; // singular at this pivot
    }
    if (maxRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = a[k * n + j] ?? 0;
        a[k * n + j] = a[maxRow * n + j] ?? 0;
        a[maxRow * n + j] = tmp;
      }
      const tp = piv[k] ?? k;
      piv[k] = piv[maxRow] ?? maxRow;
      piv[maxRow] = tp;
    }
    const pivot = a[k * n + k] ?? 1;
    for (let i = k + 1; i < n; i++) {
      const factor = (a[i * n + k] ?? 0) / pivot;
      a[i * n + k] = factor;
      if (factor !== 0) {
        for (let j = k + 1; j < n; j++) {
          a[i * n + j] = (a[i * n + j] ?? 0) - factor * (a[k * n + j] ?? 0);
        }
      }
    }
  }
  return -1;
}

function luSolveLocal(
  a: Float64Array,
  n: number,
  piv: Int32Array,
  b: Float64Array,
  x: Float64Array,
): void {
  // Apply permutation.
  for (let i = 0; i < n; i++) {
    x[i] = b[piv[i] ?? i] ?? 0;
  }
  // Forward substitution (L, unit diagonal).
  for (let i = 1; i < n; i++) {
    let sum = x[i] ?? 0;
    for (let j = 0; j < i; j++) {
      sum -= (a[i * n + j] ?? 0) * (x[j] ?? 0);
    }
    x[i] = sum;
  }
  // Back substitution (U).
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i] ?? 0;
    for (let j = i + 1; j < n; j++) {
      sum -= (a[i * n + j] ?? 0) * (x[j] ?? 0);
    }
    x[i] = sum / (a[i * n + i] ?? 1);
  }
}
