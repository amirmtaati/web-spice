/**
 * Axis reconstruction tests (UX2-T2 done-when: "axis unit tests match
 * AGENTS.md §5.2 formulas").
 */
import { describe, expect, test } from "bun:test";
import { axisLabel, axisPointCount, buildAxis, describeAnalysis } from "./axis.ts";

describe("buildAxis — tran (uniform output grid)", () => {
  test("buffered: tstart + k·tstep", () => {
    const a = { kind: "tran", tstep: 0.001, tstop: 0.01 } as const;
    const x = buildAxis(a, 0, 5);
    expect([...x]).toEqual([0, 0.001, 0.002, 0.003, 0.004]);
  });
  test("explicit tstart seeds the grid", () => {
    const a = { kind: "tran", tstep: 0.5, tstop: 10, tstart: 2 } as const;
    const x = buildAxis(a, 2, 3);
    expect([...x]).toEqual([2, 2.5, 3]);
  });
  test("live chunk: tStart continues the same grid", () => {
    const a = { kind: "tran", tstep: 0.01, tstop: 1e9 } as const;
    const x = buildAxis(a, 0.5, 4);
    expect([...x]).toEqual([0.5, 0.51, 0.52, 0.53]);
  });
});

describe("buildAxis — dc (source value)", () => {
  test("start + k·step", () => {
    const a = { kind: "dc", source: "V1", start: -2, stop: 2, step: 0.5 } as const;
    const x = buildAxis(a, -2, 9);
    expect([...x]).toEqual([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
  });
});

describe("buildAxis — ac (dec/oct/lin)", () => {
  test("dec: fstart·10^(k/points)", () => {
    const a = { kind: "ac", sweep: "dec", points: 10, fstart: 1, fstop: 1e6 } as const;
    const x = buildAxis(a, 1, 21);
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[10]).toBeCloseTo(10, 9); // one decade after 10 points
    expect(x[20]).toBeCloseTo(100, 6);
  });
  test("dec live window: tStart seeds the continuation", () => {
    const a = { kind: "ac", sweep: "dec", points: 10, fstart: 1, fstop: 1e6 } as const;
    const x = buildAxis(a, 10, 3); // continue from the 10th point (1 decade)
    expect(x[0]).toBeCloseTo(10, 9);
    expect(x[1]).toBeCloseTo(10 * 10 ** 0.1, 9);
    expect(x[2]).toBeCloseTo(10 * 10 ** 0.2, 9);
  });
  test("oct: fstart·2^(k/points)", () => {
    const a = { kind: "ac", sweep: "oct", points: 6, fstart: 10, fstop: 320 } as const;
    const x = buildAxis(a, 10, 13);
    expect(x[0]).toBeCloseTo(10, 9);
    expect(x[6]).toBeCloseTo(20, 6);
    expect(x[12]).toBeCloseTo(40, 6);
  });
  test("lin: uniform between fstart and fstop", () => {
    const a = { kind: "ac", sweep: "lin", points: 5, fstart: 100, fstop: 200 } as const;
    const x = buildAxis(a, 100, 5);
    expect([...x]).toEqual([100, 125, 150, 175, 200]);
  });
  test("lin single point stays at fstart", () => {
    const a = { kind: "ac", sweep: "lin", points: 1, fstart: 50, fstop: 500 } as const;
    expect(buildAxis(a, 50, 1)[0]).toBe(50);
  });
});

describe("buildAxis — single-sample analyses", () => {
  test("op and tf are nominal zero", () => {
    expect([...buildAxis({ kind: "op" }, 0, 1)]).toEqual([0]);
    const tf = { kind: "tf", output: "v(out)", source: "V1" } as const;
    expect([...buildAxis(tf, 0, 3)]).toEqual([0, 0, 0]);
  });
});

describe("metadata helpers", () => {
  test("axisLabel per kind", () => {
    expect(axisLabel({ kind: "tran", tstep: 1, tstop: 2 })).toBe("time (s)");
    expect(axisLabel({ kind: "ac", sweep: "dec", points: 10, fstart: 1, fstop: 10 })).toBe(
      "frequency (Hz)",
    );
    expect(axisLabel({ kind: "dc", source: "V1", start: 0, stop: 1, step: 0.1 })).toBe("V1 (V)");
    expect(axisLabel({ kind: "op" })).toBe("point");
  });
  test("axisPointCount", () => {
    expect(axisPointCount({ kind: "tran", tstep: 1, tstop: 10 })).toBe(11);
    expect(axisPointCount({ kind: "ac", sweep: "dec", points: 51, fstart: 1, fstop: 1e6 })).toBe(
      51,
    );
    expect(axisPointCount({ kind: "op" })).toBe(1);
  });
  test("describeAnalysis is compact", () => {
    expect(describeAnalysis({ kind: "op" })).toBe("OP");
    expect(describeAnalysis({ kind: "tran", tstep: 1e-6, tstop: 0.01 })).toContain("Tran");
    expect(
      describeAnalysis({ kind: "ac", sweep: "dec", points: 20, fstart: 1, fstop: 1e6 }),
    ).toMatch(/^AC dec 20/);
  });
});
