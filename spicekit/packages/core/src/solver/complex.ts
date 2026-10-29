/**
 * Complex dense LU factorization with partial pivoting (SPEC §5.4 stage for
 * AC, E3 §22): the small-signal MNA matrix is complex (jωC admittances,
 * complex source phasors), so `.ac`/`.noise` solve A(f)·x = b per frequency.
 *
 * Layout: interleaved real/imaginary pairs on flat, preallocated
 * `Float64Array`s — z[i*n+j] occupies entries 2·(i·n+j) (real) and
 * 2·(i·n+j)+1 (imaginary). No allocation inside factor/solve (SPEC §5.11);
 * callers own all memory. Pivoting is partial (rows only), by squared
 * magnitude |z|² = re² + im², which is the complex analogue of |z| and avoids
 * a square root per comparison.
 *
 * The complex workspace never aliases the real one: AC keeps the DC operating
 * point in `Workspace.x` while complex solutions live in their own buffers.
 *
 * NOTE ON `!`: with `noUncheckedIndexedAccess`, typed-array reads are
 * `number | undefined`. Every index here is provably in-bounds by loop
 * construction (0 <= i < n, 0 <= j < n), so reads are narrowed with `!` —
 * the same exemption as solver/lu.ts (see biome override).
 */

/**
 * Factor A (n×n complex, interleaved) in place into LU with partial
 * pivoting. Returns the offending column index on exact singularity, or
 * -1 on success. `a` needs length >= 2·n·n; `piv` length >= n.
 */
export function luFactorC(a: Float64Array, n: number, piv: Int32Array): number {
  for (let i = 0; i < n; i++) {
    piv[i] = i;
  }

  for (let k = 0; k < n; k++) {
    // Find the pivot row: largest |A[i][k]| for i in [k, n).
    let p = k;
    const pr0 = a[2 * (k * n + k)] as number;
    const pi0 = a[2 * (k * n + k) + 1] as number;
    let max = pr0 * pr0 + pi0 * pi0;
    for (let i = k + 1; i < n; i++) {
      const vr = a[2 * (i * n + k)] as number;
      const vi = a[2 * (i * n + k) + 1] as number;
      const mag = vr * vr + vi * vi;
      if (mag > max) {
        max = mag;
        p = i;
      }
    }
    if (max === 0) {
      return k; // exactly singular
    }
    if (p !== k) {
      // Swap rows p and k (full row swap keeps L/U bookkeeping trivial).
      for (let j = 0; j < n; j++) {
        const kr = 2 * (k * n + j);
        const kp = 2 * (p * n + j);
        const tr = a[kr] as number;
        const ti = a[kr + 1] as number;
        a[kr] = a[kp] as number;
        a[kr + 1] = a[kp + 1] as number;
        a[kp] = tr;
        a[kp + 1] = ti;
      }
      const tmpPiv = piv[k] as number;
      piv[k] = piv[p] as number;
      piv[p] = tmpPiv;
    }

    // Scale column: L[i][k] = A[i][k] / pivot (complex division).
    const kr = 2 * (k * n + k);
    const invPivot = 1 / max; // = 1 / |pivot|²
    for (let i = k + 1; i < n; i++) {
      const ir = 2 * (i * n + k);
      const vr = a[ir] as number;
      const vi = a[ir + 1] as number;
      const pr2 = a[kr] as number;
      const pi2 = a[kr + 1] as number;
      // (vr + j·vi) / (pr + j·pi) = (vr + j·vi)·(pr − j·pi) / |pivot|²
      const likR = (vr * pr2 + vi * pi2) * invPivot;
      const likI = (vi * pr2 - vr * pi2) * invPivot;
      a[ir] = likR;
      a[ir + 1] = likI;
      if (likR !== 0 || likI !== 0) {
        for (let j = k + 1; j < n; j++) {
          const ij = 2 * (i * n + j);
          const kj = 2 * (k * n + j);
          // A[i][j] -= lik · A[k][j]
          const ar = a[ij] as number;
          const ai = a[ij + 1] as number;
          const br = a[kj] as number;
          const bi = a[kj + 1] as number;
          a[ij] = ar - (likR * br - likI * bi);
          a[ij + 1] = ai - (likR * bi + likI * br);
        }
      }
    }
  }
  return -1;
}

/**
 * Solve A x = b given complex LU factors. `b` (interleaved, length >= 2n) is
 * overwritten with the solution. `scratch` (length >= 2n, caller-owned,
 * preallocated) holds the permuted right-hand side — no allocation inside.
 */
export function luSolveC(
  a: Float64Array,
  n: number,
  piv: Int32Array,
  b: Float64Array,
  scratch: Float64Array,
): void {
  // Permute: z = P b.
  for (let i = 0; i < n; i++) {
    const src = 2 * (piv[i] as number);
    scratch[2 * i] = b[src] as number;
    scratch[2 * i + 1] = b[src + 1] as number;
  }
  // Forward substitution: L y = z (L unit diagonal).
  for (let i = 0; i < n; i++) {
    let sr = scratch[2 * i] as number;
    let si = scratch[2 * i + 1] as number;
    for (let j = 0; j < i; j++) {
      const lr = a[2 * (i * n + j)] as number;
      const li = a[2 * (i * n + j) + 1] as number;
      const yr = scratch[2 * j] as number;
      const yi = scratch[2 * j + 1] as number;
      sr -= lr * yr - li * yi;
      si -= lr * yi + li * yr;
    }
    scratch[2 * i] = sr;
    scratch[2 * i + 1] = si;
  }
  // Back substitution: U x = y.
  for (let i = n - 1; i >= 0; i--) {
    let sr = scratch[2 * i] as number;
    let si = scratch[2 * i + 1] as number;
    for (let j = i + 1; j < n; j++) {
      const ur = a[2 * (i * n + j)] as number;
      const ui = a[2 * (i * n + j) + 1] as number;
      const xr = scratch[2 * j] as number;
      const xi = scratch[2 * j + 1] as number;
      sr -= ur * xr - ui * xi;
      si -= ur * xi + ui * xr;
    }
    const dr = a[2 * (i * n + i)] as number;
    const di = a[2 * (i * n + i) + 1] as number;
    const dd = dr * dr + di * di;
    const invD = 1 / dd;
    scratch[2 * i] = (sr * dr + si * di) * invD;
    scratch[2 * i + 1] = (si * dr - sr * di) * invD;
  }
  for (let i = 0; i < n; i++) {
    b[2 * i] = scratch[2 * i] as number;
    b[2 * i + 1] = scratch[2 * i + 1] as number;
  }
}
