/**
 * Symbol library builders (master SPEC §9.6). Compact constructors keep the
 * ~70 definition files readable; all coordinates are integer units (0.1 mil)
 * on the 500-unit (50 mil) grid, pin ends at ±1000 (100 mil pin length).
 */
import type {
  FieldDef,
  PinDef,
  PinDir,
  PinEType,
  PropDef,
  Shape,
  SpiceMapping,
  SymbolDef,
  SymbolGraphics,
  SymbolUnit,
} from "../schematic/types.ts";

/** Pin whose connection end sits at (x, y), line drawn inward. */
export const pin = (
  id: string,
  name: string,
  num: string,
  x: number,
  y: number,
  dir: PinDir,
  etype: PinEType = "passive",
  opts: { readonly len?: number; readonly hidden?: boolean } = {},
): PinDef => ({ id, name, num, x, y, dir, etype, ...opts });

export const line = (...pts: readonly (readonly [number, number])[]): Shape => ({
  op: "line",
  pts: pts.map(([x, y]) => ({ x, y })),
});
export const rect = (x: number, y: number, w: number, h: number): Shape => ({
  op: "rect",
  x,
  y,
  w,
  h,
});
export const circle = (x: number, y: number, r: number): Shape => ({ op: "circle", x, y, r });
export const arc = (x: number, y: number, r: number, a0: number, a1: number): Shape => ({
  op: "arc",
  x,
  y,
  r,
  a0,
  a1,
});
export const poly = (...pts: readonly (readonly [number, number])[]): Shape => ({
  op: "poly",
  pts: pts.map(([x, y]) => ({ x, y })),
});
export const dot = (x: number, y: number): Shape => ({ op: "dot", x, y });
export const deg = (d: number): number => (d * Math.PI) / 180;

export const gfx = (
  shapes: readonly Shape[],
  fill: SymbolGraphics["fill"] = "none",
): SymbolGraphics => ({
  shapes,
  fill,
});

/** Standard two-pin passive: pins at (±1000, 0), body between ±500. */
export const twoPins = (a = "a", b = "b"): readonly PinDef[] => [
  pin(a, a.toUpperCase(), "1", -1000, 0, "l"),
  pin(b, b.toUpperCase(), "2", 1000, 0, "r"),
];

export const fieldRef = (key = "reference", def = ""): FieldDef => ({
  key,
  label: "Reference",
  onCanvas: true,
  defaultText: def,
  x: 0,
  y: -700,
  upright: true,
});
export const fieldValue = (text: string, key = "value", y = 700): FieldDef => ({
  key,
  label: "Value",
  onCanvas: true,
  defaultText: text,
  x: 0,
  y,
  upright: true,
});

export const prop = (
  key: string,
  def: string,
  label: string,
  kind: PropDef["kind"] = "string",
  unit?: string,
  options?: readonly string[],
): PropDef => ({
  key,
  kind,
  default: def,
  label,
  ...(unit === undefined ? {} : { unit }),
  ...(options === undefined ? {} : { options }),
});

export const spice = (
  prefix: string,
  pinOrder: readonly string[],
  template?: string,
  extra?: {
    readonly extraTemplate?: string;
    readonly tie?: Readonly<Record<string, string>>;
    readonly netAlias?: string;
  },
): SpiceMapping => ({
  prefix,
  pinOrder,
  ...(template === undefined ? {} : { template }),
  ...(extra?.extraTemplate === undefined ? {} : { extraTemplate: extra.extraTemplate }),
  ...(extra?.tie === undefined ? {} : { tie: extra.tie }),
  ...(extra?.netAlias === undefined ? {} : { netAlias: extra.netAlias }),
});

export interface DefExtras {
  readonly iec?: SymbolGraphics;
  readonly keywords?: readonly string[];
  readonly units?: readonly SymbolUnit[];
  readonly bounds?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** Assemble a definition with the common defaults filled in. */
export function def(d: {
  readonly id: string;
  readonly name: string;
  readonly category: SymbolDef["category"];
  readonly gfx: SymbolGraphics;
  readonly pins: readonly PinDef[];
  readonly fields?: readonly FieldDef[];
  readonly props?: readonly PropDef[];
  readonly spice: SpiceMapping;
  readonly keywords?: readonly string[];
  readonly iec?: SymbolGraphics;
  readonly units?: readonly SymbolUnit[];
  readonly interactive?: SymbolDef["interactive"];
}): SymbolDef {
  const xs = d.pins.filter((p) => !p.hidden).map((p) => p.x);
  const ys = d.pins.filter((p) => !p.hidden).map((p) => p.y);
  const minX = Math.min(...xs, -500);
  const maxX = Math.max(...xs, 500);
  const minY = Math.min(...ys, -500);
  const maxY = Math.max(...ys, 500);
  const units: readonly SymbolUnit[] = d.units ?? [
    { name: "A", pins: d.pins.map((p) => p.id), graphics: d.gfx },
  ];
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    standards: { ansi: d.gfx, ...(d.iec === undefined ? {} : { iec: d.iec }) },
    units,
    pins: d.pins,
    fields: d.fields ?? [],
    properties: d.props ?? [],
    spice: d.spice,
    keywords: d.keywords ?? [],
    ...(d.interactive === undefined ? {} : { interactive: d.interactive }),
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

/** IEEE zigzag resistor body between x ∈ [-500, 500]. */
export const zigzag = (): SymbolGraphics =>
  gfx([
    line([-1000, 0], [-500, 0]),
    line([-500, 0], [-400, -250], [-200, 250], [0, -250], [200, 250], [400, -250], [500, 0]),
    line([500, 0], [1000, 0]),
  ]);

/** IEC rectangle resistor body. */
export const boxResistor = (): SymbolGraphics =>
  gfx([line([-1000, 0], [-500, 0]), rect(-500, -250, 1000, 500), line([500, 0], [1000, 0])]);

/** Non-polarized capacitor plates. */
export const capPlates = (): SymbolGraphics =>
  gfx([
    line([-1000, 0], [-150, 0]),
    line([150, 0], [1000, 0]),
    line([-150, -400], [-150, 400]),
    line([150, -400], [150, 400]),
  ]);

/** Inductor arcs (4 semicircles across the body). */
export const coilArcs = (): readonly Shape[] => [
  line([-1000, 0], [-500, 0]),
  arc(-375, 0, 125, deg(180), deg(360)),
  arc(-125, 0, 125, deg(180), deg(360)),
  arc(125, 0, 125, deg(180), deg(360)),
  arc(375, 0, 125, deg(180), deg(360)),
  line([500, 0], [1000, 0]),
];

/** Circle + lead shared by sources. */
export const sourceCircle = (): readonly Shape[] => [circle(0, 0, 400)];

/** N- and P- channel MOSFET transistor graphics (simplified classic). */
export const mosfetBody = (pmos: boolean): SymbolGraphics => {
  const arrow = pmos
    ? [poly([0, -180], [0, -320], [120, -250])]
    : [poly([120, -180], [120, -320], [0, -250])];
  return gfx([
    line([-1000, -400], [-400, -400]),
    line([-400, -400], [-400, 400]),
    line([-400, -600], [300, -600]),
    line([300, -600], [300, -900]),
    line([300, -900], [1000, -900]),
    line([-400, 0], [300, 0]),
    line([300, 0], [300, -900]),
    line([300, 600], [300, 0]),
    line([300, 600], [1000, 600]),
    ...arrow,
  ]);
};
