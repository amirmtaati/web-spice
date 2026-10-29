/**
 * Complex LU tests (E3 §22): known complex solutions, pivoting, singular
 * detection, consistency with the real solver on real inputs, an analytic
 * RC low-pass phasor, and a residual sweep over a random complex system.
 */

import { describe, expect, test } from "bun:test";

import { luFactorC, luSolveC } from "../src/solver/complex.ts";
import { luFactor, luSolve } from "../src/solver/lu.ts";

/** Pack an interleaved complex matrix from rows of [re, im] pairs. */
function packMatrix(rows: number[][][]): Float64Array {
  const n = rows.length;
  const out = new Float64Array(2 * n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const z = rows[i]?.[j];
      if (z === undefined) {
        continue;
      }
      out[2 * (i * n + j)] = z[0] ?? 0;
      out[2 * (i * n + j) + 1] = z[1] ?? 0;
    }
  }
  return out;
}

function packVec(values: number[][]): Float64Array {
  const out = new Float64Array(2 * values.length);
  for (let i = 0; i < values.length; i++) {
    const z = values[i];
    if (z === undefined) {
      continue;
    }
    out[2 * i] = z[0] ?? 0;
    out[2 * i + 1] = z[1] ?? 0;
  }
  return out;
}

function solveComplex(aRows: number[][][], bValues: number[][]): number[][] {
  const n = aRows.length;
  const a = packMatrix(aRows);
  const b = packVec(bValues);
  const piv = new Int32Array(n);
  const scratch = new Float64Array(2 * n);
  expect(luFactorC(a, n, piv)).toBe(-1);
  luSolveC(a, n, piv, b, scratch);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    out.push([b[2 * i] ?? 0, b[2 * i + 1] ?? 0]);
  }
  return out;
}

function solveSystemReal(aData: number[], bData: number[]): number[] {
  const n = bData.length;
  const a = new Float64Array(aData);
  const b = new Float64Array(bData);
  const piv = new Int32Array(n);
  const scratch = new Float64Array(n);
  expect(luFactor(a, n, piv)).toBe(-1);
  luSolve(a, n, piv, b, scratch);
  return Array.from(b);
}

describe("complex LU with partial pivoting", () => {
  test("2x2 real system agrees with the real solver", () => {
    // 2x + y = 3 ; x + 3y = 5 → x = 0.8, y = 1.4
    const real = solveSystemReal([2, 1, 1, 3], [3, 5]);
    const cx = solveComplex(
      [
        [
          [2, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [3, 0],
        ],
      ],
      [
        [3, 0],
        [5, 0],
      ],
    );
    expect(cx[0]?.[0]).toBeCloseTo(real[0] as number, 12);
    expect(cx[1]?.[0]).toBeCloseTo(real[1] as number, 12);
    expect(cx[0]?.[1]).toBeCloseTo(0, 12);
    expect(cx[1]?.[1]).toBeCloseTo(0, 12);
  });

  test("pure complex diagonal system solves exactly", () => {
    // j·x = 2 → x = −2j ; (1+j)·y = (1+j) → y = 1
    const x = solveComplex(
      [
        [
          [0, 1],
          [0, 0],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      ],
      [
        [2, 0],
        [1, 1],
      ],
    );
    expect(x[0]?.[0]).toBeCloseTo(0, 12);
    expect(x[0]?.[1]).toBeCloseTo(-2, 12);
    expect(x[1]?.[0]).toBeCloseTo(1, 12);
    expect(x[1]?.[1]).toBeCloseTo(0, 12);
  });

  test("system requiring row pivoting does not divide by ~zero", () => {
    // [[0, 1], [1, 1]] x = [2, 3] → y = 2, x = 1 (pivoting must swap rows)
    const x = solveComplex(
      [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [1, 0],
        ],
      ],
      [
        [2, 0],
        [3, 0],
      ],
    );
    expect(x[0]?.[0]).toBeCloseTo(1, 12);
    expect(x[1]?.[0]).toBeCloseTo(2, 12);
    expect(x[0]?.[1]).toBeCloseTo(0, 12);
    expect(x[1]?.[1]).toBeCloseTo(0, 12);
  });

  test("RC low-pass phasor matches the analytic transfer function", () => {
    // 1k ∥ 1µF to ground, driven by a 1 A current source (b = [1]).
    // A = [[Y + jωC]]. Analytic: v = R/(1 + jωRC).
    const r = 1e3;
    const c = 1e-6;
    const fc = 1 / (2 * Math.PI * r * c); // corner frequency
    const w = 2 * Math.PI * fc;
    const y = 1 / r;
    const a = new Float64Array([y, w * c]);
    const b = new Float64Array([1, 0]);
    const piv = new Int32Array(1);
    const scratch = new Float64Array(2);
    expect(luFactorC(a, 1, piv)).toBe(-1);
    luSolveC(a, 1, piv, b, scratch);
    // At the corner: v = (R/2)(1 − j) → real R/2, imag −R/2, |v| = R/√2.
    expect(b[0]).toBeCloseTo(r / 2, 9);
    expect(b[1]).toBeCloseTo(-r / 2, 9);
    expect(Math.hypot(b[0] as number, b[1] as number)).toBeCloseTo(r / Math.SQRT2, 9);
  });

  test("detects singular matrices and reports the offending column", () => {
    const piv = new Int32Array(2);
    // [[1, 0], [2, 0]]: second column is all zero → singular at k = 1
    const a1 = packMatrix([
      [
        [1, 0],
        [0, 0],
      ],
      [
        [2, 0],
        [0, 0],
      ],
    ]);
    expect(luFactorC(a1, 2, piv)).toBe(1);
    // [[2, 4], [1, 2]]: proportional rows → singular at k = 1
    const a2 = packMatrix([
      [
        [2, 0],
        [4, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    ]);
    expect(luFactorC(a2, 2, piv)).toBe(1);
  });

  test("residual ||Ax − b|| is tiny on a random 32x32 complex system", () => {
    const n = 32;
    const a = new Float64Array(2 * n * n);
    const aCopy = new Float64Array(2 * n * n);
    const xTrue = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const re = i === j ? n : Math.sin(i * 5.1 + j * 2.3);
        const im = i === j ? n * 0.5 : Math.cos(i * 1.9 + j * 3.7);
        a[2 * (i * n + j)] = re;
        a[2 * (i * n + j) + 1] = im;
      }
      xTrue[2 * i] = Math.cos(i * 1.3) * 2;
      xTrue[2 * i + 1] = Math.sin(i * 0.7) * 2;
    }
    aCopy.set(a);
    const b = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        const ar = aCopy[2 * (i * n + j)] as number;
        const ai = aCopy[2 * (i * n + j) + 1] as number;
        const xr = xTrue[2 * j] as number;
        const xi = xTrue[2 * j + 1] as number;
        sr += ar * xr - ai * xi;
        si += ar * xi + ai * xr;
      }
      b[2 * i] = sr;
      b[2 * i + 1] = si;
    }
    const piv = new Int32Array(n);
    const scratch = new Float64Array(2 * n);
    expect(luFactorC(a, n, piv)).toBe(-1);
    luSolveC(a, n, piv, b, scratch);
    for (let i = 0; i < 2 * n; i++) {
      expect(Math.abs((b[i] as number) - (xTrue[i] as number))).toBeLessThan(1e-9);
    }
  });
});
