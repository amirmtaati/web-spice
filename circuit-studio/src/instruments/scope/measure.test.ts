/**
 * UX3-T4 measurement suite tests: every readout is checked against a
 * synthetic waveform with an exact analytic value (sine, square, ramp,
 * piecewise step) — "values exact on fixtures" is the acceptance gate.
 */
import { describe, expect, test } from "bun:test";
import {
  amplitude,
  duty,
  fallTime,
  frequency,
  measureAll,
  overshoot,
  period,
  riseTime,
} from "./measure.ts";

const DT = 1e-6;

/** 1 kHz sine, amplitude 1 V, N samples. */
function sine(f: number, n: number, a = 1, phase = 0): Float64Array {
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    y[k] = a * Math.sin(2 * Math.PI * f * k * DT + phase);
  }
  return y;
}

function rampAxis(n: number): Float64Array {
  const x = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    x[k] = k * DT;
  }
  return x;
}

describe("amplitude", () => {
  test("sine: Vpp = 2A, Vavg = 0, Vrms = A/√2", () => {
    const n = 5000; // 5 cycles
    const y = sine(1e3, n);
    const s = amplitude(y, 0, n);
    expect(s.vpp).toBeCloseTo(2, 2);
    expect(s.avg).toBeCloseTo(0, 3);
    expect(s.rms).toBeCloseTo(1 / Math.SQRT2, 3);
    expect(s.max).toBeCloseTo(1, 3);
    expect(s.min).toBeCloseTo(-1, 3);
  });

  test("DC: Vrms = Vavg = V", () => {
    const y = new Float64Array(100).fill(2.5);
    const s = amplitude(y, 0, 100);
    expect(s.avg).toBe(2.5);
    expect(s.rms).toBe(2.5);
    expect(s.vpp).toBe(0);
  });

  test("empty window is all-NaN (legend renders —)", () => {
    const s = amplitude(new Float64Array(0), 0, 0);
    expect(Number.isNaN(s.vpp)).toBe(true);
  });
});

describe("frequency / period", () => {
  test("1 kHz sine → f = 1000 Hz ±0.1 %", () => {
    const n = 5000;
    const y = sine(1e3, n);
    const x = rampAxis(n);
    const f = frequency(x, y, 0, n);
    expect(Math.abs(f - 1e3) / 1e3).toBeLessThan(1e-3);
    expect(period(x, y, 0, n)).toBeCloseTo(1e-3, 6);
  });

  test("3.7 kHz (non-integer cycles) stays within 0.5 %", () => {
    const n = 2740; // ~10 cycles of 3.65 kHz
    const y = sine(3650, n);
    const x = rampAxis(n);
    const f = frequency(x, y, 0, n);
    expect(Math.abs(f - 3650) / 3650).toBeLessThan(0.005);
  });

  test("DC / single edge → NaN", () => {
    const x = rampAxis(100);
    expect(Number.isNaN(frequency(x, new Float64Array(100).fill(1), 0, 100))).toBe(true);
  });
});

describe("duty", () => {
  test("50 % square → 50 % ±0.5", () => {
    // 1 kHz square, 0…1 V, 5000 samples (5 cycles, 1000 samples/cycle).
    const n = 5000;
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = k % 1000 < 500 ? 1 : 0;
    }
    const x = rampAxis(n);
    expect(duty(x, y, 0, n)).toBeCloseTo(50, 1);
  });

  test("30 % pulse train", () => {
    const n = 10000;
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = k % 1000 < 300 ? 1 : 0;
    }
    const x = rampAxis(n);
    expect(duty(x, y, 0, n)).toBeCloseTo(30, 1);
  });
});

describe("rise / fall time", () => {
  test("linear ramp 0→1 over 1 ms: rise = 0.8 ms (10–90 %)", () => {
    const n = 100;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = k / (n - 1);
      x[k] = k * 1e-5; // 100 samples over 1 ms
    }
    const rt = riseTime(x, y, 0, n);
    // 10 %/90 % land between samples (100-sample grid) — 1 % quantization.
    expect(rt).toBeCloseTo(0.8e-3, 4);
  });

  test("symmetric triangle: fall = rise", () => {
    const n = 200;
    const y = new Float64Array(n);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = k < n / 2 ? (2 * k) / n : 2 - (2 * k) / n;
      x[k] = k * 1e-5;
    }
    const rt = riseTime(x, y, 0, n / 2);
    const ft = fallTime(x, y, n / 2, n);
    expect(ft).toBeCloseTo(rt, 6);
  });
});

describe("overshoot", () => {
  test("piecewise underdamped step: 25 % peak", () => {
    // 0 → peak 1.25 → settles at 1.0.
    const y = Float64Array.from([
      0, 0, 0, 0, 0.9, 1.2, 1.25, 1.15, 1.05, 1.01, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    ]);
    expect(overshoot(y, 0, y.length)).toBeCloseTo(25, 1);
  });

  test("monotone step → ≈ 0", () => {
    const y = Float64Array.from([
      0, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.99, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    ]);
    expect(Math.abs(overshoot(y, 0, y.length))).toBeLessThan(1.5);
  });
});

describe("measureAll", () => {
  test("sine row carries coherent readouts", () => {
    const n = 5000;
    const y = sine(1e3, n);
    const x = rampAxis(n);
    const row = measureAll(x, y, 0, n);
    expect(row.vpp).toBeCloseTo(2, 2);
    expect(row.freq).toBeCloseTo(1e3, 0);
    expect(row.vrms).toBeCloseTo(1 / Math.SQRT2, 2);
    expect(row.duty).toBeCloseTo(50, 1);
    // Rise (10–90 % of a sine quarter wave): analytic ≈ (asin(0.8)+π/2)/2π /f … sanity only.
    expect(row.rise).toBeGreaterThan(0);
    expect(row.rise).toBeLessThan(5e-4);
  });
});
