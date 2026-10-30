/**
 * UX0-T3 gate: exhaustive unit tests for the formatters/parsers
 * (UI-UX-SPEC §4.1: "exhaustive unit tests (1e-15…1e12 round trip)").
 */
import { describe, expect, it } from "bun:test";
import {
  formatEng,
  formatSI,
  formatTime,
  formatUnit,
  parseEngineering,
  prettySignal,
  roundTrip,
  signalUnit,
} from "./format.ts";

const THIN = "\u2009";
const MINUS = "\u2212";

describe("formatEng", () => {
  it("formats the classic engineering cases", () => {
    expect(formatEng(4.7e3, "Ω")).toBe(`4.7${THIN}kΩ`);
    expect(formatEng(12, "V")).toBe(`12${THIN}V`);
    expect(formatEng(3.2e-3, "A")).toBe(`3.2${THIN}mA`);
    expect(formatEng(1.2e-3, "s")).toBe(`1.2${THIN}ms`);
    expect(formatEng(0)).toBe("0");
    expect(formatEng(0, "V")).toBe(`0${THIN}V`);
  });

  it("adapts precision to magnitude (3 significant digits)", () => {
    expect(formatEng(1234)).toBe(`1.23${THIN}k`);
    expect(formatEng(12_345)).toBe(`12.3${THIN}k`);
    expect(formatEng(123_456)).toBe(`123${THIN}k`);
    expect(formatEng(999_499)).toBe(`999${THIN}k`);
    expect(formatEng(999_500)).toBe(`1${THIN}M`); // rolls over the prefix
    expect(formatEng(1e-12)).toBe(`1${THIN}p`);
    expect(formatEng(-2.5e-9, "A")).toBe(`${MINUS}2.5${THIN}nA`);
  });

  it("keeps trailing zeros when asked (fixed-width readouts)", () => {
    expect(formatEng(12, "V", { trimZeros: false })).toBe(`12.0${THIN}V`);
    expect(formatEng(4.7e3, "Ω", { trimZeros: false })).toBe(`4.70${THIN}kΩ`);
    expect(formatEng(123_456, "", { trimZeros: false })).toBe(`123${THIN}k`);
  });

  it("renders non-finite values as an em-dash", () => {
    expect(formatEng(Number.NaN)).toBe("\u2014");
    expect(formatEng(Number.POSITIVE_INFINITY, "V")).toBe(`\u2014${THIN}V`);
  });

  it("covers the full SI range without garbage", () => {
    expect(formatEng(1e-30)).toBe(`1${THIN}q`);
    expect(formatEng(1e-27)).toBe(`1${THIN}r`);
    expect(formatEng(1e-24)).toBe(`1${THIN}y`);
    expect(formatEng(1e24)).toBe(`1${THIN}Y`);
    expect(formatEng(2.7e27)).toBe(`2.7${THIN}R`);
    expect(formatEng(1e30)).toBe(`1${THIN}Q`);
  });
});

describe("formatSI / formatUnit / formatTime", () => {
  it("formatSI: no unit", () => {
    expect(formatSI(1.2e6)).toBe(`1.2${THIN}M`);
    expect(formatSI(0.5)).toBe(`500${THIN}m`);
  });

  it("formatUnit: plain unit without prefix scaling", () => {
    expect(formatUnit(63.2, "%")).toBe(`63.2${THIN}%`);
    expect(formatUnit(0.632, "%")).toBe(`0.63${THIN}%`);
    expect(formatUnit(1234, "%")).toBe(`1234${THIN}%`);
  });

  it("formatTime: seconds axis", () => {
    expect(formatTime(0)).toBe(`0${THIN}s`);
    expect(formatTime(5e-3)).toBe(`5${THIN}ms`);
    expect(formatTime(2.5e-6)).toBe(`2.5${THIN}µs`);
  });
});

describe("parseEngineering", () => {
  it("parses SI-suffixed input", () => {
    expect(parseEngineering("4.7k")).toBeCloseTo(4700, 6);
    expect(parseEngineering("1.2 M")).toBeCloseTo(1.2e6, 3);
    expect(parseEngineering("3.3n")).toBeCloseTo(3.3e-9, 15);
    expect(parseEngineering("10u")).toBeCloseTo(1e-5, 12);
    expect(parseEngineering("2meg")).toBeCloseTo(2e6, 3);
    expect(parseEngineering("470")).toBe(470);
    expect(parseEngineering("-1.5m")).toBeCloseTo(-1.5e-3, 9);
    expect(parseEngineering("1e-3")).toBeCloseTo(1e-3, 9);
    expect(parseEngineering("3mil")).toBeCloseTo(3 * 25.4e-6, 12);
  });

  it("rejects garbage and unknown suffixes", () => {
    expect(parseEngineering("abc")).toBeNull();
    expect(parseEngineering("")).toBeNull();
    expect(parseEngineering("4.7x")).toBeNull();
    expect(parseEngineering("4.7 ohm")).toBeNull();
    expect(parseEngineering("1.2.3k")).toBeNull();
    expect(parseEngineering("--5")).toBeNull();
  });

  it("round-trips 1e-15 … 1e12 within 3-significant-digit accuracy", () => {
    for (let exp = -15; exp <= 12; exp++) {
      for (const mantissa of [1, 1.5, 2, 2.7, 3.3, 4.7, 6.8, 9.99]) {
        const value = mantissa * 10 ** exp;
        const back = roundTrip(value);
        if (back === null) {
          throw new Error(`round-trip failed for ${value}`);
        }
        const relative = Math.abs((back - value) / value);
        expect(relative).toBeLessThan(0.006); // 3 sig figs ⇒ ≤ 0.5% + epsilon
      }
    }
  });
});

describe("signal naming", () => {
  it("pretty-prints raw engine signal names", () => {
    expect(prettySignal("v(out)")).toBe("V(out)");
    expect(prettySignal("i(v1)")).toBe("I(V1)");
    expect(prettySignal("i(r1)")).toBe("I(R1)");
    expect(prettySignal("v(0)")).toBe("V(0)");
    expect(prettySignal("vm(out)")).toBe("V(out)");
    expect(prettySignal("vdb(out)")).toBe("V(out)");
    expect(prettySignal("vp(out)")).toBe("∠V(out)");
    expect(prettySignal("im(c1)")).toBe("I(C1)");
    expect(prettySignal("v(c1:1)")).toBe("V(C1:1)");
    expect(prettySignal("time")).toBe("time");
  });

  it("maps signal kinds to units", () => {
    expect(signalUnit("v(out)")).toBe("V");
    expect(signalUnit("i(r1)")).toBe("A");
    expect(signalUnit("vm(out)")).toBe("V");
    expect(signalUnit("vp(out)")).toBe("°");
    expect(signalUnit("vdb(out)")).toBe("dB");
    expect(signalUnit("transfer_function")).toBe("V/V");
    expect(signalUnit("mystery")).toBe("");
  });
});
