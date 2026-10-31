/**
 * UX3-T6 DSP tests: single-bin recovery (exact bin), amplitude accuracy
 * under windows, THD of a pure sine ≈ 0, THD of a clipped/harmonic signal
 * matches the analytic mix, and window leakage reduction.
 */
import { describe, expect, test } from "bun:test";
import { fftInPlace, nextPow2, peakBin, spectrum, thd, windowValue } from "./fft.ts";

const N = 4096;
const FS = 1e6;
const DT = 1 / FS;

function sineWave(f: number, amp: number, n = N, phase = 0): Float64Array {
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    y[k] = amp * Math.sin(2 * Math.PI * f * k * DT + phase);
  }
  return y;
}

describe("fft core", () => {
  test("nextPow2", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(1000)).toBe(1024);
    expect(nextPow2(4096)).toBe(4096);
  });

  test("impulse → flat spectrum", () => {
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < 8; k++) {
      expect(Math.hypot(re[k] ?? 0, im[k] ?? 0)).toBeCloseTo(1, 12);
    }
  });

  test("single-bin sine lands on the exact bin with unit amplitude (rect)", () => {
    const bin = 64;
    const f = bin * (FS / N);
    const y = sineWave(f, 1);
    const { mag } = spectrum(y, DT, "rect");
    expect(peakBin(mag)).toBe(bin);
    expect(mag[bin]).toBeCloseTo(1, 2);
  });
});

describe("spectrum + windows", () => {
  test("Hann preserves amplitude for an exact-bin sine", () => {
    const bin = 128;
    const f = bin * (FS / N);
    const y = sineWave(f, 0.5);
    const { mag } = spectrum(y, DT, "hann");
    expect(peakBin(mag)).toBe(bin);
    expect(mag[bin]).toBeCloseTo(0.5, 2);
  });

  test("off-bin sine: Hann sidelobe leakage beyond the main lobe", () => {
    const f = 100.5 * (FS / N); // half-bin offset
    const y = sineWave(f, 1);
    const { mag: rect } = spectrum(y, DT, "rect");
    const { mag: hann } = spectrum(y, DT, "hann");
    const peak = hann[peakBin(hann)];
    let rectRatio = 0;
    let hannRatio = 0;
    for (let k = 3; k < 40; k++) {
      // k ≥ 3 skips the 4-bin Hann main lobe — pure sidelobe leakage.
      const rk = Math.abs(rect[peakBin(rect) + k] ?? 0) / (rect[peakBin(rect)] ?? 1);
      const hk = Math.abs(hann[peakBin(hann) + k] ?? 0) / (peak ?? 1);
      rectRatio = Math.max(rectRatio, rk);
      hannRatio = Math.max(hannRatio, hk);
    }
    expect(hannRatio).toBeLessThan(rectRatio);
    expect(hannRatio).toBeLessThan(0.05); // Hann worst sidelobe ≈ −31 dB
  });

  test("windowValue endpoints: Hann is 0 at both ends", () => {
    expect(windowValue("hann", 0, 100)).toBeCloseTo(0, 12);
    expect(windowValue("hann", 99, 100)).toBeCloseTo(0, 10);
    expect(windowValue("rect", 50, 100)).toBe(1);
  });
});

describe("THD", () => {
  test("pure sine → THD ≈ 0", () => {
    const f = 64 * (FS / N);
    const { mag } = spectrum(sineWave(f, 1), DT, "rect");
    expect(thd(mag, 64)).toBeLessThan(0.5);
  });

  test("1 V fundamental + 0.1 V 2nd harmonic → THD = 10 % ±0.5", () => {
    const f = 64 * (FS / N);
    const y = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const t = k * DT;
      y[k] = Math.sin(2 * Math.PI * f * t) + 0.1 * Math.sin(2 * Math.PI * 2 * f * t);
    }
    const { mag } = spectrum(y, DT, "rect");
    expect(thd(mag, 64)).toBeCloseTo(10, 1);
  });

  test("missing fundamental → NaN", () => {
    const mag = new Float64Array(100);
    expect(Number.isNaN(thd(mag, 10))).toBe(true);
  });
});
