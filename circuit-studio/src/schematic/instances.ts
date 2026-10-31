/**
 * Instance geometry helpers: world-space pin positions, bounds, and field
 * anchors for placed symbols (pure functions over the doc model).
 */

import type { Rect, Vec2 } from "../geometry.ts";
import { transformPoint } from "../geometry.ts";
import { pinsForUnit, symbolById } from "../symbols/index.ts";
import type { FieldDef, PinDef, SymbolDef, SymbolInstance } from "./types.ts";

export interface ResolvedPin {
  readonly pin: PinDef;
  /** World-space connection end. */
  readonly at: Vec2;
  /** World-space inward end of the pin line (for rendering). */
  readonly from: Vec2;
  readonly instance: SymbolInstance;
  readonly def: SymbolDef;
}

/** Definition of an instance (undefined for stale ids — callers guard). */
export function defOf(inst: SymbolInstance): SymbolDef | undefined {
  return symbolById(inst.defId);
}

export function pinWorld(
  inst: SymbolInstance,
  p: PinDef,
): { readonly at: Vec2; readonly from: Vec2 } {
  const len = p.len ?? 1000;
  const dirVec: Record<string, Vec2> = {
    l: { x: len, y: 0 },
    r: { x: -len, y: 0 },
    u: { x: 0, y: len },
    d: { x: 0, y: -len },
  };
  const origin: Vec2 = { x: inst.x, y: inst.y };
  const d = dirVec[p.dir];
  if (d === undefined) return { at: origin, from: origin };
  const at = transformPoint({ x: p.x, y: p.y }, inst.rot, inst.mirrorX, origin);
  const inner = transformPoint({ x: p.x + d.x, y: p.y + d.y }, inst.rot, inst.mirrorX, origin);
  return { at, from: inner };
}

/** All pin ends of an instance in world space (unit-aware). */
export function pinsOf(inst: SymbolInstance): readonly ResolvedPin[] {
  const d = defOf(inst);
  if (d === undefined) return [];
  return pinsForUnit(inst.defId, inst.unit).map((p) => ({
    pin: p,
    ...pinWorld(inst, p),
    instance: inst,
    def: d,
  }));
}

/** Transformed unit body bounds in world space (axis-aligned enclosure). */
export function instanceBounds(inst: SymbolInstance): Rect | null {
  const d = defOf(inst);
  if (d === undefined) return null;
  const b = d.bounds;
  if (b === undefined) return null;
  const corners: readonly Vec2[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((p) => transformPoint(p, inst.rot, inst.mirrorX, { x: inst.x, y: inst.y }));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/** Field anchor in world space (reference/value text position). */
export function fieldAnchor(inst: SymbolInstance, f: FieldDef): Vec2 {
  return transformPoint({ x: f.x, y: f.y }, inst.rot, inst.mirrorX, { x: inst.x, y: inst.y });
}

/** Resolve the reference designator (fallback to id). */
export function referenceOf(inst: SymbolInstance): string {
  return inst.fields.reference ?? inst.id;
}

export function elementValue(inst: SymbolInstance): string {
  return inst.fields.value ?? "";
}
