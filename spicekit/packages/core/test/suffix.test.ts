import { describe, expect, test } from "bun:test";
import { formatValue, parseValue, SuffixParseError } from "../src/parser/suffix.ts";

describe("parseValue", () => {
  test("plain numbers", () => {
    expect(parseValue("100")).toBe(100);
    expect(parseValue("1.5e3")).toBe(1500);
    expect(parseValue("-0.25")).toBe(-0.25);
  });

  test("engineering suffixes (case-insensitive)", () => {
    // Scaled products are not bit-exact in binary floats (e.g. 100 * 1e-9);
    // compare within 1e-12 relative — SPICE engines use doubles anyway.
    expect(parseValue("4.7k")).toBe(4700);
    expect(parseValue("100n")).toBeCloseTo(1e-7, 18);
    expect(parseValue("1meg")).toBe(1e6);
    expect(parseValue("2M")).toBeCloseTo(2e-3, 18); // SPICE: M == milli; MEG == mega
    expect(parseValue("33m")).toBeCloseTo(33e-3, 18);
    expect(parseValue("10u")).toBeCloseTo(10e-6, 18);
    expect(parseValue("2p")).toBeCloseTo(2e-12, 24);
    expect(parseValue("3f")).toBeCloseTo(3e-15, 27);
    expect(parseValue("5T")).toBe(5e12);
    expect(parseValue("1G")).toBe(1e9);
    expect(parseValue("25mil")).toBeCloseTo(25.4e-6 * 25, 12);
  });

  test("trailing units are ignored", () => {
    expect(parseValue("10kohm")).toBe(10000);
    expect(parseValue("47uF")).toBeCloseTo(47e-6, 18);
    expect(parseValue("1nH")).toBeCloseTo(1e-9, 21);
    expect(parseValue("5V")).toBe(5);
  });

  test("garbage throws SuffixParseError", () => {
    expect(() => parseValue("abc")).toThrow(SuffixParseError);
    expect(() => parseValue("")).toThrow(SuffixParseError);
    expect(() => parseValue("k10")).toThrow(SuffixParseError);
  });
});

describe("formatValue", () => {
  test("uses engineering suffixes", () => {
    expect(formatValue(4700)).toBe("4.7k");
    expect(formatValue(1e-7)).toBe("100n");
    expect(formatValue(1e6)).toBe("1MEG");
    expect(formatValue(0)).toBe("0");
    expect(formatValue(2.5)).toBe("2.5");
  });

  test("round-trips within 0.1% through parseValue", () => {
    const samples = [1e-14, 3.3e-9, 0.0047, 0.15, 12, 220, 4.7e3, 1e6, 3.3e8, 2.2e11];
    for (const v of samples) {
      const round = parseValue(formatValue(v));
      expect(Math.abs(round - v) / Math.abs(v)).toBeLessThan(1e-3);
    }
  });
});
