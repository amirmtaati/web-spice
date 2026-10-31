/**
 * Spatial index over the schematic (master §9.1): R-tree (rbush, ADR 009)
 * for hit-testing, rubber-band selection, snapping candidates, and viewport
 * culling. Never iterate the whole document per pointer move.
 */
import RBush from "rbush";
import type { Vec2 as DocVec2, Rect, Vec2 } from "../geometry.ts";
import { pointSegmentDist } from "../geometry.ts";
import { instanceBounds, pinsOf } from "../schematic/instances.ts";
import type { SchematicDoc, Selection } from "../schematic/types.ts";

interface Item {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly kind: "symbol" | "wire" | "pin" | "label" | "text" | "noConnect";
  readonly id: string;
  /** Extra payload per kind (pin id, segment endpoints). */
  readonly data?: unknown;
}

export class SpatialIndex {
  private readonly tree = new RBush<Item>();
  private rev = -1;

  constructor(doc?: SchematicDoc) {
    if (doc !== undefined) this.rebuild(doc);
  }

  /** (Re)build from the document — bulk load, called on doc rev change. */
  rebuild(doc: SchematicDoc): void {
    this.rev = doc.rev;
    const items: Item[] = [];
    for (const inst of doc.symbols) {
      const b = instanceBounds(inst);
      if (b !== null) {
        items.push({
          minX: b.x,
          minY: b.y,
          maxX: b.x + b.w,
          maxY: b.y + b.h,
          kind: "symbol",
          id: inst.id,
        });
      }
      for (const rp of pinsOf(inst)) {
        const r = 120; // generous pin target: 12 mil
        items.push({
          minX: rp.at.x - r,
          minY: rp.at.y - r,
          maxX: rp.at.x + r,
          maxY: rp.at.y + r,
          kind: "pin",
          id: `${inst.id}:${rp.pin.id}`,
          data: { at: rp.at, instId: inst.id, pinId: rp.pin.id },
        });
      }
    }
    for (const w of doc.wires) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i];
        const b = w.pts[i + 1];
        if (a === undefined || b === undefined) continue;
        items.push({
          minX: Math.min(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxX: Math.max(a.x, b.x),
          maxY: Math.max(a.y, b.y),
          kind: "wire",
          id: w.id,
          data: { a, b },
        });
      }
    }
    for (const l of doc.labels) {
      const w = Math.max(600, l.text.length * 160);
      items.push({
        minX: l.at.x - 100,
        minY: l.at.y - 350,
        maxX: l.at.x + w,
        maxY: l.at.y + 350,
        kind: "label",
        id: l.id,
      });
    }
    for (const t of doc.texts) {
      const w = Math.max(600, t.text.length * 200);
      items.push({
        minX: t.at.x,
        minY: t.at.y - 300,
        maxX: t.at.x + w,
        maxY: t.at.y + 300,
        kind: "text",
        id: t.id,
      });
    }
    for (const nc of doc.noConnects) {
      items.push({
        minX: nc.at.x - 300,
        minY: nc.at.y - 300,
        maxX: nc.at.x + 300,
        maxY: nc.at.y + 300,
        kind: "noConnect",
        id: nc.id,
      });
    }
    this.tree.clear();
    this.tree.load(items);
  }

  /** Rebuild lazily when the doc revision changed. */
  sync(doc: SchematicDoc): void {
    if (doc.rev !== this.rev) this.rebuild(doc);
  }

  /** All items intersecting the rect (rubber band, culling, snap candidates). */
  inRect(r: Rect): readonly Item[] {
    return this.tree.search({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h });
  }

  /**
   * Topmost hit at a document point within tolerance (screen px converted by
   * the caller). Priority: pin > wire > symbol > label/text/noConnect.
   */
  hit(p: DocVec2, tolerance: number): Item | null {
    const box: Item = {
      minX: p.x - tolerance,
      minY: p.y - tolerance,
      maxX: p.x + tolerance,
      maxY: p.y + tolerance,
      kind: "pin",
      id: "",
    };
    const candidates = this.tree.search(box);
    const byKind = (k: Item["kind"]): readonly Item[] => candidates.filter((c) => c.kind === k);
    const order: readonly Item["kind"][] = ["pin", "wire", "symbol", "label", "text", "noConnect"];
    for (const k of order) {
      let best: Item | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const c of byKind(k)) {
        if (k === "wire") {
          const d = c.data as { readonly a: Vec2; readonly b: Vec2 };
          const dist = pointSegmentDist(p, d.a, d.b);
          if (dist <= tolerance && dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        } else {
          best = c; // bbox hit — first is fine (topmost painter order approximated)
          break;
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /**
   * Rubber-band selection (master §9.3): LTR (w ≥ 0) selects fully enclosed
   * items; RTL selects anything touching. Returns the selection.
   */
  rubberBand(r: Rect, enclosed: boolean): Selection {
    const symbols = new Set<string>();
    const wires = new Set<string>();
    const labels = new Set<string>();
    const texts = new Set<string>();
    const noConnects = new Set<string>();
    const sel = { symbols, wires, labels, texts, noConnects };
    const add = (item: Item): void => {
      switch (item.kind) {
        case "symbol":
          sel.symbols.add(item.id);
          break;
        case "wire":
          sel.wires.add(item.id);
          break;
        case "label":
          sel.labels.add(item.id);
          break;
        case "text":
          sel.texts.add(item.id);
          break;
        case "noConnect":
          sel.noConnects.add(item.id);
          break;
        case "pin":
          break; // pins select with their symbol
      }
    };
    for (const item of this.inRect(r)) {
      if (item.kind === "pin") continue;
      if (!enclosed) {
        add(item);
        continue;
      }
      // Fully enclosed: bbox inside the band. Wires enclose when both
      // segment endpoints are inside.
      if (item.kind === "wire") {
        const d = item.data as { readonly a: Vec2; readonly b: Vec2 };
        const inside = (p: Vec2): boolean =>
          p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
        if (inside(d.a) && inside(d.b)) add(item);
        continue;
      }
      const box: Rect = {
        x: item.minX,
        y: item.minY,
        w: item.maxX - item.minX,
        h: item.maxY - item.minY,
      };
      if (
        box.x >= r.x &&
        box.y >= r.y &&
        box.x + box.w <= r.x + r.w &&
        box.y + box.h <= r.y + r.h
      ) {
        add(item);
      }
    }
    return sel;
  }

  /** Pins near a point within radius (snap candidates, priority 1). */
  pinsNear(
    p: DocVec2,
    radius: number,
  ): readonly { readonly instId: string; readonly pinId: string; readonly at: Vec2 }[] {
    return this.tree
      .search({ minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius })
      .filter((i) => i.kind === "pin")
      .map((i) => i.data as { at: Vec2; instId: string; pinId: string });
  }
}
