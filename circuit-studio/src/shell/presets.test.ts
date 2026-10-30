/** Preset + guard tests (UX0-T4): panel completeness, fractions, persistence. */
import { beforeEach, describe, expect, it } from "bun:test";
import { loadLayout, parseLayout, saveLayout } from "./layout-persistence.ts";
import {
  CANVAS_MIN_WIDTH_FRACTION,
  canvasWidthFraction,
  INSTRUMENT_DOCK_HEIGHT_FRACTION,
  instrumentDockHeightFraction,
  PANEL_IDS,
  PRESET_IDS,
  presetLayout,
} from "./presets.ts";

describe("layout presets", () => {
  it("every preset contains the canvas, and panel ids/panels maps agree", () => {
    for (const id of PRESET_IDS) {
      const layout = presetLayout(id);
      const panelIds = Object.keys(layout.panels);
      expect(panelIds.length).toBeGreaterThan(0);
      for (const panelId of panelIds) {
        expect((PANEL_IDS as readonly string[]).includes(panelId)).toBe(true);
        expect(layout.panels[panelId]?.id).toBe(panelId);
      }
      expect(panelIds).toContain("canvas");
      const raw = JSON.stringify(layout);
      expect(raw).toContain('"canvas"');
    }
  });

  it("every panel id appears in exactly one group per preset", () => {
    for (const id of PRESET_IDS) {
      const layout = presetLayout(id);
      const grid = JSON.stringify(layout.grid);
      const viewIds = [...grid.matchAll(/"views":\[([^\]]*)\]/g)]
        .flatMap((match) => (match[1] ?? "").split(","))
        .map((s) => s.replaceAll('"', ""));
      const panelIds = Object.keys(layout.panels);
      expect([...viewIds].sort()).toEqual([...panelIds].sort());
    }
  });

  it("canvas keeps ≥ 50 % width in every preset", () => {
    for (const id of PRESET_IDS) {
      expect(canvasWidthFraction(presetLayout(id))).toBeGreaterThanOrEqual(
        CANVAS_MIN_WIDTH_FRACTION,
      );
    }
  });

  it("debug preset puts the instrument dock at ~40 % height", () => {
    const share = instrumentDockHeightFraction(presetLayout("debug"));
    expect(Math.abs(share - INSTRUMENT_DOCK_HEIGHT_FRACTION)).toBeLessThan(0.02);
    expect(instrumentDockHeightFraction(presetLayout("build"))).toBe(0);
  });

  it("debug preset tabs scope, console, and OP table in one group", () => {
    const raw = JSON.stringify(presetLayout("debug"));
    const group = /"id":"g-instruments","views":\[([^\]]+)\]/.exec(raw);
    expect(group).not.toBeNull();
    const views = JSON.parse(`[${group?.[1] ?? ""}]`) as string[];
    expect(views).toEqual(["scope", "console", "op-table"]);
  });

  it("build preset has no instrument dock panels", () => {
    const panelIds = Object.keys(presetLayout("build").panels);
    expect(panelIds).not.toContain("scope");
    expect(panelIds).not.toContain("console");
  });
});

describe("layout persistence", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("round-trips a preset layout", () => {
    const layout = presetLayout("debug");
    saveLayout("p1", layout);
    const restored = loadLayout("p1");
    expect(restored).not.toBeNull();
    expect(JSON.stringify(restored)).toBe(JSON.stringify(layout));
  });

  it("rejects corrupt or foreign JSON without throwing", () => {
    saveLayout("p2", presetLayout("build"));
    globalThis.localStorage.setItem("circuit-studio/layout/v1/p3", "{not json");
    globalThis.localStorage.setItem(
      "circuit-studio/layout/v1/p4",
      JSON.stringify({ hello: "world" }),
    );
    expect(parseLayout("{not json")).toBeNull();
    expect(parseLayout(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(loadLayout("p3")).toBeNull();
    expect(loadLayout("p4")).toBeNull();
    expect(loadLayout("p2")).not.toBeNull();
  });

  it("returns null for missing projects", () => {
    expect(loadLayout("missing")).toBeNull();
  });
});
