/**
 * Symbol library part 2 — Diodes, Transistors, ICs (master §9.6).
 * Hidden bulk pins tie to the source in netlist extraction (SpiceMapping.tie).
 */
import {
  circle,
  def,
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

// ── Diodes ─────────────────────────────────────────────────────────────────

const diodeGfx = (): ReturnType<typeof gfx> =>
  gfx([
    line([-1000, 0], [-300, 0]),
    poly([-300, -350], [-300, 350], [300, 0]),
    line([300, -350], [300, 350]),
    line([300, 0], [1000, 0]),
  ]);

const diodePins = [pin("a", "A", "1", -1000, 0, "l"), pin("k", "K", "2", 1000, 0, "r")];

export const D = def({
  id: "D",
  name: "Diode",
  category: "Diodes",
  gfx: diodeGfx(),
  pins: diodePins,
  fields: [fieldRef("reference", "D"), fieldValue("d_ideal")],
  props: [prop("model", "d_ideal", "Model", "enum", undefined, ["d_ideal", "d_signal"])],
  spice: spice("D", ["a", "k"], "{ref} {p:a} {p:k} {model}"),
  keywords: ["diode", "rectifier"],
});

export const D_LED = def({
  id: "D_LED",
  name: "LED",
  category: "Diodes",
  gfx: gfx([
    line([-1000, 0], [-300, 0]),
    poly([-300, -350], [-300, 350], [300, 0]),
    line([300, -350], [300, 350]),
    line([300, 0], [1000, 0]),
    poly([-50, -450], [50, -550]),
    poly([-250, -430], [-150, -530]),
    poly([80, -470], [150, -590], [30, -560]),
    poly([-120, -450], [-50, -570], [-150, -540]),
  ]),
  pins: diodePins,
  fields: [fieldRef("reference", "D"), fieldValue("d_signal")],
  props: [prop("model", "d_signal", "Model", "enum", undefined, ["d_signal", "d_ideal"])],
  spice: spice("D", ["a", "k"], "{ref} {p:a} {p:k} {model}"),
  keywords: ["led", "light", "emitting"],
  interactive: { kind: "led" },
});

export const D_Z = def({
  id: "D_Z",
  name: "Zener diode",
  category: "Diodes",
  gfx: gfx([
    line([-1000, 0], [-300, 0]),
    poly([-300, -350], [-300, 350], [300, 0]),
    line([300, -350], [300, 350]),
    line([300, -350], [450, -350]),
    line([300, 0], [1000, 0]),
  ]),
  pins: diodePins,
  fields: [fieldRef("reference", "D"), fieldValue("d_signal")],
  props: [prop("model", "d_signal", "Model", "enum", undefined, ["d_signal", "d_ideal"])],
  spice: spice("D", ["a", "k"], "{ref} {p:a} {p:k} {model}"),
  keywords: ["zener", "reference", "clamp"],
});

export const D_SCH = def({
  id: "D_SCH",
  name: "Schottky diode",
  category: "Diodes",
  gfx: gfx([
    line([-1000, 0], [-300, 0]),
    poly([-300, -350], [-300, 350], [200, 0]),
    line([200, -350], [200, 350]),
    line([200, -350], [400, -350]),
    line([200, 350], [400, 350]),
    line([400, 0], [1000, 0]),
  ]),
  pins: diodePins,
  fields: [fieldRef("reference", "D"), fieldValue("d_ideal")],
  props: [prop("model", "d_ideal", "Model", "enum", undefined, ["d_ideal", "d_signal"])],
  spice: spice("D", ["a", "k"], "{ref} {p:a} {p:k} {model}"),
  keywords: ["schottky", "fast diode"],
});

export const D_BRIDGE = def({
  id: "D_BRIDGE",
  name: "Bridge rectifier",
  category: "Diodes",
  gfx: gfx([
    poly([0, -700], [700, 0], [0, 700], [-700, 0]),
    poly([-350, -350], [-180, -180]),
    poly([350, -350], [180, -180]),
    poly([-350, 350], [-180, 180]),
    poly([350, 350], [180, 180]),
    poly([-180, -180], [-180, -350], [-180, -180], [-350, -180]),
    poly([180, -180], [180, -350], [180, -180], [350, -180]),
    poly([-180, 180], [-180, 350], [-180, 180], [-350, 180]),
    poly([180, 180], [180, 350], [180, 180], [350, 180]),
  ]),
  pins: [
    pin("ac1", "~", "1", -1000, -1000, "l"),
    pin("p", "+", "2", 1000, -1000, "r"),
    pin("ac2", "~", "3", 1000, 1000, "r"),
    pin("n", "−", "4", -1000, 1000, "l"),
  ],
  fields: [fieldRef("reference", "D"), fieldValue("d_signal")],
  props: [prop("model", "d_signal", "Model", "enum", undefined, ["d_signal", "d_ideal"])],
  spice: spice(
    "DBR",
    ["ac1", "p", "ac2", "n"],
    "{ref}1 {p:ac1} {p:p} {model}\nD {ref}2 {p:ac2} {p:p} {model}\nD {ref}3 {p:n} {p:ac1} {model}\nD {ref}4 {p:n} {p:ac2} {model}",
  ),
  keywords: ["bridge", "rectifier", "full wave"],
});

export const D_TVS = def({
  id: "D_TVS",
  name: "TVS diode",
  category: "Diodes",
  gfx: gfx([
    line([-1000, 0], [-300, 0]),
    poly([-300, -350], [-300, 350], [300, 0]),
    line([300, -350], [300, 350]),
    line([-300, -350], [-450, -350]),
    line([-300, 350], [-450, 350]),
    line([300, 0], [1000, 0]),
  ]),
  pins: diodePins,
  fields: [fieldRef("reference", "D"), fieldValue("d_signal")],
  props: [prop("model", "d_signal", "Model", "enum", undefined, ["d_signal", "d_ideal"])],
  spice: spice("D", ["a", "k"], "{ref} {p:a} {p:k} {model}"),
  keywords: ["tvs", "transient", "suppression"],
});

// ── Transistors ────────────────────────────────────────────────────────────

const bjtBody = (npn: boolean): ReturnType<typeof gfx> =>
  gfx([
    circle(0, 0, 700),
    line([-1000, -500], [-350, -500]),
    line([-350, -750], [-350, 750]),
    line([-1000, 500], [-350, 500]),
    line([-350, -500], [350, -500]),
    line([350, -500], [350, -800]),
    line([-350, 350], [300, 750]),
    line([300, 750], [1000, 750]),
    ...(npn
      ? [poly([-350, 500], [-470, 400], [-420, 540])]
      : [poly([-470, 540], [-350, 500], [-420, 400])]),
  ]);

const bjtPins = [
  pin("c", "C", "1", -1000, -500, "l"),
  pin("b", "B", "2", -1000, 500, "l"),
  pin("e", "E", "3", 1000, 750, "r"),
];

export const Q_NPN = def({
  id: "Q_NPN",
  name: "NPN transistor",
  category: "Transistors",
  gfx: bjtBody(true),
  pins: bjtPins,
  fields: [fieldRef("reference", "Q"), fieldValue("npn_generic")],
  props: [prop("model", "npn_generic", "Model", "enum", undefined, ["npn_generic"])],
  spice: spice("Q", ["c", "b", "e"], "{ref} {p:c} {p:b} {p:e} {model}"),
  keywords: ["npn", "bjt", "transistor"],
});

export const Q_PNP = def({
  id: "Q_PNP",
  name: "PNP transistor",
  category: "Transistors",
  gfx: bjtBody(false),
  pins: bjtPins,
  fields: [fieldRef("reference", "Q"), fieldValue("pnp_generic")],
  props: [prop("model", "pnp_generic", "Model", "enum", undefined, ["pnp_generic"])],
  spice: spice("Q", ["c", "b", "e"], "{ref} {p:c} {p:b} {p:e} {model}"),
  keywords: ["pnp", "bjt", "transistor"],
});

/** Grid-aligned simplified MOSFET: gate plate at x=0, channel at x=250. */
const mosfetBody = (pmos: boolean): ReturnType<typeof gfx> => {
  const arrow = pmos
    ? [poly([520, -40], [520, -180], [640, -110])]
    : [poly([640, -40], [640, -180], [520, -110])];
  return gfx([
    line([-1000, 0], [0, 0]),
    line([0, -700], [0, 700]),
    line([250, -750], [250, 750]),
    line([250, -500], [1000, -500]),
    line([250, 500], [1000, 500]),
    line([250, 0], [640, 0]),
    ...arrow,
  ]);
};

const mosPins = [
  pin("d", "D", "1", 1000, -500, "r"),
  pin("g", "G", "2", -1000, 0, "l"),
  pin("s", "S", "3", 1000, 500, "r"),
  pin("b", "B", "4", 1000, 500, "r", "passive", { hidden: true }),
];

export const M_NMOS = def({
  id: "M_NMOS",
  name: "N-channel MOSFET",
  category: "Transistors",
  gfx: mosfetBody(false),
  pins: mosPins,
  fields: [fieldRef("reference", "M"), fieldValue("nmos_5v")],
  props: [prop("model", "nmos_5v", "Model", "enum", undefined, ["nmos_5v", "nmos_4000"])],
  spice: spice("M", ["d", "g", "s", "b"], "{ref} {p:d} {p:g} {p:s} {p:b} {model}", {
    tie: { b: "s" },
  }),
  keywords: ["mosfet", "nmos", "n-channel", "transistor"],
});

export const M_PMOS = def({
  id: "M_PMOS",
  name: "P-channel MOSFET",
  category: "Transistors",
  gfx: mosfetBody(true),
  pins: mosPins,
  fields: [fieldRef("reference", "M"), fieldValue("pmos_5v")],
  props: [prop("model", "pmos_5v", "Model", "enum", undefined, ["pmos_5v"])],
  spice: spice("M", ["d", "g", "s", "b"], "{ref} {p:d} {p:g} {p:s} {p:b} {model}", {
    tie: { b: "s" },
  }),
  keywords: ["mosfet", "pmos", "p-channel", "transistor"],
});

const jfetBody = (njf: boolean): ReturnType<typeof gfx> =>
  gfx([
    circle(0, 0, 700),
    line([-1000, 0], [-350, 0]),
    line([-350, -600], [-350, 600]),
    line([-350, -500], [350, -500]),
    line([350, -500], [350, -800]),
    line([-350, 500], [350, 500]),
    line([350, 500], [350, 800]),
    ...(njf
      ? [poly([-350, 500], [-470, 400], [-420, 540])]
      : [poly([-470, 540], [-350, 500], [-420, 400])]),
  ]);

const jfetPins = [
  pin("d", "D", "1", 1000, -500, "r"),
  pin("g", "G", "2", -1000, 0, "l"),
  pin("s", "S", "3", 1000, 500, "r"),
];

export const J_NJF = def({
  id: "J_NJF",
  name: "N-channel JFET",
  category: "Transistors",
  gfx: jfetBody(true),
  pins: jfetPins,
  fields: [fieldRef("reference", "J"), fieldValue("njf_generic")],
  props: [prop("model", "njf_generic", "Model", "enum", undefined, ["njf_generic"])],
  spice: spice("J", ["d", "g", "s"], "{ref} {p:d} {p:g} {p:s} {model}"),
  keywords: ["jfet", "n-channel", "transistor"],
});

export const J_PJF = def({
  id: "J_PJF",
  name: "P-channel JFET",
  category: "Transistors",
  gfx: jfetBody(false),
  pins: jfetPins,
  fields: [fieldRef("reference", "J"), fieldValue("pjf_generic")],
  props: [prop("model", "pjf_generic", "Model", "enum", undefined, ["pjf_generic"])],
  spice: spice("J", ["d", "g", "s"], "{ref} {p:d} {p:g} {p:s} {model}"),
  keywords: ["jfet", "p-channel", "transistor"],
});

// ── ICs ────────────────────────────────────────────────────────────────────

export const OPAMP = def({
  id: "OPAMP",
  name: "Op-amp (ideal)",
  category: "ICs",
  gfx: gfx([
    poly([-500, -700], [-500, 700], [500, 0]),
    line([-1000, -500], [-500, -500]),
    line([-1000, 500], [-500, 500]),
    line([500, 0], [1000, 0]),
    line([-660, -500], [-460, -500]),
    line([-560, -600], [-560, -400]),
    line([-470, 250], [-300, 250]),
    line([-470, 250], [-470, 410]),
    line([-470, 410], [-300, 410]),
  ]),
  pins: [
    pin("inp", "IN+", "1", -1000, -500, "l", "input"),
    pin("inn", "IN−", "2", -1000, 500, "l", "input"),
    pin("out", "OUT", "3", 1000, 0, "r", "output"),
  ],
  fields: [fieldRef("reference", "U"), fieldValue("OPAMP_IDEAL")],
  props: [
    prop("model", "OPAMP_IDEAL", "Macromodel", "enum", undefined, ["OPAMP_IDEAL", "OPAMP1P"]),
  ],
  spice: spice("X", ["inp", "inn", "out"], "X{ref} {p:inp} {p:inn} {p:out} {model}"),
  keywords: ["opamp", "amplifier", "ideal", "operational"],
});

export const OPAMP_QUAD = def({
  id: "OPAMP_QUAD",
  name: "Quad op-amp",
  category: "ICs",
  gfx: gfx([
    poly([-500, -700], [-500, 700], [500, 0]),
    line([-1000, -500], [-500, -500]),
    line([-1000, 500], [-500, 500]),
    line([500, 0], [1000, 0]),
    line([-660, -500], [-460, -500]),
    line([-560, -600], [-560, -400]),
    line([-470, 250], [-300, 250]),
    line([-470, 250], [-470, 410]),
    line([-470, 410], [-300, 410]),
  ]),
  pins: [
    pin("inp", "IN+", "1", -1000, -500, "l", "input"),
    pin("inn", "IN−", "2", -1000, 500, "l", "input"),
    pin("out", "OUT", "3", 1000, 0, "r", "output"),
    pin("vcc", "V+", "4", 0, -1000, "u", "power-in", { hidden: true }),
    pin("vee", "V−", "5", 0, 1000, "d", "power-in", { hidden: true }),
  ],
  fields: [fieldRef("reference", "U"), fieldValue("OPAMP_IDEAL")],
  props: [
    prop("model", "OPAMP_IDEAL", "Macromodel", "enum", undefined, ["OPAMP_IDEAL", "OPAMP1P"]),
  ],
  spice: spice("X", ["inp", "inn", "out"], "X{ref} {p:inp} {p:inn} {p:out} {model}"),
  keywords: ["opamp", "quad", "lm324", "multi-unit"],
});

export const COMP = def({
  id: "COMP",
  name: "Comparator",
  category: "ICs",
  gfx: gfx([
    poly([-500, -700], [-500, 700], [500, 0]),
    line([-1000, -500], [-500, -500]),
    line([-1000, 500], [-500, 500]),
    line([500, 0], [1000, 0]),
    line([-660, -500], [-460, -500]),
    line([-560, -600], [-560, -400]),
    line([-600, 300], [-440, 300]),
    line([-600, 380], [-440, 380]),
    line([-600, 460], [-440, 460]),
  ]),
  pins: [
    pin("inp", "IN+", "1", -1000, -500, "l", "input"),
    pin("inn", "IN−", "2", -1000, 500, "l", "input"),
    pin("out", "OUT", "3", 1000, 0, "r", "output"),
  ],
  fields: [fieldRef("reference", "U"), fieldValue("5 0 2.5")],
  props: [
    prop("voh", "5", "Output high", "number", "V"),
    prop("vol", "0", "Output low", "number", "V"),
    prop("vtrip", "0", "Trip offset", "number", "V"),
  ],
  spice: spice(
    "B",
    ["inp", "inn", "out"],
    "B{ref} {p:out} 0 V = if(V({p:inp},{p:inn}) > {prop:vtrip}, {prop:voh}, {prop:vol})",
  ),
  keywords: ["comparator", "schmitt", "rail"],
});

export const T555 = def({
  id: "T555",
  name: "555 timer (subckt block)",
  category: "ICs",
  gfx: gfx([rect(-500, -750, 1000, 1500)]),
  pins: [
    pin("gnd", "GND", "1", 0, 1000, "d", "power-in"),
    pin("trig", "TRIG", "2", -1000, 500, "l", "input"),
    pin("out", "OUT", "3", 1000, 500, "r", "output"),
    pin("reset", "RST", "4", -1000, 250, "l", "input"),
    pin("ctrl", "CTL", "5", -1000, 0, "l", "input"),
    pin("thresh", "THR", "6", -1000, -250, "l", "input"),
    pin("disch", "DIS", "7", -1000, -500, "l", "input"),
    pin("vcc", "V+", "8", 0, -1000, "u", "power-in"),
  ],
  fields: [fieldRef("reference", "U"), fieldValue("T555")],
  props: [prop("model", "T555", "Subckt", "string")],
  spice: spice(
    "X",
    ["gnd", "trig", "out", "reset", "ctrl", "thresh", "disch", "vcc"],
    "X{ref} {p:gnd} {p:trig} {p:out} {p:reset} {p:ctrl} {p:thresh} {p:disch} {p:vcc} {model}",
  ),
  keywords: ["555", "timer", "astable", "monostable"],
});

export const REG7805 = def({
  id: "REG7805",
  name: "Linear regulator",
  category: "ICs",
  gfx: gfx([
    rect(-500, -700, 1000, 1400),
    line([-1000, -500], [-500, -500]),
    line([500, -500], [1000, -500]),
    line([0, 700], [0, 1000]),
    line([-350, -350], [-200, -350]),
    line([-350, -50], [-200, -50]),
    line([-350, 250], [-200, 250]),
  ]),
  pins: [
    pin("in", "IN", "1", -1000, -500, "l", "power-in"),
    pin("out", "OUT", "2", 1000, -500, "r", "power-out"),
    pin("gnd", "GND", "3", 0, 1000, "d", "power-in"),
  ],
  fields: [fieldRef("reference", "U"), fieldValue("5")],
  props: [prop("vout", "5", "Output voltage", "number", "V")],
  spice: spice("VREG", ["in", "out"], "V{ref} {p:in} {p:out} {prop:vout}", {
    extraTemplate: "R{ref}g {p:gnd} 0 1u",
  }),
  keywords: ["regulator", "7805", "ldo", "linear"],
});

export const SUBCKT = def({
  id: "SUBCKT",
  name: "Subcircuit block",
  category: "Blocks",
  gfx: gfx([rect(-700, -700, 1400, 1400)]),
  pins: [
    pin("n1", "1", "1", -1000, -500, "l", "bidir"),
    pin("n2", "2", "2", -1000, 0, "l", "bidir"),
    pin("n3", "3", "3", -1000, 500, "l", "bidir"),
    pin("n4", "4", "4", 1000, -500, "r", "bidir"),
    pin("n5", "5", "5", 1000, 0, "r", "bidir"),
    pin("n6", "6", "6", 1000, 500, "r", "bidir"),
  ],
  fields: [fieldRef("reference", "X"), fieldValue("MYSUB")],
  props: [prop("model", "MYSUB", "Subckt", "string")],
  spice: spice(
    "X",
    ["n1", "n2", "n3", "n4", "n5", "n6"],
    "X{ref} {p:n1} {p:n2} {p:n3} {p:n4} {p:n5} {p:n6} {model}",
  ),
  keywords: ["subckt", "block", "hierarchical", "black box"],
});
