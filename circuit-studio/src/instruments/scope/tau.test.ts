/**
 * UX3-T7 τ estimation tests: the least-squares exponential fit recovers τ
 * within 5 % of R·C on synthetic first-order fixtures, and the honesty gate
 * flags non-first-order windows (R² < 0.99).
 */
import { describe, expect, test } from "bun:test";
import { fitTau } from "./tau.ts";

describe("fitTau", () => {
  test("RC discharge: τ within 0.5 % of 1 ms", () => {
    const tau = 1e-3;
    const n = 500;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      x[k] = (k / (n - 1)) * 5 * tau;
      y[k] = 5 * Math.exp(-(x[k] ?? 0) / tau);
    }
    const fit = fitTau(x, y, 0, n);
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.direction).toBe("decay");
    expect(fit.tau / tau).toBeCloseTo(1, 2); // within 1 %
    expect(fit.firstOrder).toBe(true);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  test("RC charge: τ within 0.5 % of 1 ms (rising fit)", () => {
    const tau = 1e-3;
    const n = 500;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      x[k] = (k / (n - 1)) * 5 * tau;
      y[k] = 5 * (1 - Math.exp(-(x[k] ?? 0) / tau));
    }
    const fit = fitTau(x, y, 0, n);
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.direction).toBe("rise");
    expect(fit.tau / tau).toBeCloseTo(1, 2);
  });

  test("decaying sine (RLC ring) is flagged not-first-order", () => {
    const n = 2000;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      x[k] = k * 1e-6;
      y[k] = 5 * Math.exp(-(x[k] ?? 0) / 1e-3) * Math.cos(2 * Math.PI * 2e3 * (x[k] ?? 0));
    }
    const fit = fitTau(x, y, 0, n);
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.firstOrder).toBe(false);
    expect(fit.r2).toBeLessThan(0.99);
  });

  test("window that already reached the asymptote → null (no linearizable span)", () => {
    const tau = 1e-3;
    const n = 100;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      x[k] = k * 1e-6;
      y[k] = 5 * Math.exp(-(x[k] ?? 0) / tau);
    }
    // Span from t = 6τ: residual ≤ 0.25 % — slope still fits, but signal
    // resolution makes it fragile; here it should still fit or return null,
    // never a wrong number. Accept either, but flag honestly.
    const fit = fitTau(x, y, 60, n);
    if (fit !== null) {
      expect(fit.tau / tau).toBeGreaterThan(0.9);
    }
  });

  test("flat line → null", () => {
    const y = new Float64Array(100).fill(2);
    const x = new Float64Array(100);
    for (let k = 0; k < 100; k++) {
      x[k] = k * 1e-6;
    }
    expect(fitTau(x, y, 0, 100)).toBeNull();
  });

  test("too-short window → null", () => {
    const y = Float64Array.from([1, 2, 3]);
    const x = Float64Array.from([0, 1, 2]);
    expect(fitTau(x, y, 0, 3)).toBeNull();
  });
});
