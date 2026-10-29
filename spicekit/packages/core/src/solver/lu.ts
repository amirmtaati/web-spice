/**
 * Dense LU factorization with partial pivoting (SPEC §5.4 stage 1).
 *
 * Operates on flat, preallocated `Float64Array`s — no allocation inside
 * factor/solve (SPEC §5.11). Pivots rows only (no column pivoting), which is
 * standard for MNA matrices. Singular detection reports the pivot row so the
 * compiler can name the likely offending node (SPEC §5.4).
 *
 * Layout: row-major, A[i*n + j]. Callers own all memory; we never resize.
 *
 * NOTE ON `!`: with `noUncheckedIndexedAccess`, typed-array reads are
 * `number | undefined`. Every index in this file is provably in-bounds by
 * loop construction (0 <= i < n, 0 <= j < n), so reads are narrowed with the
 * non-null assertion — the one place `!` is allowed without shame.
 */

export interface LuFactors {
  /** n×n combined L (unit diagonal) and U, row-major, in place of the input. */
  a: Float64Array;
  /** Row permutation produced by partial pivoting: piv[i] = original row. */
  piv: Int32Array;
  /** true if factorization succeeded. */
  ok: boolean;
  /** When !ok: the column index whose pivot was (near) zero. */
  singularColumn: number;
}

/**
 * Factor A (n×n, row-major) in place into LU with partial pivoting.
 * `a` and `piv` must be preallocated by the caller (a.length >= n*n,
 * piv.length >= n). Returns the offending column index on exact singularity,
 * or -1 on success.
 */
export function luFactor(a: Float64Array, n: number, piv: Int32Array): number {
  for (let i = 0; i < n; i++) {
    piv[i] = i;
  }

  for (let k = 0; k < n; k++) {
    // Find the pivot row: largest |A[i][k]| for i in [k, n).
    let p = k;
    let max = Math.abs(a[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]!);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max === 0) {
      return k; // exactly singular
    }
    if (p !== k) {
      // Swap rows p and k (full row swap keeps L/U bookkeeping trivial).
      for (let j = 0; j < n; j++) {
        const tmp = a[k * n + j]!;
        a[k * n + j] = a[p * n + j]!;
        a[p * n + j] = tmp;
      }
      const tmpPiv = piv[k]!;
      piv[k] = piv[p]!;
      piv[p] = tmpPiv;
    }

    const pivot = a[k * n + k]!;
    for (let i = k + 1; i < n; i++) {
      const lik = a[i * n + k]! / pivot;
      a[i * n + k] = lik;
      if (lik !== 0) {
        for (let j = k + 1; j < n; j++) {
          a[i * n + j] = a[i * n + j]! - lik * a[k * n + j]!;
        }
      }
    }
  }
  return -1;
}

/**
 * Solve A x = b given LU factors. `b` is overwritten with the solution.
 * `scratch` (length >= n, caller-owned, preallocated) holds the permuted
 * right-hand side and intermediate values — no allocation inside (SPEC §5.11).
 */
export function luSolve(
  a: Float64Array,
  n: number,
  piv: Int32Array,
  b: Float64Array,
  scratch: Float64Array,
): void {
  // Permute: z = P b.
  for (let i = 0; i < n; i++) {
    scratch[i] = b[piv[i]!]!;
  }
  // Forward substitution: L y = z (L unit diagonal).
  for (let i = 0; i < n; i++) {
    let sum = scratch[i]!;
    for (let j = 0; j < i; j++) {
      sum -= a[i * n + j]! * scratch[j]!;
    }
    scratch[i] = sum;
  }
  // Back substitution: U x = y.
  for (let i = n - 1; i >= 0; i--) {
    let sum = scratch[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= a[i * n + j]! * scratch[j]!;
    }
    scratch[i] = sum / a[i * n + i]!;
  }
  for (let i = 0; i < n; i++) {
    b[i] = scratch[i]!;
  }
}
