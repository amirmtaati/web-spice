/**
 * UX3-T3 trigger engine tests: deterministic against recorded streams —
 * newest-crossing selection, edge direction, holdoff, and per-mode anchor
 * resolution (Auto free-run, Normal freeze, Single accepted).
 */
import { describe, expect, test } from "bun:test";
import { findTrigger, resolveAnchor, type TriggerConfig, triggerTime } from "./trigger.ts";

const DT = 1e-6;

/** 1 kHz sine sampled at 1 MHz — crossings (rise, y=0) at k ≈ 0, 1000, … */
function sine1k(n: number): Float64Array {
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    y[k] = Math.sin(2 * Math.PI * 1e3 * k * DT);
  }
  return y;
}

const RISE0: TriggerConfig = { level: 0, edge: "rise", holdoffSamples: 0 };

describe("findTrigger", () => {
  // sin(2π·1e3·k·1e-6) crosses zero (rising) between k=1000/2000/… where
  // sin(2π·k/1000) = −ε at the boundary → first sample fully ≥ 0 is k+1.
  test("newest rising crossing wins", () => {
    const y = sine1k(5000); // rising crossings at ≈ 1, 1001, 2001, 3001, 4001
    const i = findTrigger(y, RISE0, 1, 4999);
    expect(i).toBe(4001);
  });

  test("fall edge finds the descending crossing", () => {
    const y = sine1k(5000);
    const i = findTrigger(y, { level: 0, edge: "fall", holdoffSamples: 0 }, 1, 4999);
    expect(i).toBe(4501);
  });

  test("either edge alternates — newest is still the newest", () => {
    const y = sine1k(5000);
    const i = findTrigger(y, { level: 0, edge: "either", holdoffSamples: 0 }, 1, 4999);
    expect(i).toBe(4501);
  });

  test("level above the signal → no trigger (null)", () => {
    const y = sine1k(5000);
    expect(findTrigger(y, { level: 2, edge: "rise", holdoffSamples: 0 }, 1, 4999)).toBeNull();
  });

  test("notAfter bounds the search to earlier events", () => {
    const y = sine1k(5000);
    const i = findTrigger(y, RISE0, 1, 3500);
    expect(i).toBe(3001);
  });

  test("holdoff rejects candidates within the blind window", () => {
    const y = sine1k(5000);
    // Accepted crossing 4001 previously, holdoff 1.5 cycles: candidates
    // 4001 (distance 0) and everything older (negative distance) are blind.
    expect(
      findTrigger(y, { level: 0, edge: "rise", holdoffSamples: 1500 }, 1, 4999, 4001),
    ).toBeNull();
    // An EARLIER lastAccepted leaves the newest crossing valid.
    expect(findTrigger(y, { level: 0, edge: "rise", holdoffSamples: 1500 }, 1, 4999, 2000)).toBe(
      4001,
    );
  });

  test("holdoff forces the next-older crossing when the newest is blind", () => {
    const y = sine1k(5000);
    // lastAccepted = 4200 (between crossings): 4001 is 199 samples later →
    // rejected with holdoff 1000; all older crossings are negative-distance.
    expect(
      findTrigger(y, { level: 0, edge: "rise", holdoffSamples: 1000 }, 1, 4999, 4200),
    ).toBeNull();
  });

  test("interpolated trigger time lands between samples", () => {
    const y = sine1k(5000);
    const x = new Float64Array(5000);
    for (let k = 0; k < x.length; k++) {
      x[k] = k * DT;
    }
    const i = findTrigger(y, RISE0, 1, 4999);
    expect(i).not.toBeNull();
    const t = triggerTime(x, y, i ?? 1, 0);
    // Crossing at k=4001 has y[4000] slightly < 0 and y[4001] slightly > 0.
    expect(t).toBeGreaterThan(4000 * DT);
    expect(t).toBeLessThan(4002 * DT);
  });
});

describe("resolveAnchor (acquisition modes)", () => {
  test("auto: found → anchor + triggered", () => {
    const r = resolveAnchor("auto", 42, 10);
    expect(r).toEqual({ anchor: 42, triggered: true, accepted: 42 });
  });

  test("auto: none → free-run (null anchor)", () => {
    const r = resolveAnchor("auto", null, 10);
    expect(r.anchor).toBeNull();
    expect(r.triggered).toBe(false);
    expect(r.accepted).toBeNull();
  });

  test("normal: none → keep the previous window", () => {
    const r = resolveAnchor("normal", null, 10);
    expect(r.anchor).toBe(10);
  });

  test("single: same resolution as normal — pipeline owns arming", () => {
    expect(resolveAnchor("single", null, 10).anchor).toBe(10);
    expect(resolveAnchor("single", 7, 10).anchor).toBe(7);
  });
});
