/**
 * Junction limiter unit tests (SPEC §5.5): pnjlim / fetlim / limvds are
 * exact ports of ngspice devsup.c (DEVpnjlim, DEVfetlim, DEVlimvds), so the
 * expected values here are hand-derived from those formulas. Limiter
 * correctness is what keeps the exponential devices converging — every
 * branch of each limiter is pinned by these tests.
 */
import { describe, expect, test } from "bun:test";
import { thermalVoltage } from "../src/devices/nonlinear/junction.ts";
import { fetlim, junctionVcrit, limvds, pnjlim } from "../src/devices/nonlinear/limiting.ts";

const VT = thermalVoltage(27); // ≈ 0.02585 V
const IS = 1e-14;
const VCRIT = junctionVcrit(VT, IS);

describe("junctionVcrit", () => {
  test("vcrit = vt·ln(vt/(√2·Is))", () => {
    const expected = VT * Math.log(VT / (Math.SQRT2 * IS));
    expect(VCRIT).toBeCloseTo(expected, 15);
    // Sanity: for Is = 1e-14 the critical voltage is ≈ 0.73 V.
    expect(VCRIT).toBeGreaterThan(0.7);
    expect(VCRIT).toBeLessThan(0.8);
  });
  test("grows with vt and shrinks with Is", () => {
    expect(junctionVcrit(VT * 2, IS)).toBeGreaterThan(VCRIT);
    expect(junctionVcrit(VT, IS * 100)).toBeLessThan(VCRIT);
  });
});

describe("pnjlim", () => {
  test("small forward steps pass through unchanged", () => {
    const r = pnjlim(0.4, 0.3, VT, VCRIT);
    expect(r.v).toBe(0.4);
    expect(r.limited).toBe(false);
  });
  test("forward overshoot beyond vcrit is damped along the exponential", () => {
    const vOld = 0.5;
    const vNew = 5.0; // way past vcrit, |Δ| ≫ 2vt
    const r = pnjlim(vNew, vOld, VT, VCRIT);
    expect(r.limited).toBe(true);
    // v = vOld + vt·(2 + ln(arg − 2)), arg = (vNew − vOld)/vt
    const arg = (vNew - vOld) / VT;
    const expected = vOld + VT * (2 + Math.log(arg - 2));
    expect(r.v).toBeCloseTo(expected, 12);
    expect(r.v).toBeGreaterThan(vOld);
    expect(r.v).toBeLessThan(vNew);
  });
  test("damped step stays within one exponential-scale hop", () => {
    const r = pnjlim(5, 0.5, VT, VCRIT);
    // One hop ≈ a few vt per iteration, never a full 5 V jump.
    expect(r.v - 0.5).toBeLessThan(20 * VT);
  });
  test("large negative steps walk through zero (Gillespie fix)", () => {
    // vOld > 0 → limit is −(vOld + 1)
    const r = pnjlim(-10, 0.5, VT, VCRIT);
    expect(r.v).toBeCloseTo(-1.5, 12);
    expect(r.limited).toBe(true);
    // vOld ≤ 0 → limit is 2·vOld − 1
    const r2 = pnjlim(-10, -0.2, VT, VCRIT);
    expect(r2.v).toBeCloseTo(-1.4, 12);
  });
  test("reverse step inside the walk band passes through", () => {
    const r = pnjlim(-0.5, -0.2, VT, VCRIT);
    expect(r.v).toBe(-0.5);
    expect(r.limited).toBe(false);
  });
  test("cold start (vOld = 0) clamps to vt·ln(vNew/vt)", () => {
    const r = pnjlim(5, 0, VT, VCRIT);
    expect(r.limited).toBe(true);
    expect(r.v).toBeCloseTo(VT * Math.log(5 / VT), 12);
    expect(r.v).toBeGreaterThan(0);
    expect(r.v).toBeLessThan(1);
  });
});

describe("fetlim", () => {
  test("steps inside the transition band pass through", () => {
    // vOld in the middle region (vto ≤ vOld < vto+3.5), moderate increase.
    expect(fetlim(2.6, 2.4, 2.0)).toBe(2.6);
  });
  test("middle region increasing clamps at vto + 4", () => {
    expect(fetlim(50, 2.4, 2.0)).toBe(6.0);
  });
  test("middle region decreasing clamps at vto − 0.5", () => {
    expect(fetlim(-20, 2.4, 2.0)).toBe(1.5);
  });
  test("strongly on: upward steps damped by vtsthi", () => {
    const vOld = 6.0; // ≥ vtox = 5.5
    const vNew = 30;
    const r = fetlim(vNew, vOld, 2.0);
    const vtsthi = Math.abs(2 * (vOld - 2.0)) + 2;
    expect(r).toBeCloseTo(vOld + vtsthi, 12);
  });
  test("strongly on → off: large drop clamped by vtstlo above vtox", () => {
    const vOld = 6.0;
    const vNew = -5; // lands below vtox
    const r = fetlim(vNew, vOld, 2.0);
    // vnew < vtox → max(vnew, vto+2)
    expect(r).toBeCloseTo(4.0, 12);
  });
  test("off: upward step clamps at vto + 0.5", () => {
    expect(fetlim(10, 1.0, 2.0)).toBe(2.5);
  });
  test("off: moderate turn-on passes through", () => {
    expect(fetlim(2.3, 1.0, 2.0)).toBe(2.3);
  });
  test("off: large downward step damped by vtsthi", () => {
    const vOld = 1.0;
    const vNew = -30;
    const r = fetlim(vNew, vOld, 2.0);
    const vtsthi = Math.abs(2 * (vOld - 2.0)) + 2;
    expect(r).toBeCloseTo(vOld - vtsthi, 12);
  });
});

describe("limvds", () => {
  test("vold ≥ 3.5 upward clamps at 3·vold + 2", () => {
    expect(limvds(50, 4)).toBe(14);
  });
  test("vold ≥ 3.5 drop below 3.5 clamps at 2", () => {
    expect(limvds(0, 4)).toBe(2);
  });
  test("vold < 3.5 upward clamps at 4", () => {
    expect(limvds(10, 1)).toBe(4);
  });
  test("vold < 3.5 downward clamps at −0.5", () => {
    expect(limvds(-10, 1)).toBe(-0.5);
  });
  test("within bounds passes through", () => {
    expect(limvds(3, 1)).toBe(3);
    expect(limvds(10, 4)).toBe(10);
  });
});

describe("limiter integration sanity", () => {
  test("pnjlim iterations from a cold start approach the target monotonically", () => {
    // Simulate the limiting walk a Newton loop would take toward 0.7 V.
    let v = 0;
    const target = 0.7;
    let prev = -Infinity;
    for (let i = 0; i < 40; i++) {
      const r = pnjlim(target, v, VT, VCRIT);
      v = r.v;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
      if (!r.limited) {
        break;
      }
    }
    expect(v).toBeCloseTo(target, 6);
  });
});
