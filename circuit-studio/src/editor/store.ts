/**
 * Editor store (UX1-T8): the schematic document, selection, tool state, and
 * history in one zustand slice. Pure document helpers live here; the tool
 * reducer (tools.ts) emits effects, and `applyEffects` executes them against
 * the doc with one coalesced history entry per gesture.
 */
import { create } from "zustand";
import { SpatialIndex } from "../canvas/spatial.ts";
import type { Vec2 } from "../geometry.ts";
import { rectFrom } from "../geometry.ts";
import { normalizeWires } from "../schematic/normalize.ts";
import {
  emptyDoc,
  emptySelection,
  type SchematicDoc,
  type Selection,
  type SymbolInstance,
} from "../schematic/types.ts";
import { symbolById } from "../symbols/index.ts";
import { History } from "./history.ts";
import {
  type Effect,
  initialToolState,
  type Mods,
  type RouteMode,
  reduceTool,
  routeSegment,
  type ToolId,
  type ToolState,
} from "./tools.ts";

export interface EditorState {
  readonly doc: SchematicDoc;
  readonly sel: Selection;
  readonly tool: ToolState;
  readonly routeMode: RouteMode;
  readonly status: string;
  readonly historyVersion: number;
  setDoc: (next: SchematicDoc, coalesce?: string) => void;
  setSelection: (sel: Selection) => void;
  setTool: (tool: ToolId) => void;
  startPlace: (defId: string) => void;
  setRouteMode: (m: RouteMode) => void;
  dispatch: (
    ev: Parameters<typeof reduceTool>[1],
    snapped: Vec2,
    hitSomething: boolean,
    mods: Mods,
  ) => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  rotateSelection: () => void;
  mirrorSelection: () => void;
}

const history = new History(emptyDoc());
let dragBaseline: SchematicDoc | null = null;

/** Normalize wires after any wire-affecting edit (master §9.5). */
const withWires = (doc: SchematicDoc, wires: SchematicDoc["wires"]): SchematicDoc => ({
  ...doc,
  wires,
  rev: doc.rev + 1,
});

export const useEditorStore = create<EditorState>((set, get) => ({
  doc: emptyDoc(),
  sel: emptySelection(),
  tool: initialToolState(),
  routeMode: "ortho",
  status: "",
  historyVersion: 0,

  setDoc: (next, coalesce) => {
    history.commit(next, coalesce);
    set({ doc: next, historyVersion: get().historyVersion + 1 });
  },

  setSelection: (sel) => set({ sel }),

  setTool: (tool) => {
    const r = reduceTool(
      get().tool,
      { t: "tool", tool },
      { snapped: { x: 0, y: 0 }, hitSomething: false },
    );
    set({ tool: r.state, status: "" });
  },

  startPlace: (defId) => {
    const r = reduceTool(
      get().tool,
      { t: "place", defId },
      { snapped: { x: 0, y: 0 }, hitSomething: false },
    );
    set({ tool: r.state });
  },

  setRouteMode: (m) => set({ routeMode: m }),

  dispatch: (ev, snapped, hitSomething) => {
    const { tool, doc, sel } = get();
    const r = reduceTool(tool, ev, { snapped, hitSomething });
    if (r.state === tool && r.effects.length === 0) return;
    let nextSel = sel;
    let nextDoc = doc;
    let status = get().status;
    for (const fx of r.effects) {
      const applied = applyEffect(fx, { doc: nextDoc, sel: nextSel, status });
      nextDoc = applied.doc;
      nextSel = applied.sel;
      status = applied.status;
    }
    set({ tool: r.state, sel: nextSel, doc: nextDoc, status });
  },

  undo: () => {
    const restored = history.undo(get().doc);
    set({ doc: restored, historyVersion: get().historyVersion + 1, sel: emptySelection() });
  },

  redo: () => {
    const restored = history.redo(get().doc);
    set({ doc: restored, historyVersion: get().historyVersion + 1, sel: emptySelection() });
  },

  deleteSelection: () => {
    const { doc, sel } = get();
    if (
      sel.symbols.size + sel.wires.size + sel.labels.size + sel.texts.size + sel.noConnects.size ===
      0
    )
      return;
    const next: SchematicDoc = {
      ...doc,
      symbols: doc.symbols.filter((s) => !sel.symbols.has(s.id)),
      wires: doc.wires.filter((w) => !sel.wires.has(w.id)),
      labels: doc.labels.filter((l) => !sel.labels.has(l.id)),
      texts: doc.texts.filter((t) => !sel.texts.has(t.id)),
      noConnects: doc.noConnects.filter((n) => !sel.noConnects.has(n.id)),
      rev: doc.rev + 1,
    };
    history.commit(next);
    set({ doc: next, sel: emptySelection() });
  },

  rotateSelection: () => rotateOrMirror(get, set, "rotate"),

  mirrorSelection: () => rotateOrMirror(get, set, "mirror"),
}));

function rotateOrMirror(
  get: () => EditorState,
  set: (partial: Partial<EditorState>) => void,
  kind: "rotate" | "mirror",
): void {
  const { doc, sel } = get();
  if (sel.symbols.size === 0) return;
  const symbols = doc.symbols.map((s): SymbolInstance => {
    if (!sel.symbols.has(s.id)) return s;
    if (kind === "rotate") {
      return { ...s, rot: ((s.rot + 1) % 4) as 0 | 1 | 2 | 3 };
    }
    return { ...s, mirrorX: !s.mirrorX };
  });
  const next = { ...doc, symbols, rev: doc.rev + 1 };
  history.commit(next);
  set({ doc: next });
}

function applyEffect(
  fx: Effect,
  ctx: { doc: SchematicDoc; sel: Selection; status: string },
): { doc: SchematicDoc; sel: Selection; status: string } {
  switch (fx.t) {
    case "rubberSelect": {
      const index = new SpatialIndex(ctx.doc);
      const r = rectFrom(fx.from, fx.to);
      return { ...ctx, sel: index.rubberBand(r, fx.enclosed) };
    }
    case "rubber":
      return ctx;
    case "beginDrag":
      dragBaseline = ctx.doc;
      return ctx;
    case "dragMove": {
      if (dragBaseline === null) return ctx;
      const d = fx.d;
      const ids = ctx.sel.symbols;
      const symbols = dragBaseline.symbols.map((s) =>
        ids.has(s.id) ? { ...s, x: s.x + d.x, y: s.y + d.y } : s,
      );
      // Wires with selected endpoints stretch (KiCad drag): recompute from
      // baseline positions of selected pins is UX2+; for UX1 move whole
      // selected wires + attached wire ends via pin snapping at drop.
      const wires = dragBaseline.wires.map((w) =>
        ctx.sel.wires.has(w.id)
          ? { ...w, pts: w.pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) }
          : w,
      );
      return { ...ctx, doc: { ...ctx.doc, symbols, wires, rev: ctx.doc.rev + 1 } };
    }
    case "endDrag":
      if (dragBaseline !== null && (fx.d.x !== 0 || fx.d.y !== 0)) {
        history.commit(ctx.doc, `drag:${[...ctx.sel.symbols][0] ?? "sel"}`);
        // Re-snap wire endpoints onto pins they touch after the move.
        const norm = normalizeWires(ctx.doc.wires);
        const doc2 = withWires(ctx.doc, norm.wires);
        dragBaseline = null;
        return { ...ctx, doc: doc2 };
      }
      dragBaseline = null;
      return ctx;
    case "beginPan":
    case "panBy":
    case "endPan":
      return ctx; // camera effects handled by CanvasView (reads state.k)
    case "beginWire":
    case "commitWire": {
      if (fx.t === "commitWire") {
        const id = `w${ctx.doc.nextId}`;
        const doc2 = withWires(ctx.doc, [...ctx.doc.wires, { id, pts: [...fx.pts] }]);
        const bumped = { ...doc2, nextId: ctx.doc.nextId + 1 };
        history.commit(bumped);
        return { ...ctx, doc: bumped };
      }
      return ctx;
    }
    case "ghostCommit": {
      const def = symbolById(fx.defId);
      if (def === undefined) return ctx;
      const inst: SymbolInstance = {
        id: `s${ctx.doc.nextId}`,
        defId: fx.defId,
        x: fx.at.x,
        y: fx.at.y,
        rot: fx.rot,
        mirrorX: fx.mirrorX,
        fields: Object.fromEntries(
          def.fields.map((f) => [
            f.key,
            f.key === "reference" ? `${f.defaultText}${ctx.doc.nextId}` : f.defaultText,
          ]),
        ),
        props: Object.fromEntries(def.properties.map((p) => [p.key, p.default])),
      };
      const next: SchematicDoc = {
        ...ctx.doc,
        symbols: [...ctx.doc.symbols, inst],
        rev: ctx.doc.rev + 1,
        nextId: ctx.doc.nextId + 1,
      };
      history.commit(next);
      return { ...ctx, doc: next };
    }
    case "setStatus":
      return { ...ctx, status: fx.text };
    case "setTool":
      return ctx;
  }
}

/** Preview points for the active wire (CanvasView draws these). */
export function wirePreview(state: ToolState): readonly Vec2[] | null {
  if (state.k !== "wire") return null;
  const last = state.pts[state.pts.length - 1];
  if (last === undefined) return null;
  const seg = routeSegment(last, state.current, state.mode, state.flip);
  return [...state.pts, ...seg];
}
