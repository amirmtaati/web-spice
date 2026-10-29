import { describe, expect, test } from "bun:test";
import { luFactor, luSolve } from "../src/solver/lu.ts";

function solveSystem(aData: number[], bData: number[]): number[] {
  const n = bData.length;
  const a = new Float64Array(aData);
  const b = new Float64Array(bData);
  const piv = new Int32Array(n);
  const scratch = new Float64Array(n);
  const singular = luFactor(a, n, piv);
  expect(singular).toBe(-1);
  luSolve(a, n, piv, b, scratch);
  return Array.from(b);
}

describe("dense LU with partial pivoting", () => {
  test("2x2 system", () => {
    // 2x + y = 3 ; x + 3y = 5  →  x = 0.8, y = 1.4
    expect(solveSystem([2, 1, 1, 3], [3, 5])).toEqual([0.8, 1.4]);
  });

  test("system requiring row pivoting does not divide by ~zero", () => {
    // [[0, 1], [1, 1]] x = [2, 3] → y = 2, x = 1 (pivoting must swap rows)
    expect(solveSystem([0, 1, 1, 1], [2, 3])).toEqual([1, 2]);
  });

  test("3x3 with known exact solution", () => {
    // A = [[4, -1, 0], [-1, 4, -1], [0, -1, 4]], b = A @ [1, 2, 3] = [2, 4, 10]
    const b = [2, 4, 10];
    const x = solveSystem([4, -1, 0, -1, 4, -1, 0, -1, 4], b);
    for (let i = 0; i < 3; i++) {
      expect(x[i]).toBeCloseTo(i + 1, 12);
    }
  });

  test("detects singular matrices and reports the offending column", () => {
    const a = new Float64Array([1, 2, 2, 4]);
    const piv = new Int32Array(2);
    expect(luFactor(a, 2, piv)).toBe(1); // second column dependent
  });

  test("residual ||Ax - b|| is tiny on a random 40x40 well-conditioned system", () => {
    const n = 40;
    const a = new Float64Array(n * n);
    const aCopy = new Float64Array(n * n);
    const xTrue = new Float64Array(n);
    // Diagonally dominant to guarantee conditioning.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        a[i * n + j] = i === j ? 0 : Math.sin(i * 7.3 + j * 1.7);
      }
      a[i * n + i] = n;
      xTrue[i] = Math.cos(i * 2.1) * 3;
    }
    aCopy.set(a);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += aCopy[i * n + j] * xTrue[j];
      }
      b[i] = sum;
    }
    const piv = new Int32Array(n);
    const scratch = new Float64Array(n);
    expect(luFactor(a, n, piv)).toBe(-1);
    luSolve(a, n, piv, b, scratch);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(b[i] - xTrue[i])).toBeLessThan(1e-9);
    }
  });
});
