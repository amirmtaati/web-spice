/**
 * UX3-T8 export tests: CSV format (header comment, full-precision values,
 * NaN → empty), filename sanitization. PNG byte validation runs in the
 * browser e2e (canvas.toBlob is a browser API).
 */
import { describe, expect, test } from "bun:test";
import { csvString, sanitizeFilename } from "./export.ts";

describe("csvString", () => {
  test("header is a #-comment with names and units", () => {
    const csv = csvString(
      Float64Array.from([0, 1e-3]),
      [{ name: "v(out)", unit: "V", values: Float64Array.from([0, 3.16]) }],
      "s",
    );
    const [header] = csv.split("\n");
    expect(header).toBe("# axis (s),v(out) (V)");
  });

  test("rows carry full float precision; NaN → empty cell", () => {
    const csv = csvString(
      Float64Array.from([0, 1]),
      [{ name: "i", unit: "A", values: Float64Array.from([0.0025, Number.NaN]) }],
      "",
    );
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("0,0.0025");
    expect(lines[2]).toBe("1,");
  });

  test("shorter signal column pads as empty", () => {
    const csv = csvString(
      Float64Array.from([0, 1, 2]),
      [{ name: "x", unit: "", values: Float64Array.from([7]) }],
      "s",
    );
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe("0,7");
    expect(lines[2]).toBe("1,");
    expect(lines[3]).toBe("2,");
  });

  test("round-trips through float parsing bit-exactly", () => {
    const v = 3.160696769839486;
    const csv = csvString(
      Float64Array.from([0]),
      [{ name: "v", unit: "V", values: Float64Array.from([v]) }],
      "s",
    );
    const cell = csv.trim().split("\n")[1]?.split(",")[1];
    expect(Number(cell)).toBe(v);
  });
});

describe("sanitizeFilename", () => {
  test("strips separators and trims", () => {
    expect(sanitizeFilename("scope run: 1/2?.csv")).toBe("scope_run_1_2_.csv");
    expect(sanitizeFilename("///")).toBe("export");
    expect(sanitizeFilename("bode.png")).toBe("bode.png");
  });
});
