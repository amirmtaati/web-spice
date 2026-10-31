/** Library validation (UX1-T6): the validator is green over the whole library. */
import { describe, expect, it } from "bun:test";
import { LIBRARY_CATEGORIES, SYMBOL_LIBRARY, searchLibrary, symbolById } from "./index.ts";
import { validateLibrary } from "./validate.ts";

describe("symbol library", () => {
  it("ships at least 60 symbol definitions (master §9.6)", () => {
    expect(SYMBOL_LIBRARY.length).toBeGreaterThanOrEqual(60);
  });

  it("covers every required category", () => {
    for (const c of [
      "Passive",
      "Sources",
      "Diodes",
      "Transistors",
      "ICs",
      "Switches",
      "Power",
      "Annotations",
    ]) {
      expect(LIBRARY_CATEGORIES).toContain(c);
    }
  });

  it("has unique ids", () => {
    const ids = new Set(SYMBOL_LIBRARY.map((d) => d.id));
    expect(ids.size).toBe(SYMBOL_LIBRARY.length);
  });

  it("validates clean over the whole library", () => {
    const issues = validateLibrary();
    expect(issues).toEqual([]);
  });

  it("defines ANSI + IEC graphics for the core passives", () => {
    for (const id of ["R", "C", "L"]) {
      const d = symbolById(id);
      expect(d?.standards.ansi.shapes.length).toBeGreaterThan(0);
      expect(d?.standards.iec).toBeDefined();
    }
  });

  it("grounds via a dedicated port with netAlias", () => {
    const gnd = symbolById("GND");
    expect(gnd?.spice.netAlias).toBe("{net}");
    expect(gnd?.pins[0]?.etype).toBe("power-out");
  });

  it("search matches names, keywords, and default values", () => {
    expect(searchLibrary("resistor").map((d) => d.id)).toContain("R");
    expect(searchLibrary("1N4148").length).toBe(0); // model names are not keywords
    expect(searchLibrary("wiper").map((d) => d.id)).toContain("R_POT");
    expect(searchLibrary("").length).toBe(SYMBOL_LIBRARY.length);
  });
});
