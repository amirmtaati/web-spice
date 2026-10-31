/**
 * Camera (master §9.2): pan/zoom over the document, cursor-centered wheel
 * zoom, zoom range 5 %–6400 %, inertia on pan release, critically damped
 * programmatic moves, and level-of-detail tiers. Pure math — the CanvasView
 * feeds it pointer/wheel events and reads the transform per frame.
 *
 * Document units are integer 0.1-mil (see geometry.ts); screen units are CSS
 * pixels. Screen y grows down, matching the document.
 */

export interface CameraState {
  /** Document coordinate at the viewport's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per document unit. */
  readonly scale: number;
}

export const MIN_SCALE = 0.02; // 6400 % zoom-out floor: 5 % of "1 px per mil"
export const MAX_SCALE = 12.8; // 6400 % ceiling

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Level of detail tier for a given scale (§9.1/§9.2 LOD rules). */
export type Lod = "far" | "mid" | "near";
export function lodFor(scale: number): Lod {
  // Thresholds in px-per-mil: 1 unit = 0.1 mil → scale*0.1 px/mil.
  const pxPerMil = scale * 0.1;
  if (pxPerMil < 0.6) return "far";
  if (pxPerMil < 2.4) return "mid";
  return "near";
}

export function screenToDoc(
  p: { readonly x: number; readonly y: number },
  cam: CameraState,
): { x: number; y: number } {
  return { x: cam.x + p.x / cam.scale, y: cam.y + p.y / cam.scale };
}

export function docToScreen(
  p: { readonly x: number; readonly y: number },
  cam: CameraState,
): { x: number; y: number } {
  return { x: (p.x - cam.x) * cam.scale, y: (p.y - cam.y) * cam.scale };
}

/** Zoom keeping the given screen point anchored to the same document point. */
export function zoomAt(
  cam: CameraState,
  screen: { readonly x: number; readonly y: number },
  factor: number,
): CameraState {
  const next = clampScale(cam.scale * factor);
  const applied = next / cam.scale;
  const doc = screenToDoc(screen, cam);
  return {
    scale: next,
    x: doc.x - screen.x / next,
    y: doc.y - screen.y / next,
    ...(applied === next ? {} : {}),
  };
}

export function panBy(cam: CameraState, dx: number, dy: number): CameraState {
  return { x: cam.x - dx / cam.scale, y: cam.y - dy / cam.scale, scale: cam.scale };
}

/** Rectangle (doc units) → camera fitting it inside the viewport with margin. */
export function fitRect(
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  viewport: { readonly w: number; readonly h: number },
  margin = 80,
): CameraState {
  const scale = clampScale(
    Math.min(
      (viewport.w - margin * 2) / Math.max(rect.w, 1),
      (viewport.h - margin * 2) / Math.max(rect.h, 1),
    ),
  );
  return {
    scale,
    x: rect.x + rect.w / 2 - viewport.w / (2 * scale),
    y: rect.y + rect.h / 2 - viewport.h / (2 * scale),
  };
}

/**
 * Animation toward a target camera: critically damped spring (or instant
 * jump under prefers-reduced-motion). `step` advances by dt seconds and
 * returns the new state; the animation ends when close enough.
 */
export interface CameraAnimator {
  readonly active: boolean;
  step(dt: number): CameraState;
  state(): CameraState;
}

const DAMP = 18; // 1/s — settled in ~220–320 ms
const EPS = 0.5; // doc units
const EPS_SCALE = 0.001;

export function animateTo(from: CameraState, target: CameraState, instant = false): CameraAnimator {
  let cur: CameraState = from;
  if (instant) cur = target;
  return {
    get active(): boolean {
      return (
        Math.abs(cur.x - target.x) > EPS ||
        Math.abs(cur.y - target.y) > EPS ||
        Math.abs(cur.scale - target.scale) > EPS_SCALE
      );
    },
    step(dt: number): CameraState {
      if (instant) {
        cur = target;
        return cur;
      }
      const t = 1 - Math.exp(-DAMP * dt);
      cur = {
        x: cur.x + (target.x - cur.x) * t,
        y: cur.y + (target.y - cur.y) * t,
        scale: cur.scale + (target.scale - cur.scale) * t,
      };
      if (!this.active) cur = target;
      return cur;
    },
    state: () => cur,
  };
}

/**
 * Inertia for pan release: velocity decays with friction; any click/key
 * stops it (CanvasView clears it). Velocity in screen px/s.
 */
export interface Inertia {
  readonly active: boolean;
  step(dt: number): { readonly dx: number; readonly dy: number };
}

const FRICTION = 6; // 1/s

export function makeInertia(vx: number, vy: number): Inertia {
  let x = vx;
  let y = vy;
  const done = (): boolean => Math.abs(x) < 4 && Math.abs(y) < 4;
  return {
    get active(): boolean {
      return !done();
    },
    step(dt: number): { readonly dx: number; readonly dy: number } {
      const decay = Math.exp(-FRICTION * dt);
      const dx = x * dt;
      const dy = y * dt;
      x *= decay;
      y *= decay;
      if (done()) {
        x = 0;
        y = 0;
      }
      return { dx, dy };
    },
  };
}
