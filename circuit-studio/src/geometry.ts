/**
 * Integer schematic geometry (master SPEC §9.1).
 *
 * Coordinates are integers in "mils × 10" (1 unit = 0.1 mil = 2.54 µm).
 * Everything on the schematic grid is an exact integer, so round trips are
 * lossless and float drift cannot accumulate. The default grid is 50 mil =
 * 500 units; pins always land on it.
 */

export const GRID_DEFAULT = 500; // 50 mil
export const PIN_LENGTH = 1000; // 100 mil

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Manhattan + Euclidean helpers (pure, allocation-light). */
export const manhattan = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const vecEq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

export function snap(v: number, grid: number): number {
  return grid <= 0 ? Math.round(v) : Math.round(v / grid) * grid;
}

export function snapVec(p: Vec2, grid: number): Vec2 {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Rect fully enclosing both points (either corner order). */
export function rectFrom(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Smallest rect covering all rects (undefined-safe union). */
export function rectUnionAll(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translateRect(r: Rect, d: Vec2): Rect {
  return { x: r.x + d.x, y: r.y + d.y, w: r.w, h: r.h };
}

/**
 * Distance from point to segment, in squared space is not meaningful for
 * thresholds; return exact distance (units). Segment must be axis-aligned or
 * arbitrary — both supported.
 */
export function pointSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(dist2(p, a));
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = a.x + t * dx - p.x;
  const py = a.y + t * dy - p.y;
  return Math.sqrt(px * px + py * py);
}

/**
 * Point strictly inside a segment's interior (not an endpoint)? Used by wire
 * normalization and junction semantics (master §9.5).
 */
export function pointOnSegmentInterior(p: Vec2, a: Vec2, b: Vec2, eps: number): boolean {
  if (vecEq(p, a) || vecEq(p, b)) return false;
  return pointSegmentDist(p, a, b) <= eps;
}

/** Rotate (x, y) by 0/90/180/270 degrees clockwise around the origin. */
export function rotatePoint(p: Vec2, quarterTurns: number): Vec2 {
  const k = ((quarterTurns % 4) + 4) % 4;
  switch (k) {
    case 0:
      return p;
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    default:
      return { x: p.y, y: -p.x };
  }
}

/** Instance transform: rotate then mirror. Mirroring flips x after rotation. */
export function transformPoint(p: Vec2, rot: number, mirrorX: boolean, origin: Vec2): Vec2 {
  const r = rotatePoint(p, rot);
  const x = mirrorX ? -r.x : r.x;
  return { x: origin.x + x, y: origin.y + r.y };
}
