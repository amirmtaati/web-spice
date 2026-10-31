/** Camera tests (UX1-T2, master §9.2). */
import { describe, expect, it } from "bun:test";
import {
  animateTo,
  clampScale,
  docToScreen,
  fitRect,
  lodFor,
  MAX_SCALE,
  MIN_SCALE,
  makeInertia,
  panBy,
  screenToDoc,
  zoomAt,
} from "./camera.ts";

describe("camera", () => {
  it("zooms centered on the cursor", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    const screen = { x: 400, y: 300 };
    const docBefore = screenToDoc(screen, cam);
    const next = zoomAt(cam, screen, 2);
    const docAfter = screenToDoc(screen, next);
    expect(Math.abs(docAfter.x - docBefore.x)).toBeLessThan(1e-9);
    expect(Math.abs(docAfter.y - docBefore.y)).toBeLessThan(1e-9);
    expect(next.scale).toBe(2);
  });

  it("clamps zoom to 5 %–6400 %", () => {
    expect(clampScale(1e-9)).toBe(MIN_SCALE);
    expect(clampScale(1e9)).toBe(MAX_SCALE);
    const cam = { x: 0, y: 0, scale: MIN_SCALE };
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.01).scale).toBe(MIN_SCALE);
    expect(zoomAt({ x: 0, y: 0, scale: MAX_SCALE }, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE);
  });

  it("pans opposite to screen delta", () => {
    const next = panBy({ x: 0, y: 0, scale: 1 }, 100, 50);
    expect(next.x).toBe(-100);
    expect(next.y).toBe(-50);
  });

  it("screen↔doc round trip", () => {
    const cam = { x: 1234, y: -567, scale: 0.37 };
    const doc = { x: 9999, y: -12345 };
    const screen = docToScreen(doc, cam);
    const back = screenToDoc(screen, cam);
    expect(Math.abs(back.x - doc.x)).toBeLessThan(1e-9);
    expect(Math.abs(back.y - doc.y)).toBeLessThan(1e-9);
  });

  it("fits a rect inside the viewport with margin", () => {
    const cam = fitRect({ x: 0, y: 0, w: 10000, h: 5000 }, { w: 1200, h: 800 });
    expect(cam.scale).toBeGreaterThan(0);
    const corner = docToScreen({ x: 0, y: 0 }, cam);
    expect(corner.x).toBeGreaterThanOrEqual(0);
  });

  it("animates critically damped and settles on the target", () => {
    const a = animateTo({ x: 0, y: 0, scale: 1 }, { x: 1000, y: 2000, scale: 2 });
    let s = a.state();
    for (let i = 0; i < 200 && a.active; i++) s = a.step(1 / 60);
    expect(a.active).toBe(false);
    expect(Math.abs(s.x - 1000)).toBeLessThan(1);
    expect(Math.abs(s.scale - 2)).toBeLessThan(0.001);
  });

  it("jumps instantly under reduced motion", () => {
    const a = animateTo({ x: 0, y: 0, scale: 1 }, { x: 500, y: 0, scale: 1 }, true);
    expect(a.active).toBe(false);
    expect(a.state().x).toBe(500);
  });

  it("inertia decays below the stop threshold", () => {
    const i = makeInertia(600, 0);
    let steps = 0;
    while (i.active && steps < 500) {
      i.step(1 / 60);
      steps++;
    }
    expect(i.active).toBe(false);
  });

  it("LOD tiers follow the scale", () => {
    expect(lodFor(0.02)).toBe("far");
    expect(lodFor(8)).toBe("mid");
    expect(lodFor(60)).toBe("near");
  });
});
