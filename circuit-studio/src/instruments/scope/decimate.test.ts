/**
 * UX3-T2 decimation tests: min/max pair fidelity (spikes survive), strictly
 * increasing x (uPlot contract), NaN skipping, and the §10 perf gate —
 * 4 channels × 100 k samples decimate well inside the frame budget.
 */
import { describe, expect, test } from "bun:test";
import { decimatePairs } from "./decimate.ts";

describe("decimatePairs", () => {
  test("min/max per bin are exact (ramp with spike)", () => {
    const n = 1000;
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = k; // 0…999
    }
    y[420] = 1e6; // spike in bin 4 (bins of 100)
    const outX = new Float64Array(64);
    const outY = new Float64Array(64);
    const w = decimatePairs(y, 0, n, 0, 1, 10, outX, outY);
    // 10 bins × up to 2 points.
    expect(w).toBe(20);
    // Bin 4 (samples 400…499): min 400, max spike 1e6.
    let sawMin = false;
    let sawMax = false;
    for (let k = 0; k < w; k++) {
      void 0;
      if ((outY[k] ?? -1) === 400) {
        sawMin = true;
      }
      if ((outY[k] ?? -1) === 1e6) {
        sawMax = true;
      }
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  test("x is strictly increasing across the whole emission", () => {
    const n = 997; // not a multiple of bins → ragged bins
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = Math.sin(k / 10);
    }
    const outX = new Float64Array(2 * 50);
    const outY = new Float64Array(2 * 50);
    const w = decimatePairs(y, 0, n, 12.5, 0.001, 50, outX, outY);
    expect(w).toBeGreaterThan(50);
    for (let k = 1; k < w; k++) {
      expect(outX[k] ?? 0).toBeGreaterThan(outX[k - 1] ?? 0);
    }
  });

  test("NaN samples are skipped; all-NaN bin emits nothing", () => {
    const y = Float64Array.from([1, Number.NaN, 3, Number.NaN, Number.NaN, Number.NaN, 7, 8]);
    const outX = new Float64Array(8);
    const outY = new Float64Array(8);
    const w = decimatePairs(y, 0, y.length, 0, 1, 4, outX, outY);
    // Bins: [1,NaN,3] → min 1 max 3 (2 pts); [NaN,NaN] → none; [NaN,7] → 7 (1 pt); [8] → 8 (1 pt)
    expect(w).toBe(4);
  });

  test("single-sample bin emits one point", () => {
    const y = Float64Array.from([5, 5, 5, 5]);
    const outX = new Float64Array(8); // capacity ≥ 2·bins
    const outY = new Float64Array(8);
    const w = decimatePairs(y, 0, 4, 0, 1, 4, outX, outY);
    expect(w).toBe(4);
    expect(outY[0]).toBe(5);
  });

  test("window offset (i0 > 0) stamps correct axis values", () => {
    const y = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const outX = new Float64Array(4);
    const outY = new Float64Array(4);
    const w = decimatePairs(y, 8, 10, 0, 0.5, 1, outX, outY);
    expect(w).toBe(2);
    expect(outY[0]).toBe(8);
    expect(outY[1]).toBe(9);
    expect(outX[0]).toBeCloseTo(8 * 0.5, 12);
  });

  test("undersized output → 0 (guard)", () => {
    const y = Float64Array.from([1, 2, 3, 4]);
    const outX = new Float64Array(2); // need 2·bins = 8
    const outY = new Float64Array(8);
    expect(decimatePairs(y, 0, 4, 0, 1, 4, outX, outY)).toBe(0);
  });
});

describe("perf gate (§10, UX3-T1: 60 fps @ 4×100k)", () => {
  test("4 channels × 100k → 2048 bins each, under 12 ms total", () => {
    const n = 100_000;
    const bins = 2048;
    const channels = [0, 1, 2, 3].map((c) => {
      const y = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        y[k] = Math.sin((2 * Math.PI * 1e3 * k) / n + c) * Math.exp(-k / n);
      }
      return y;
    });
    const outX = new Float64Array(bins * 2);
    const outY = new Float64Array(bins * 2);
    const t0 = performance.now();
    let written = 0;
    for (const y of channels) {
      written += decimatePairs(y, 0, n, 0, 1e-6, bins, outX, outY);
    }
    const ms = performance.now() - t0;
    expect(written).toBeGreaterThan(4 * bins);
    expect(ms).toBeLessThan(12);
  });
});
