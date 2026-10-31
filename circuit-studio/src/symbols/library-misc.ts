/**
 * Symbol library part 3 — Switches, Logic (behavioral analog), Power ports,
 * Annotations (master §9.5 labels, §9.6, §9.7 interactive components).
 * Switches emit S-cards with synthesized control sources; logic gates emit
 * B-cards (engine supports if/min/max/limit).
 */
import {
  arc,
  circle,
  def,
  deg,
  fieldRef,
  fieldValue,
  gfx,
  line,
  pin,
  poly,
  prop,
  rect,
  spice,
} from "./builders.ts";

// ── Logic (behavioral analog gates) ────────────────────────────────────────

const gatePins = [
  pin("a", "A", "1", -1000, -500, "l", "input"),
  pin("b", "B", "2", -1000, 500, "l", "input"),
  pin("out", "Y", "3", 1000, 0, "r", "output"),
];

const gateLevels = (): readonly ReturnType<typeof prop>[] => [
  prop("voh", "5", "Output high", "number", "V"),
  prop("vol", "0", "Output low", "number", "V"),
  prop("vh", "2.5", "Threshold", "number", "V"),
];

const gateCard = (expr: string): string => `B{ref} {p:out} 0 V = ${expr}`;

export const G_BUF = def({
  id: "G_BUF",
  name: "Buffer",
  category: "Logic",
  gfx: gfx([
    poly([-500, -500], [-500, 500], [500, 0]),
    line([-1000, 0], [-500, 0]),
    line([500, 0], [1000, 0]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l", "input"), pin("out", "Y", "2", 1000, 0, "r", "output")],
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice("B", ["a", "out"], gateCard("V({p:a})")),
  keywords: ["buffer", "gate", "logic"],
});

export const G_INV = def({
  id: "G_INV",
  name: "Inverter",
  category: "Logic",
  gfx: gfx([
    poly([-500, -500], [-500, 500], [500, 0]),
    circle(575, 0, 75),
    line([-1000, 0], [-500, 0]),
    line([650, 0], [1000, 0]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l", "input"), pin("out", "Y", "2", 1000, 0, "r", "output")],
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice("B", ["a", "out"], gateCard("if(V({p:a}) > {prop:vh}, {prop:vol}, {prop:voh})")),
  keywords: ["inverter", "not", "gate", "logic"],
});

export const G_AND = def({
  id: "G_AND",
  name: "AND gate",
  category: "Logic",
  gfx: gfx([
    line([-500, -500], [-100, -500]),
    arc(-100, 0, 500, deg(-90), deg(90)),
    line([-100, 500], [-500, 500]),
    line([-500, -500], [-500, 500]),
    line([400, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(min(V({p:a}),V({p:b})) > {prop:vh}, {prop:voh}, {prop:vol})"),
  ),
  keywords: ["and", "gate", "logic"],
});

export const G_OR = def({
  id: "G_OR",
  name: "OR gate",
  category: "Logic",
  gfx: gfx([
    line([-500, -500], [-150, -500]),
    arc(-350, 0, 590, deg(-47), deg(47)),
    arc(-150, 0, 500, deg(-55), deg(55)),
    line([-150, 500], [-500, 500]),
    line([-500, -500], [-500, 500]),
    line([350, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(max(V({p:a}),V({p:b})) > {prop:vh}, {prop:voh}, {prop:vol})"),
  ),
  keywords: ["or", "gate", "logic"],
});

export const G_NAND = def({
  id: "G_NAND",
  name: "NAND gate",
  category: "Logic",
  gfx: gfx([
    line([-500, -500], [-100, -500]),
    arc(-100, 0, 500, deg(-90), deg(90)),
    line([-100, 500], [-500, 500]),
    line([-500, -500], [-500, 500]),
    circle(475, 0, 75),
    line([550, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(min(V({p:a}),V({p:b})) > {prop:vh}, {prop:vol}, {prop:voh})"),
  ),
  keywords: ["nand", "gate", "logic"],
});

export const G_NOR = def({
  id: "G_NOR",
  name: "NOR gate",
  category: "Logic",
  gfx: gfx([
    line([-500, -500], [-150, -500]),
    arc(-350, 0, 590, deg(-47), deg(47)),
    arc(-150, 0, 500, deg(-55), deg(55)),
    line([-150, 500], [-500, 500]),
    line([-500, -500], [-500, 500]),
    circle(425, 0, 75),
    line([500, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(max(V({p:a}),V({p:b})) > {prop:vh}, {prop:vol}, {prop:voh})"),
  ),
  keywords: ["nor", "gate", "logic"],
});

export const G_XOR = def({
  id: "G_XOR",
  name: "XOR gate",
  category: "Logic",
  gfx: gfx([
    line([-600, -500], [-300, -500]),
    arc(-450, 0, 590, deg(-47), deg(47)),
    arc(-250, 0, 590, deg(-47), deg(47)),
    arc(-150, 0, 500, deg(-55), deg(55)),
    line([-150, 500], [-300, 500]),
    line([-300, -500], [-300, 500]),
    line([350, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(sgn(V({p:a}) - {prop:vh}) != sgn(V({p:b}) - {prop:vh}), {prop:voh}, {prop:vol})"),
  ),
  keywords: ["xor", "gate", "logic"],
});

export const G_XNOR = def({
  id: "G_XNOR",
  name: "XNOR gate",
  category: "Logic",
  gfx: gfx([
    line([-600, -500], [-300, -500]),
    arc(-450, 0, 590, deg(-47), deg(47)),
    arc(-250, 0, 590, deg(-47), deg(47)),
    arc(-150, 0, 500, deg(-55), deg(55)),
    line([-150, 500], [-300, 500]),
    line([-300, -500], [-300, 500]),
    circle(425, 0, 75),
    line([500, 0], [1000, 0]),
  ]),
  pins: gatePins,
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: gateLevels(),
  spice: spice(
    "B",
    gatePins.map((p) => p.id),
    gateCard("if(sgn(V({p:a}) - {prop:vh}) == sgn(V({p:b}) - {prop:vh}), {prop:voh}, {prop:vol})"),
  ),
  keywords: ["xnor", "gate", "logic"],
});

// ── Power ports (net aliases: ground = "0") ───────────────────────────────

const powerPort = (
  id: string,
  name: string,
  text: string,
  shapes: readonly ReturnType<typeof line>[],
  keywords: readonly string[],
): ReturnType<typeof def> =>
  def({
    id,
    name,
    category: "Power",
    gfx: gfx(shapes),
    pins: [pin("g", text, "1", 0, 0, "d", "power-out")],
    fields: [fieldValue(text, "net", -350)],
    props: [prop("net", text, "Net name", "string")],
    spice: spice("PWR", ["g"], undefined, { netAlias: "{net}" }),
    keywords,
  });

export const GND = powerPort(
  "GND",
  "Ground",
  "GND",
  [line([-500, 0], [500, 0]), line([-300, -250], [300, -250]), line([-100, -500], [100, -500])],
  ["ground", "gnd", "earth", "0"],
);

export const VCC_PORT = powerPort(
  "VCC",
  "VCC rail",
  "VCC",
  [line([-350, -250], [0, -550], [350, -250]), line([0, -550], [0, 0])],
  ["vcc", "rail", "power"],
);

export const VDD_PORT = powerPort(
  "VDD",
  "VDD rail",
  "VDD",
  [line([-350, -250], [0, -550], [350, -250]), line([0, -550], [0, 0])],
  ["vdd", "rail", "power"],
);

export const VSS_PORT = powerPort(
  "VSS",
  "VSS rail",
  "VSS",
  [line([-350, 0], [0, -250], [350, 0]), line([0, -250], [0, 0])],
  ["vss", "rail", "power"],
);

export const VEE_PORT = powerPort(
  "VEE",
  "VEE rail",
  "VEE",
  [line([-350, 0], [0, -250], [350, 0]), line([0, -250], [0, 0])],
  ["vee", "rail", "power"],
);

export const P5V = powerPort(
  "P5V",
  "+5 V rail",
  "+5V",
  [line([-350, -250], [0, -550], [350, -250]), line([0, -550], [0, 0])],
  ["5v", "rail", "power"],
);

export const P3V3 = powerPort(
  "P3V3",
  "+3.3 V rail",
  "+3V3",
  [line([-350, -250], [0, -550], [350, -250]), line([0, -550], [0, 0])],
  ["3v3", "rail", "power"],
);

// ── Annotations ───────────────────────────────────────────────────────────

export const NET_LABEL = def({
  id: "NET_LABEL",
  name: "Net label",
  category: "Annotations",
  gfx: gfx([poly([-400, -250], [300, -250], [400, 0], [300, 250], [-400, 250])]),
  pins: [pin("g", "", "1", 0, 0, "d", "passive")],
  fields: [fieldValue("NET", "net", 0)],
  props: [prop("net", "NET", "Net name", "string")],
  spice: spice("LBL", ["g"], undefined, { netAlias: "{net}" }),
  keywords: ["label", "net", "name"],
});

export const GLOB_LABEL = def({
  id: "GLOB_LABEL",
  name: "Global label",
  category: "Annotations",
  gfx: gfx([rect(-400, -250, 800, 500)]),
  pins: [pin("g", "", "1", 0, 0, "d", "passive")],
  fields: [fieldValue("GNET", "net", 0)],
  props: [prop("net", "GNET", "Net name", "string")],
  spice: spice("GBL", ["g"], undefined, { netAlias: "{net}" }),
  keywords: ["label", "global", "net"],
});

export const HIER_LABEL = def({
  id: "HIER_LABEL",
  name: "Hierarchical label",
  category: "Annotations",
  gfx: gfx([poly([-400, -250], [400, -250], [400, 250], [-400, 250])]),
  pins: [pin("g", "", "1", 0, 0, "d", "passive")],
  fields: [fieldValue("HNET", "net", 0)],
  props: [prop("net", "HNET", "Net name", "string")],
  spice: spice("HBL", ["g"], undefined, { netAlias: "{net}" }),
  keywords: ["label", "hierarchical", "sheet"],
});

export const TEXT = def({
  id: "TEXT",
  name: "Text",
  category: "Annotations",
  gfx: gfx([]),
  pins: [],
  fields: [fieldValue("Text", "text", 0)],
  props: [
    prop("text", "Text", "Text", "string"),
    prop("size", "md", "Size", "enum", undefined, ["sm", "md", "lg"]),
  ],
  spice: spice("TXT", [], undefined),
  keywords: ["text", "note", "comment"],
});

export const PROBE_V = def({
  id: "PROBE_V",
  name: "Voltage probe",
  category: "Annotations",
  gfx: gfx([
    circle(0, -450, 350),
    line([0, -100], [0, 0]),
    poly([-150, -250], [0, -100], [150, -250]),
  ]),
  pins: [pin("g", "V", "1", 0, 0, "d", "input")],
  fields: [fieldValue("V", "channel", 0)],
  props: [prop("channel", "V", "Channel", "string")],
  spice: spice("PRB", ["g"], undefined),
  keywords: ["probe", "voltage", "scope"],
});

export const PROBE_I = def({
  id: "PROBE_I",
  name: "Current probe",
  category: "Annotations",
  gfx: gfx([
    circle(0, -450, 350),
    line([0, -100], [0, 0]),
    poly([120, -580], [220, -470], [180, -350]),
    poly([-120, -320], [-220, -430], [-180, -550]),
  ]),
  pins: [pin("g", "I", "1", 0, 0, "d", "input")],
  fields: [fieldValue("I", "channel", 0)],
  props: [prop("channel", "I", "Channel", "string")],
  spice: spice("PRB", ["g"], undefined),
  keywords: ["probe", "current", "clamp"],
});

export const NOCONN = def({
  id: "NOCONN",
  name: "No-connect flag",
  category: "Annotations",
  gfx: gfx([line([-300, -300], [300, 300]), line([-300, 300], [300, -300])]),
  pins: [pin("g", "X", "1", 0, 0, "d", "no-connect")],
  fields: [],
  props: [],
  spice: spice("NC", ["g"], undefined),
  keywords: ["no connect", "dangling", "erc"],
});
