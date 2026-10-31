/**
 * UX3-T6 Bode analysis tests: analytic 1st-order RC (−3 dB exactly at f₀),
 * bandpass peak detection, 0 dB crossover, and gain/phase margins on a
 * synthetic feedback loop fixture.
 */
import { describe, expect, test } from "bun:test";
import { bodeFeatures, magDbFrom, valueAt } from "./bode.ts";

/** 1st-order low-pass |H| = 1/√(1+(f/f₀)²), ∠H = −atan(f/f₀). */
function rcLowpass(f0: number, n = 400): { f: Float64Array; mag: Float64Array; ph: Float64Array } {
  const f = new Float64Array(n);
  const mag = new Float64Array(n);
  const ph = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    f[k] = 10 * 10 ** ((k / (n - 1)) * 6); // 10 Hz … 10 MHz log
    const r = (f[k] ?? 0) / f0;
    mag[k] = -10 * Math.log10(1 + r * r);
    ph[k] = (-Math.atan(r) * 180) / Math.PI;
  }
  return { f, mag, ph };
}

describe("bodeFeatures", () => {
  test("1st-order RC: −3 dB at f₀ (interpolated, ±1 %)", () => {
    const f0 = 1591.55; // 1/(2π·1k·100n)
    const { f, mag, ph } = rcLowpass(f0);
    const b = bodeFeatures(f, mag, ph);
    expect(b.peakDb).toBeCloseTo(0, 3);
    expect(b.minus3dB).not.toBeNull();
    expect((b.minus3dB ?? 0) / f0).toBeCloseTo(1, 2);
    // Unity crossover = peak (0 dB at DC) → first downward 0 dB crossing at f→∞:
    // magnitude never returns above; crossover stays null only if it never
    // touches 0 dB downward from above — here it starts AT 0 dB (not above),
    // so no strict crossing. That is the honest reading; the DC-anchored
    // crossover comes from peakDb. Phase margin needs a real crossover.
    expect(b.crossover).toBeNull();
    expect(b.phaseMargin).toBeNull();
    void ph;
  });

  test("0 dB crossover + phase margin on a −20 dB/dec leaky integrator", () => {
    // |H| = f₀/f, ∠H = −90°: crosses 0 dB at f₀ with PM = 90°.
    const f0 = 1e3;
    const n = 400;
    const f = new Float64Array(n);
    const mag = new Float64Array(n);
    const ph = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      f[k] = 10 ** ((k / (n - 1)) * 6);
      mag[k] = 20 * Math.log10(f0 / (f[k] ?? 1));
      ph[k] = -90;
    }
    const b = bodeFeatures(f, mag, ph);
    expect(b.crossover).not.toBeNull();
    expect((b.crossover ?? 0) / f0).toBeCloseTo(1, 1);
    expect(b.phaseMargin).toBeCloseTo(90, 1);
    // Phase never reaches −180° → infinite gain margin (null).
    expect(b.gainMargin).toBeNull();
  });

  test("gain margin at −180° on a delayed 2-pole loop", () => {
    const n = 600;
    const f = new Float64Array(n);
    const mag = new Float64Array(n);
    const ph = new Float64Array(n);
    // |H| = 100/(1+(f/1k)²)^...: pick |H| crosses 0 dB at 10k, phase −180° at 31.6k.
    for (let k = 0; k < n; k++) {
      f[k] = 10 ** ((k / (n - 1)) * 6);
      mag[k] = 40 - 40 * Math.log10((f[k] ?? 1) / 100); // 0 dB at f = 10k
      ph[k] = -90 - (90 * Math.log10((f[k] ?? 1) / 100)) / 2;
    }
    // Phase hits −180 exactly at f = 3162.3 (10^3.5), sloping 20°/dec.
    for (let k = 0; k < n; k++) {
      ph[k] = -180 - Math.log10((f[k] ?? 1) / 10 ** 3.5) * 20;
    }
    const b = bodeFeatures(f, mag, ph);
    expect(b.gainMargin).not.toBeNull();
    // At f = 3162.3: mag = 40 − 40·log10(31.6) ≈ 40 − 60 = −20 → GM = +20 dB.
    expect(b.gainMargin).toBeCloseTo(20, 1);
  });

  test("bandpass peak frequency detected", () => {
    const n = 500;
    const f = new Float64Array(n);
    const mag = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      f[k] = 10 ** (1 + (k / (n - 1)) * 4);
      const x = Math.log10((f[k] ?? 1) / 1e3);
      mag[k] = 6 - 40 * x * x; // peak 6 dB at 1 kHz
    }
    const b = bodeFeatures(f, mag);
    // Grid does not hit 1 kHz exactly (log axis): nearest point is 990.8 Hz.
    expect(Math.abs(b.peakFreq - 1e3) / 1e3).toBeLessThan(0.02);
    expect(b.peakDb).toBeCloseTo(6, 1);
  });
});

describe("helpers", () => {
  test("valueAt interpolates inside the axis, NaN outside", () => {
    const x = Float64Array.from([0, 1, 2, 3]);
    const y = Float64Array.from([0, 10, 20, 30]);
    expect(valueAt(x, y, 1.5)).toBe(15);
    expect(valueAt(x, y, 9)).toBeNaN();
  });

  test("magDbFrom prefers engine vdb, converts vm", () => {
    const vm = Float64Array.from([1, 0.1]);
    const db = magDbFrom("vm(out)", vm);
    expect(db?.[0]).toBeCloseTo(0, 12);
    expect(db?.[1]).toBeCloseTo(-20, 12);
    const direct = magDbFrom("vdb(out)", Float64Array.from([3.01]));
    expect(direct?.[0]).toBeCloseTo(3.01, 12);
    expect(magDbFrom("v(out)", vm)).toBeNull();
  });
});
