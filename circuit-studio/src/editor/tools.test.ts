/** Tool FSM + snapping + history tests (UX1-T4/T8). */
import { describe, expect, it } from "bun:test";
import { SpatialIndex } from "../canvas/spatial.ts";
import { emptyDoc, emptySelection, type SchematicDoc } from "../schematic/types.ts";
import { History } from "./history.ts";
import { snapPoint } from "./snapping.ts";
import { initialToolState, nextRouteMode, reduceTool, routeSegment } from "./tools.ts";

const p = (x: number, y: number) => ({ x, y });
const NO_MODS = { shift: false, alt: false, ctrl: false };

describe("tool FSM", () => {
  it("place: down commits a ghost, stays armed (click-to-place re-arms)", () => {
    let s = reduceTool(
      initialToolState(),
      { t: "place", defId: "R" },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    s = reduceTool(s, { t: "move" }, { snapped: p(1000, 500), hitSomething: false }).state;
    expect(s.k).toBe("place");
    const r = reduceTool(
      s,
      { t: "down", button: 0, mods: NO_MODS },
      { snapped: p(1000, 500), hitSomething: false },
    );
    expect(r.effects.some((e) => e.t === "ghostCommit" && e.defId === "R")).toBe(true);
    expect(r.state.k).toBe("place"); // re-armed
  });

  it("R rotates and X mirrors the armed ghost", () => {
    let s = reduceTool(
      initialToolState(),
      { t: "place", defId: "C" },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    s = reduceTool(
      s,
      { t: "key", key: "r", mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    expect(s.k === "place" && s.rot).toBe(1);
    s = reduceTool(
      s,
      { t: "key", key: "x", mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    expect(s.k === "place" && s.mirrorX).toBe(true);
  });

  it("wire tool: down starts, click adds a corner, dblclick finishes with commitWire", () => {
    let s = reduceTool(
      initialToolState("wire"),
      { t: "down", button: 0, mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    expect(s.k).toBe("wire");
    s = reduceTool(s, { t: "click" }, { snapped: p(2000, 0), hitSomething: false }).state;
    expect(s.k === "wire" && s.pts.length).toBe(2);
    const r = reduceTool(s, { t: "dblclick" }, { snapped: p(2000, 2000), hitSomething: false });
    expect(r.effects[0]?.t).toBe("commitWire");
    const pts = (r.effects[0] as { readonly pts: readonly { x: number; y: number }[] }).pts;
    expect(pts.length).toBeGreaterThanOrEqual(3); // corner + endpoint
    expect(r.state.k).toBe("idle");
  });

  it("rubber band: down on empty space, up emits rubberSelect with direction", () => {
    let s = reduceTool(
      initialToolState(),
      { t: "down", button: 0, mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    expect(s.k).toBe("rubber");
    s = reduceTool(s, { t: "move" }, { snapped: p(5000, 5000), hitSomething: false }).state;
    const r = reduceTool(
      s,
      { t: "up", button: 0, mods: NO_MODS },
      { snapped: p(5000, 5000), hitSomething: false },
    );
    const sel = r.effects.find((e) => e.t === "rubberSelect");
    expect(sel !== undefined).toBe(true);
    expect((sel as { enclosed: boolean }).enclosed).toBe(true);
  });

  it("drag: down on an object drags and ends with endDrag", () => {
    let s = reduceTool(
      initialToolState(),
      { t: "down", button: 0, mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: true },
    ).state;
    expect(s.k).toBe("drag");
    s = reduceTool(s, { t: "move" }, { snapped: p(500, 0), hitSomething: true }).state;
    const r = reduceTool(
      s,
      { t: "up", button: 0, mods: NO_MODS },
      { snapped: p(500, 0), hitSomething: true },
    );
    const end = r.effects.find((e) => e.t === "endDrag");
    expect(end !== undefined).toBe(true);
  });

  it("Esc cancels any state to idle with no commit effects", () => {
    const s = reduceTool(
      initialToolState("wire"),
      { t: "down", button: 0, mods: NO_MODS },
      { snapped: p(0, 0), hitSomething: false },
    ).state;
    const r = reduceTool(s, { t: "cancel" }, { snapped: p(0, 0), hitSomething: false });
    expect(r.state.k).toBe("idle");
    expect(r.effects.some((e) => e.t === "commitWire" || e.t === "ghostCommit")).toBe(false);
  });

  it("routing modes cycle ortho → 45° → free; Space flips the corner", () => {
    expect(nextRouteMode("ortho")).toBe("deg45");
    expect(nextRouteMode("deg45")).toBe("free");
    expect(nextRouteMode("free")).toBe("ortho");
    // Ortho L-corner: horizontal-first by default, flipped by Space.
    const a = routeSegment(p(0, 0), p(1000, 500), "ortho", false);
    const b = routeSegment(p(0, 0), p(1000, 500), "ortho", true);
    expect(a).toEqual([p(1000, 0), p(1000, 500)]);
    expect(b).toEqual([p(0, 500), p(1000, 500)]);
  });
});

describe("history", () => {
  const d1: SchematicDoc = { ...emptyDoc(), rev: 1 };
  const d2: SchematicDoc = { ...emptyDoc(), rev: 2 };
  const d3: SchematicDoc = { ...emptyDoc(), rev: 3 };

  it("commits, undoes, redoes", () => {
    const h = new History(d1);
    h.commit(d2);
    h.commit(d3);
    expect(h.canUndo).toBe(true);
    expect(h.undo(d3)).toEqual(d2);
    expect(h.undo(d2)).toEqual(d1);
    expect(h.canUndo).toBe(false);
    expect(h.redo(d1)).toEqual(d2);
    expect(h.redo(d2)).toEqual(d3);
    expect(h.canRedo).toBe(false);
  });

  it("coalesces consecutive commits with the same gesture key", () => {
    const h = new History(d1);
    h.commit(d2, "drag:s1");
    h.commit(d3, "drag:s1"); // merged — one entry
    expect(h.undo(d3)).toEqual(d1);
  });

  it("a new gesture breaks coalescing", () => {
    const h = new History(d1);
    h.commit(d2, "drag:s1");
    h.commit(d3, "drag:s2");
    expect(h.undo(d3)).toEqual(d2);
  });
});

describe("snapping", () => {
  it("pins win over grid; grid is the fallback", () => {
    const doc: SchematicDoc = {
      ...emptyDoc(),
      rev: 1,
      symbols: [
        {
          id: "s1",
          defId: "R",
          x: 5000,
          y: 0,
          rot: 0,
          mirrorX: false,
          fields: { reference: "R1" },
          props: {},
        },
      ],
    };
    const index = new SpatialIndex(doc);
    const near = snapPoint(p(4150, 60), index, { grid: 500, enabled: true });
    expect(near.kind).toBe("pin");
    expect(near.pos).toEqual(p(4000, 0));
    const far = snapPoint(p(10000, 10000), index, { grid: 500, enabled: true });
    expect(far.kind).toBe("grid");
    expect(far.pos).toEqual(p(10000, 10000));
    const off = snapPoint(p(4150, 60), index, { grid: 500, enabled: true, disabled: true });
    expect(off.kind).toBe("none");
    expect(off.pos).toEqual(p(4150, 60));
  });
});

describe("spatial index", () => {
  it("rubber band: enclosed vs touching", () => {
    const doc: SchematicDoc = {
      ...emptyDoc(),
      rev: 1,
      symbols: [
        { id: "s1", defId: "R", x: 0, y: 0, rot: 0, mirrorX: false, fields: {}, props: {} },
        { id: "s2", defId: "R", x: 20000, y: 0, rot: 0, mirrorX: false, fields: {}, props: {} },
      ],
      wires: [{ id: "w1", pts: [p(-3000, 1500), p(3000, 1500)] }],
    };
    const index = new SpatialIndex(doc);
    const enclosed = index.rubberBand({ x: -5000, y: -5000, w: 10000, h: 10000 }, true);
    expect(enclosed.symbols.has("s1")).toBe(true);
    expect(enclosed.symbols.has("s2")).toBe(false);
    const touching = index.rubberBand({ x: -5000, y: -5000, w: 4000, h: 10000 }, false);
    expect(touching.wires.has("w1")).toBe(true);
  });

  it("hit() prefers pins over symbol bodies", () => {
    const doc: SchematicDoc = {
      ...emptyDoc(),
      rev: 1,
      symbols: [
        { id: "s1", defId: "R", x: 0, y: 0, rot: 0, mirrorX: false, fields: {}, props: {} },
      ],
    };
    const index = new SpatialIndex(doc);
    const hit = index.hit(p(-1000, 0), 300);
    expect(hit?.kind).toBe("pin");
    const body = index.hit(p(0, 0), 100);
    expect(body?.kind).toBe("symbol");
  });
});

describe("selection model", () => {
  it("starts empty", () => {
    const sel = emptySelection();
    expect(sel.symbols.size + sel.wires.size).toBe(0);
  });
});
