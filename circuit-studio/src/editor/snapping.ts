/**
 * Snapping (master §9.4): priority order 1. pin ends (strong) 2. wire points
 * and junctions 3. alignment guides 4. grid. `Alt` disables; `Ctrl+Alt` snaps
 * to grid only. Deterministic and unit-tested.
 */

import type { SpatialIndex } from "../canvas/spatial.ts";
import type { Vec2 } from "../geometry.ts";
import { snap as snap1d } from "../geometry.ts";

export type SnapKind = "pin" | "point" | "guide" | "grid" | "none";

export interface SnapResult {
  readonly pos: Vec2;
  readonly kind: SnapKind;
  /** Label for the indicator tag ("pin R1.a", "grid"). */
  readonly tag: string;
  /** Alignment guide lines (doc coords) to draw for this snap. */
  readonly guides: readonly { readonly a: Vec2; readonly b: Vec2 }[];
}

const PIN_RADIUS = 800; // 8 px at 100 px-per-mil ≈ strong magnet
const POINT_RADIUS = 600;

export interface SnapOptions {
  readonly grid: number;
  readonly enabled: boolean;
  /** Alt held: snapping fully off. */
  readonly disabled?: boolean;
  /** Ctrl+Alt: grid only (skip pins/points/guides). */
  readonly gridOnly?: boolean;
}

export function snapPoint(raw: Vec2, index: SpatialIndex, opts: SnapOptions): SnapResult {
  if (opts.disabled) {
    return { pos: raw, kind: "none", tag: "", guides: [] };
  }
  if (!opts.gridOnly) {
    // 1. Pin ends — strongest.
    const pins = index.pinsNear(raw, PIN_RADIUS);
    let bestPin: { at: Vec2; instId: string; pinId: string } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of pins) {
      const d = Math.abs(p.at.x - raw.x) + Math.abs(p.at.y - raw.y);
      if (d < bestDist) {
        bestDist = d;
        bestPin = p;
      }
    }
    if (bestPin !== null) {
      return {
        pos: bestPin.at,
        kind: "pin",
        tag: `pin ${bestPin.instId}.${bestPin.pinId}`,
        guides: [],
      };
    }

    // 2. Wire endpoints and junctions (points on wires).
    const near = index.inRect({
      x: raw.x - POINT_RADIUS,
      y: raw.y - POINT_RADIUS,
      w: POINT_RADIUS * 2,
      h: POINT_RADIUS * 2,
    });
    let bestPt: Vec2 | null = null;
    bestDist = Number.POSITIVE_INFINITY;
    for (const item of near) {
      if (item.kind !== "wire") continue;
      const seg = item.data as { readonly a: Vec2; readonly b: Vec2 };
      for (const p of [seg.a, seg.b]) {
        const d = Math.abs(p.x - raw.x) + Math.abs(p.y - raw.y);
        if (d <= POINT_RADIUS && d < bestDist) {
          bestDist = d;
          bestPt = p;
        }
      }
    }
    if (bestPt !== null) {
      return { pos: bestPt, kind: "point", tag: "wire point", guides: [] };
    }
  }

  // 4. Grid baseline.
  const grid = opts.grid > 0 ? opts.grid : 1;
  const pos = { x: snap1d(raw.x, grid), y: snap1d(raw.y, grid) };
  return { pos, kind: "grid", tag: "grid", guides: [] };
}
