/**
 * Layout presets (UI-UX-SPEC §3.2): Build / Debug / Present as serialized
 * dockview layouts. Sizes are relative fractions within their split; the
 * canvas ≥ 50 % width guard is a property of these presets and re-checked at
 * runtime by the shell (`enforceCanvasGuard`).
 */
import type { SerializedDockview } from "dockview-core";

export type PresetId = "build" | "debug" | "present";

export const PRESET_IDS: readonly PresetId[] = ["build", "debug", "present"];

export const PRESET_LABELS: Record<PresetId, string> = {
  build: "Build",
  debug: "Debug",
  present: "Present",
};

/** Canvas keeps ≥ 50 % of window width at all times (§3.1 region C guard). */
export const CANVAS_MIN_WIDTH_FRACTION = 0.5;
/** Instrument dock default height share in Debug (§3.2). */
export const INSTRUMENT_DOCK_HEIGHT_FRACTION = 0.4;

export const PANEL_IDS = [
  "canvas",
  "library",
  "inspector",
  "scope",
  "plots",
  "generator",
  "meters",
  "console",
  "data-table",
  "op-table",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

interface LeafSpec {
  readonly type: "leaf";
  readonly group: string;
  readonly panels: readonly PanelId[];
  readonly active?: PanelId;
  readonly size: number;
}

interface BranchSpec {
  readonly type: "branch";
  readonly orientation: "HORIZONTAL" | "VERTICAL";
  readonly children: readonly (LeafSpec | BranchSpec)[];
  readonly size?: number;
}

function leaf(spec: LeafSpec): object {
  return {
    type: "leaf",
    size: spec.size,
    data: {
      id: spec.group,
      views: spec.panels,
      activeView: spec.active ?? spec.panels[0],
    },
  };
}

function branch(spec: BranchSpec): object {
  return {
    type: "branch",
    ...(spec.size === undefined ? {} : { size: spec.size }),
    data: spec.children.map((child) => (child.type === "leaf" ? leaf(child) : branch(child))),
  };
}

function serialize(root: BranchSpec, panels: readonly PanelId[]): SerializedDockview {
  const grid = {
    root: branch(root),
    height: 1200,
    width: 1800,
    orientation: root.orientation,
  };
  return {
    grid,
    panels: Object.fromEntries(
      panels.map((id) => [id, { id, contentComponent: id, title: PANEL_TITLES[id] }]),
    ),
    activeGroup: "g-center",
  } as SerializedDockview;
}

export const PANEL_TITLES: Record<PanelId, string> = {
  canvas: "Schematic",
  library: "Library",
  inspector: "Inspector",
  scope: "Scope",
  plots: "Plots",
  generator: "Generator",
  meters: "Meters",
  console: "Console",
  "data-table": "Data table",
  "op-table": "OP table",
};

/** Build: library left, inspector right, canvas maximized, no instrument dock. */
export function buildPreset(): SerializedDockview {
  return serialize(
    {
      type: "branch",
      orientation: "HORIZONTAL",
      children: [
        { type: "leaf", group: "g-library", panels: ["library"], size: 18 },
        { type: "leaf", group: "g-center", panels: ["canvas"], size: 58 },
        { type: "leaf", group: "g-inspector", panels: ["inspector"], size: 24 },
      ],
    },
    ["library", "canvas", "inspector"],
  );
}

/** Debug: instruments bottom-right dock (40 % height), scope+console+OP tabs. */
export function debugPreset(): SerializedDockview {
  return serialize(
    {
      type: "branch",
      orientation: "HORIZONTAL",
      children: [
        { type: "leaf", group: "g-center", panels: ["canvas"], size: 56 },
        {
          type: "branch",
          orientation: "VERTICAL",
          size: 44,
          children: [
            { type: "leaf", group: "g-inspector", panels: ["inspector"], size: 60 },
            {
              type: "leaf",
              group: "g-instruments",
              panels: ["scope", "console", "op-table"],
              active: "scope",
              size: 40,
            },
          ],
        },
      ],
    },
    ["canvas", "inspector", "scope", "console", "op-table"],
  );
}

/** Present: canvas + scope only (toolbar auto-hide and large fonts: UX7). */
export function presentPreset(): SerializedDockview {
  return serialize(
    {
      type: "branch",
      orientation: "HORIZONTAL",
      children: [
        { type: "leaf", group: "g-center", panels: ["canvas"], size: 72 },
        { type: "leaf", group: "g-present", panels: ["scope"], size: 28 },
      ],
    },
    ["canvas", "scope"],
  );
}

export function presetLayout(id: PresetId): SerializedDockview {
  switch (id) {
    case "build":
      return buildPreset();
    case "debug":
      return debugPreset();
    case "present":
      return presentPreset();
  }
}

/* ── Guard + analysis helpers (pure, unit-tested) ────────────────────────── */

/* dockview-core does not export its view-state types, so the analysis
 * helpers read the serialized grid through this minimal structural mirror. */
interface PresetLeafNode {
  readonly type: "leaf";
  readonly size?: number;
  readonly data: { readonly views?: readonly string[] };
}
interface PresetBranchNode {
  readonly type: "branch";
  readonly size?: number;
  readonly data: readonly PresetNode[];
}
type PresetNode = PresetLeafNode | PresetBranchNode;

function asNode(node: unknown): PresetNode | null {
  if (typeof node !== "object" || node === null || !("type" in node)) {
    return null;
  }
  return node as PresetNode;
}

function isCanvasLeaf(node: PresetNode): boolean {
  return node.type === "leaf" && (node.data.views ?? []).includes("canvas");
}

/** Canvas width share of a preset's root split (fractions are relative). */
export function canvasWidthFraction(preset: SerializedDockview): number {
  const root = asNode(preset.grid.root);
  if (root === null || root.type !== "branch") {
    return 1;
  }
  const total = root.data.reduce((sum, child) => sum + (child.size ?? 0), 0);
  const canvas = root.data.find((child) => isCanvasLeaf(child));
  if (total === 0 || canvas === undefined) {
    return 1;
  }
  return (canvas.size ?? 0) / total;
}

/** Instrument dock height share (of its vertical column) — 0 when absent. */
export function instrumentDockHeightFraction(preset: SerializedDockview): number {
  const root = asNode(preset.grid.root);
  if (root === null || root.type !== "branch") {
    return 0;
  }
  const column = root.data.find(
    (child) =>
      child.type === "branch" &&
      child.data.some((grandchild) => JSON.stringify(grandchild).includes("g-instruments")),
  );
  if (column === undefined || column.type !== "branch") {
    return 0;
  }
  const dock = column.data.find((child) => JSON.stringify(child).includes("g-instruments"));
  if (dock === undefined) {
    return 0;
  }
  const total = column.data.reduce((sum, child) => sum + (child.size ?? 0), 0);
  return (dock.size ?? 0) / total;
}
