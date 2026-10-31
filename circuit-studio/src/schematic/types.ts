/**
 * Schematic document model (master SPEC §9.1 coordinates, §9.5 wiring
 * semantics, §9.6 symbol format). The document is plain serializable data —
 * the editor store owns immutability and history; connectivity, netlist
 * extraction, ERC, and rendering are pure functions over it.
 */
import type { Rect, Vec2 } from "../geometry.ts";

export type { Rect, Vec2 };

/** Electrical pin classes used by ERC (master §9.6). */
export type PinEType =
  | "input"
  | "output"
  | "bidir"
  | "passive"
  | "power-in"
  | "power-out"
  | "open-collector"
  | "no-connect";

export type PinDir = "l" | "r" | "u" | "d";

export interface PinDef {
  /** Stable id used by SPICE pinOrder (e.g. "a", "k", "g", "s"). */
  readonly id: string;
  readonly name: string;
  readonly num: string;
  /** Pin connection end (on grid), local to the symbol origin. */
  readonly x: number;
  readonly y: number;
  /** Direction the pin line points *away from the body* toward its end. */
  readonly dir: PinDir;
  readonly etype: PinEType;
  readonly len?: number;
  /** Hidden power pins participate in connectivity but render no line/name. */
  readonly hidden?: boolean;
}

/** Minimal vector shape language shared by every renderer + SVG export. */
export type Shape =
  | { readonly op: "line"; readonly pts: readonly Vec2[] }
  | {
      readonly op: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly op: "circle"; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly op: "arc";
      readonly x: number;
      readonly y: number;
      readonly r: number;
      readonly a0: number;
      readonly a1: number;
    }
  | { readonly op: "poly"; readonly pts: readonly Vec2[] }
  | { readonly op: "dot"; readonly x: number; readonly y: number };

export interface SymbolGraphics {
  readonly shapes: readonly Shape[];
  /** "none" | body fill in background color | solid body fill */
  readonly fill?: "none" | "bg" | "fg";
}

export interface SymbolUnit {
  /** "A", "B", … — for multi-unit symbols; single-unit symbols use "A". */
  readonly name: string;
  /** Pin ids belonging to this unit (in electrical order). */
  readonly pins: readonly string[];
  readonly graphics: SymbolGraphics;
  /** Display name drawn on the body (e.g. "A"); undefined for anonymous. */
  readonly label?: string;
}

export interface FieldDef {
  readonly key: string;
  readonly label: string;
  /** Rendered on canvas next to the body when true. */
  readonly onCanvas: boolean;
  readonly defaultText: string;
  /** Field anchor, local to origin; flips with the instance. */
  readonly x: number;
  readonly y: number;
  /** Keep readable on rotated/mirrored instances (master §9.6). */
  readonly upright?: boolean;
}

export interface PropDef {
  readonly key: string;
  readonly kind: "number" | "string" | "enum";
  readonly default: string;
  readonly unit?: string;
  readonly options?: readonly string[];
  readonly label: string;
}

export interface SpiceMapping {
  readonly prefix: string;
  /** Pin ids in SPICE card order (netlist extraction uses this). */
  readonly pinOrder: readonly string[];
  /** Extra card emitted alongside the template (e.g. switch control source). */
  readonly extraTemplate?: string;
  /** Unconnected pin → fall back to this pin's net (e.g. MOSFET bulk → source). */
  readonly tie?: Readonly<Record<string, string>>;
  /** Rename the attached net (power ports, labels); "{net}" = net property. */
  readonly netAlias?: string;
  /**
   * Card template. Substitutions: {ref}, {value}, {model}, {p:<pinId>} →
   * node name, {prop:<key>} → property. Omitting a template means the
   * element is purely graphical (labels, text, probes).
   */
  readonly template?: string;
}

export interface InteractiveSpec {
  readonly kind: "switch" | "button" | "pot" | "led";
  /** Extra state (e.g. pot travel 0–1) consumed by live mode (§9.7). */
  readonly params?: readonly string[];
}

export interface SymbolDef {
  readonly id: string;
  readonly name: string;
  readonly category:
    | "Passive"
    | "Sources"
    | "Diodes"
    | "Transistors"
    | "ICs"
    | "Switches"
    | "Logic"
    | "Power"
    | "Blocks"
    | "Annotations";
  readonly standards: { readonly ansi: SymbolGraphics; readonly iec?: SymbolGraphics };
  readonly units: readonly SymbolUnit[];
  readonly pins: readonly PinDef[];
  readonly fields: readonly FieldDef[];
  readonly properties: readonly PropDef[];
  readonly spice: SpiceMapping;
  readonly keywords: readonly string[];
  readonly interactive?: InteractiveSpec;
  /** Per-unit symbol body bounds (local, untransformed) for hit-testing. */
  readonly bounds?: Rect;
}

/** One placed symbol on the sheet. */
export interface SymbolInstance {
  readonly id: string;
  readonly defId: string;
  /** Which unit of a multi-unit symbol this instance shows ("A" default). */
  readonly unit?: string;
  readonly x: number;
  readonly y: number;
  /** Quarter turns, clockwise (0–3). */
  readonly rot: 0 | 1 | 2 | 3;
  readonly mirrorX: boolean;
  readonly fields: Readonly<Record<string, string>>;
  readonly props: Readonly<Record<string, string>>;
  /** Interactive state snapshot (switch on?, pot travel). */
  readonly state?: Readonly<Record<string, number>>;
}

export interface Wire {
  readonly id: string;
  /** Polyline points, in order; ≥ 2; axis-aligned or free-angle per mode. */
  readonly pts: readonly Vec2[];
}

/** Explicit junction dot (derived ones are computed, not stored). */
export interface Junction {
  readonly id: string;
  readonly at: Vec2;
}

export type LabelKind = "local" | "global" | "power" | "hier";

export interface NetLabel {
  readonly id: string;
  readonly kind: LabelKind;
  readonly text: string;
  /** Anchored on a wire point or pin. */
  readonly at: Vec2;
  readonly rot: 0 | 1 | 2 | 3;
}

export interface TextNote {
  readonly id: string;
  readonly text: string;
  readonly at: Vec2;
  readonly size: "sm" | "md" | "lg";
}

export interface NoConnectFlag {
  readonly id: string;
  readonly at: Vec2;
}

export interface SchematicDoc {
  /** Monotonic counter bump on any edit (incremental connectivity cache). */
  readonly rev: number;
  readonly title: string;
  readonly symbols: readonly SymbolInstance[];
  readonly wires: readonly Wire[];
  readonly junctions: readonly Junction[];
  readonly labels: readonly NetLabel[];
  readonly texts: readonly TextNote[];
  readonly noConnects: readonly NoConnectFlag[];
  readonly grid: number;
  readonly nextId: number;
}

export const emptyDoc = (title = "Untitled"): SchematicDoc => ({
  rev: 0,
  title,
  symbols: [],
  wires: [],
  junctions: [],
  labels: [],
  texts: [],
  noConnects: [],
  grid: 500,
  nextId: 1,
});

export type EditableKind = "symbol" | "wire" | "label" | "text" | "noConnect" | "junction";

export interface Selection {
  readonly symbols: ReadonlySet<string>;
  readonly wires: ReadonlySet<string>;
  readonly labels: ReadonlySet<string>;
  readonly texts: ReadonlySet<string>;
  readonly noConnects: ReadonlySet<string>;
}

export const emptySelection = (): Selection => ({
  symbols: new Set(),
  wires: new Set(),
  labels: new Set(),
  texts: new Set(),
  noConnects: new Set(),
});

export const selectionSize = (s: Selection): number =>
  s.symbols.size + s.wires.size + s.labels.size + s.texts.size + s.noConnects.size;

/** Allocate the next doc-unique id ("r12", "w7", …). */
export function allocId(doc: SchematicDoc, prefix: string): { id: string; nextId: number } {
  const id = `${prefix}${doc.nextId}`;
  return { id, nextId: doc.nextId + 1 };
}
