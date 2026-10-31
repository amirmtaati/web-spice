/**
 * UX3-T4/T5 cursor + math channel tests: snap on the uniform axis, Δ
 * readouts, hit-testing, and exact math transforms (∫ of a constant, d/dt
 * of a sine, elementwise ±/×).
 */
import { describe, expect, test } from "bun:test";
import { applyMath, derivative, describeMathOp, integral } from "../math.ts";
import { cursorReadouts, hitCursor, sampleAt, snapX } from "./cursors.ts";

describe("cursors", () => {
  const x0 = 0;
  const dt = 1e-5;

  test("snapX clamps to the sampled grid", () => {
    expect(snapX(0.0000504, x0, dt, 100)).toBeCloseTo(5e-5, 12);
    expect(snapX(-1, x0, dt, 100)).toBe(0);
    expect(snapX(1e9, x0, dt, 100)).toBeCloseTo(99 * dt, 12);
  });

  test("readouts: Δt, 1/Δt, ΔV", () => {
    const r = cursorReadouts({ x1: 0, x2: 2.5e-3, y1: 1, y2: -1, track: false, snap: true });
    expect(r.dt).toBeCloseTo(2.5e-3, 15);
    expect(r.oneOverDt).toBeCloseTo(400, 6);
    expect(r.dy).toBe(-2);
  });

  test("sampleAt interpolates between samples", () => {
    const y = Float64Array.from([0, 1, 2, 3]);
    expect(sampleAt(1.5 * dt, 0, dt, y)).toBeCloseTo(1.5, 12);
    expect(sampleAt(-1, 0, dt, y)).toBeNaN();
    expect(sampleAt(10, 0, dt, y)).toBeNaN();
  });

  test("hitCursor picks the nearest handle within 8 px", () => {
    const c = { x1: 0, x2: 0.001, y1: null, y2: null, track: false, snap: true };
    const toPxX = (x: number) => x * 10_000; // 0 → px 0, 0.001 → px 10
    const toPxY = (y: number) => y;
    expect(hitCursor(c, toPxX, toPxY, 0, 0)).toBe("x1");
    expect(hitCursor(c, toPxX, toPxY, 10, 0)).toBe("x2");
    expect(hitCursor(c, toPxX, toPxY, 20, 0)).toBeNull(); // nearest is 10 px away
  });
});

describe("math channels", () => {
  test("∫ constant dt = c·t (trapezoid, zero at start)", () => {
    const dt = 0.5;
    const a = new Float64Array(10).fill(2);
    const out = new Float64Array(10);
    integral(a, dt, out);
    expect(out[0]).toBe(0);
    expect(out[9]).toBeCloseTo(2 * dt * 9, 12);
  });

  test("∫ of a triangle equals its piecewise area", () => {
    const dt = 1;
    const a = Float64Array.from([0, 1, 2, 1, 0]);
    const out = new Float64Array(5);
    integral(a, dt, out);
    // Trapezoid cumulative: 0, .5, 2, 3.5, 4
    expect(out[4]).toBeCloseTo(4, 12);
  });

  test("d/dt sine ≈ cos on the fine grid", () => {
    const n = 2000;
    const dt = (2 * Math.PI) / n / 8;
    const a = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      a[k] = Math.sin(k * dt);
    }
    const out = new Float64Array(n);
    derivative(a, dt, out);
    for (const k of [100, 500, 1000, 1500]) {
      expect(out[k]).toBeCloseTo(Math.cos(k * dt), 3);
    }
  });

  test("add / sub / mul elementwise", () => {
    const a = Float64Array.from([1, 2, 3]);
    const b = Float64Array.from([10, 20, 30]);
    const out = new Float64Array(3);
    applyMath({ kind: "add", a: "A", b: "B" }, (n) => (n === "A" ? a : b), 1, out);
    expect([...out]).toEqual([11, 22, 33]);
    applyMath({ kind: "sub", a: "A", b: "B" }, (n) => (n === "A" ? a : b), 1, out);
    expect([...out]).toEqual([-9, -18, -27]);
    applyMath({ kind: "mul", a: "A", b: "B" }, (n) => (n === "A" ? a : b), 1, out);
    expect([...out]).toEqual([10, 40, 90]);
  });

  test("missing operand → 0 samples (channel stays empty)", () => {
    const out = new Float64Array(3);
    expect(applyMath({ kind: "add", a: "A", b: "GHOST" }, () => undefined, 1, out)).toBe(0);
  });

  test("describeMathOp is human-readable", () => {
    expect(describeMathOp({ kind: "int", a: "v(out)" })).toBe("∫v(out)dt");
    expect(describeMathOp({ kind: "mul", a: "A", b: "B" })).toBe("A·B");
  });
});
