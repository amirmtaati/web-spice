/**
 * Scene builder (UX1-T1): pure function producing a layer-ordered draw list
 * from the document + camera. The Canvas2D renderer, the future WebGL
 * renderer, and the SVG exporter all consume the same ops — SVG export is
 * generated from the scene graph, never from screen pixels (master §9.1).
 */

import type { Rect, Vec2 } from "../geometry.ts";
import { rectContains, transformPoint } from "../geometry.ts";
import { fieldAnchor, instanceBounds, pinsOf, referenceOf } from "../schematic/instances.ts";
import { normalizeWires } from "../schematic/normalize.ts";
import { probesOf } from "../schematic/probes.ts";
import type { SchematicDoc, Selection } from "../schematic/types.ts";
import { symbolById as defOf } from "../symbols/index.ts";
import { type CameraState, lodFor } from "./camera.ts";

export type Layer =
  | "grid"
  | "wire"
  | "junction"
  | "symbol"
  | "pin"
  | "label"
  | "text"
  | "erc"
  | "overlay"
  | "selection"
  | "probe";

export type DrawOp =
  | { readonly layer: Layer; readonly op: "line"; readonly pts: readonly Vec2[] }
  | {
      readonly layer: Layer;
      readonly op: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly fill?: boolean;
    }
  | {
      readonly layer: Layer;
      readonly op: "circle";
      readonly at: Vec2;
      readonly r: number;
      readonly fill?: boolean;
      /** Palette key override (e.g. "sig3" for probe channels, §4.1). */
      readonly colorKey?: string;
    }
  | {
      readonly layer: Layer;
      readonly op: "arc";
      readonly at: Vec2;
      readonly r: number;
      readonly a0: number;
      readonly a1: number;
    }
  | {
      readonly layer: Layer;
      readonly op: "poly";
      readonly pts: readonly Vec2[];
      readonly fill?: boolean;
    }
  | { readonly layer: Layer; readonly op: "dot"; readonly at: Vec2; readonly r: number }
  | {
      readonly layer: Layer;
      readonly op: "text";
      readonly at: Vec2;
      readonly text: string;
      readonly size: number;
      readonly align?: "left" | "center";
      readonly bold?: boolean;
      /** Palette key override (probe channels, §4.1). */
      readonly colorKey?: string;
    }
  | { readonly layer: Layer; readonly op: "xCross"; readonly at: Vec2; readonly r: number };

export interface Scene {
  readonly ops: readonly DrawOp[];
  readonly lod: "far" | "mid" | "near";
  /** Document-space content bounds (for zoom-to-fit + SVG export viewBox). */
  readonly bounds: Rect;
}

const GRID = 500;

export function buildScene(
  doc: SchematicDoc,
  cam: CameraState,
  viewport: { readonly w: number; readonly h: number },
  sel: Selection,
  overlay: {
    readonly rubber?: { readonly from: Vec2; readonly to: Vec2 } | null;
    readonly wirePreview?: readonly Vec2[] | null;
    readonly ghost?: {
      readonly defId: string;
      readonly at: Vec2;
      readonly rot: 0 | 1 | 2 | 3;
      readonly mirrorX: boolean;
    } | null;
    readonly showGrid?: boolean;
  } = {},
): Scene {
  const lod = lodFor(cam.scale);
  const ops: DrawOp[] = [];

  // Viewport in doc units for culling + grid.
  const view: Rect = { x: cam.x, y: cam.y, w: viewport.w / cam.scale, h: viewport.h / cam.scale };

  // Grid dots (major every 5th).
  if (overlay.showGrid !== false && cam.scale > 0.06) {
    const g = doc.grid || GRID;
    const major = g * 5;
    const x0 = Math.floor(view.x / g) * g;
    const y0 = Math.floor(view.y / g) * g;
    for (let x = x0; x <= view.x + view.w; x += g) {
      for (let y = y0; y <= view.y + view.h; y += g) {
        const isMajor = x % major === 0 && y % major === 0;
        ops.push({ layer: "grid", op: "dot", at: { x, y }, r: isMajor ? 3 : 1.6 });
      }
    }
  }

  // Wires (normalized view — the doc stores raw, rendering shows canonical).
  const norm = normalizeWires(doc.wires);
  for (const w of norm.wires) {
    if (!rectIntersects(view, w.pts)) continue;
    ops.push({ layer: "wire", op: "poly", pts: w.pts });
  }
  for (const j of norm.junctions) {
    ops.push({ layer: "junction", op: "dot", at: j, r: 90 });
  }

  // Symbols.
  for (const inst of doc.symbols) {
    const b = instanceBounds(inst);
    if (b !== null && !rectsOverlap(view, b)) continue;
    drawInstance(ops, inst, lod, sel.symbols.has(inst.id));
  }

  // Labels, texts, no-connects.
  for (const l of doc.labels) {
    ops.push({ layer: "label", op: "text", at: l.at, text: l.text, size: 260, align: "left" });
  }
  for (const t of doc.texts) {
    ops.push({
      layer: "text",
      op: "text",
      at: t.at,
      text: t.text,
      size: t.size === "lg" ? 420 : t.size === "sm" ? 220 : 300,
    });
  }
  for (const nc of doc.noConnects) {
    ops.push({ layer: "text", op: "xCross", at: nc.at, r: 280 });
  }

  // Probe flags (UX2-T6): channel-colored circle + channel glyph.
  for (const probe of probesOf(doc)) {
    const at = { x: probe.x, y: probe.y };
    const key = `sig${((probe.channel - 1) % 8) + 1}`;
    const glyph = probe.kind === "voltage" ? String(probe.channel) : `i${probe.channel}`;
    ops.push({ layer: "probe", op: "circle", at, r: 150, colorKey: key });
    ops.push({
      layer: "probe",
      op: "text",
      at: { x: at.x, y: at.y - 210 },
      text: glyph,
      size: 260,
      align: "center",
      colorKey: key,
    });
  }

  // Tool overlays.
  if (overlay.rubber !== undefined && overlay.rubber !== null) {
    const r = overlay.rubber;
    ops.push({
      layer: "overlay",
      op: "rect",
      x: Math.min(r.from.x, r.to.x),
      y: Math.min(r.from.y, r.to.y),
      w: Math.abs(r.to.x - r.from.x),
      h: Math.abs(r.to.y - r.from.y),
      fill: false,
    });
  }
  if (overlay.wirePreview !== undefined && overlay.wirePreview !== null) {
    ops.push({ layer: "overlay", op: "poly", pts: overlay.wirePreview });
  }
  if (overlay.ghost !== undefined && overlay.ghost !== null && overlay.ghost.defId !== "") {
    drawGhost(ops, overlay.ghost);
  }

  return { ops, lod, bounds: docBounds(doc) };
}

function drawInstance(
  ops: DrawOp[],
  inst: SchematicDoc["symbols"][number],
  lod: "far" | "mid" | "near",
  selected: boolean,
): void {
  const layer: Layer = selected ? "selection" : "symbol";
  const toWorld = (p: Vec2): Vec2 =>
    transformPoint(p, inst.rot, inst.mirrorX, { x: inst.x, y: inst.y });

  // Body shapes come from the definition (ANSI graphics; v1 uses ansi for
  // both standards with the IEC swap rendered when the project sets it).
  const def = defOf(inst.defId);
  if (def !== undefined) {
    for (const shape of def.standards.ansi.shapes) {
      switch (shape.op) {
        case "line":
          ops.push({ layer, op: "poly", pts: shape.pts.map(toWorld) });
          break;
        case "rect":
          ops.push({
            layer,
            op: "poly",
            pts: [
              toWorld({ x: shape.x, y: shape.y }),
              toWorld({ x: shape.x + shape.w, y: shape.y }),
              toWorld({ x: shape.x + shape.w, y: shape.y + shape.h }),
              toWorld({ x: shape.x, y: shape.y + shape.h }),
            ],
            fill: def.standards.ansi.fill === "bg",
          });
          break;
        case "circle":
          ops.push({
            layer,
            op: "circle",
            at: toWorld({ x: shape.x, y: shape.y }),
            r: shape.r,
            fill: def.standards.ansi.fill === "bg",
          });
          break;
        case "arc":
          ops.push({
            layer,
            op: "arc",
            at: toWorld({ x: shape.x, y: shape.y }),
            r: shape.r,
            a0: shape.a0,
            a1: shape.a1,
          });
          break;
        case "poly":
          ops.push({ layer, op: "poly", pts: shape.pts.map(toWorld), fill: false });
          break;
        case "dot":
          ops.push({ layer, op: "dot", at: toWorld({ x: shape.x, y: shape.y }), r: 60 });
          break;
      }
    }

    // Pins + names.
    for (const rp of pinsOf(inst)) {
      if (!rp.pin.hidden) {
        ops.push({ layer: "pin", op: "line", pts: [rp.from, rp.at] });
        ops.push({ layer: "pin", op: "circle", at: rp.at, r: 40, fill: true });
      }
      if (lod !== "far" && !rp.pin.hidden && rp.pin.name !== "") {
        const nameAt = toWorld({
          x: rp.pin.x - (rp.pin.dir === "l" ? 150 : rp.pin.dir === "r" ? -150 : 0),
          y: rp.pin.y - 150,
        });
        ops.push({ layer: "pin", op: "text", at: nameAt, text: rp.pin.name, size: 180 });
      }
      if (lod === "near" && !rp.pin.hidden) {
        const numAt = toWorld({ x: rp.pin.x, y: rp.pin.y - 420 });
        ops.push({ layer: "pin", op: "text", at: numAt, text: rp.pin.num, size: 160 });
      }
    }

    // Reference + value fields (upright: skip transform rotation for text).
    for (const f of def.fields) {
      if (!f.onCanvas) continue;
      const text =
        f.key === "reference" ? referenceOf(inst) : (inst.fields[f.key] ?? f.defaultText);
      if (text === "") continue;
      const at = fieldAnchor(inst, f);
      ops.push({
        layer: "text",
        op: "text",
        at,
        text,
        size: 260,
        align: "center",
        bold: f.key === "reference",
      });
    }
  }
}

function drawGhost(
  ops: DrawOp[],
  ghost: {
    readonly defId: string;
    readonly at: Vec2;
    readonly rot: 0 | 1 | 2 | 3;
    readonly mirrorX: boolean;
  },
): void {
  const def = defOf(ghost.defId);
  if (def === undefined) return;
  const toWorld = (p: Vec2): Vec2 => transformPoint(p, ghost.rot, ghost.mirrorX, ghost.at);
  ops.push({ layer: "overlay", op: "circle", at: ghost.at, r: 1000 });
  for (const shape of def.standards.ansi.shapes) {
    if (shape.op === "line" || shape.op === "poly") {
      ops.push({ layer: "overlay", op: "poly", pts: shape.pts.map(toWorld) });
    } else if (shape.op === "circle") {
      ops.push({
        layer: "overlay",
        op: "circle",
        at: toWorld({ x: shape.x, y: shape.y }),
        r: shape.r,
      });
    } else if (shape.op === "rect") {
      ops.push({
        layer: "overlay",
        op: "poly",
        pts: [
          toWorld({ x: shape.x, y: shape.y }),
          toWorld({ x: shape.x + shape.w, y: shape.y }),
          toWorld({ x: shape.x + shape.w, y: shape.y + shape.h }),
          toWorld({ x: shape.x, y: shape.y + shape.h }),
        ],
      });
    } else if (shape.op === "arc") {
      ops.push({
        layer: "overlay",
        op: "arc",
        at: toWorld({ x: shape.x, y: shape.y }),
        r: shape.r,
        a0: shape.a0,
        a1: shape.a1,
      });
    }
  }
  for (const rp of pinsOf({
    id: "ghost",
    defId: ghost.defId,
    x: ghost.at.x,
    y: ghost.at.y,
    rot: ghost.rot,
    mirrorX: ghost.mirrorX,
    fields: {},
    props: {},
  })) {
    ops.push({ layer: "overlay", op: "circle", at: rp.at, r: 70, fill: true });
  }
}

function rectIntersects(view: Rect, pts: readonly Vec2[]): boolean {
  return pts.some((p) => rectContains(expand(view, 500), p));
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function expand(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function docBounds(doc: SchematicDoc): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const s of doc.symbols) {
    consider({ x: s.x - 1500, y: s.y - 1500 });
    consider({ x: s.x + 1500, y: s.y + 1500 });
  }
  for (const w of doc.wires) for (const p of w.pts) consider(p);
  for (const l of doc.labels) consider(l.at);
  for (const t of doc.texts) consider(t.at);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 10000, h: 7000 };
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1000), h: Math.max(maxY - minY, 1000) };
}
