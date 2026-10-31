/**
 * Symbol library part 1 — Passive, Sources, Power, Annotations (master
 * §9.6). Templates substitute {ref}, {p:<pinId>}, {value}, {model},
 * {prop:<key>}; the extraction engine owns the substitution rules.
 */
import {
  arc,
  boxResistor,
  capPlates,
  circle,
  coilArcs,
  def,
  deg,
  dot,
  fieldRef,
  fieldValue,
  gfx,
  line,
  pin,
  poly,
  prop,
  rect,
  sourceCircle,
  spice,
  zigzag,
} from "./builders.ts";

// ── Passive ────────────────────────────────────────────────────────────────

export const R = def({
  id: "R",
  name: "Resistor",
  category: "Passive",
  gfx: zigzag(),
  iec: boxResistor(),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "R"), fieldValue("1k")],
  props: [prop("value", "1k", "Resistance", "number", "Ω")],
  spice: spice("R", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["resistor", "ohm", "resistance"],
});

export const R_POT = def({
  id: "R_POT",
  name: "Potentiometer",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-500, 0]),
    line([-500, 0], [-400, -250], [-200, 250], [0, -250], [200, 250], [400, -250], [500, 0]),
    line([500, 0], [1000, 0]),
    line([0, 500], [0, 900]),
    poly([-120, 700], [0, 500], [120, 700]),
    line([0, 900], [0, 1000]),
  ]),
  pins: [
    pin("a", "A", "1", -1000, 0, "l"),
    pin("w", "W", "3", 0, 1000, "d"),
    pin("b", "B", "2", 1000, 0, "r"),
  ],
  fields: [fieldRef("reference", "RV"), fieldValue("10k")],
  props: [
    prop("value", "10k", "End-to-end", "number", "Ω"),
    prop("travel", "0.5", "Wiper 0–1", "number"),
  ],
  spice: spice("RPOT", ["a", "w", "b"], "{ref}a {p:a} {p:w} {value}", {
    extraTemplate: "{ref}b {p:w} {p:b} {value}",
  }),
  keywords: ["pot", "potentiometer", "wiper", "variable"],
  interactive: { kind: "pot", params: ["travel"] },
});

export const R_TRIM = def({
  id: "R_TRIM",
  name: "Trimmer resistor",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-500, 0]),
    rect(-500, -250, 1000, 500),
    line([500, 0], [1000, 0]),
    line([-250, -600], [250, -100]),
  ]),
  iec: gfx([line([-1000, 0], [-500, 0]), rect(-500, -250, 1000, 500), line([500, 0], [1000, 0])]),
  pins: [
    pin("a", "A", "1", -1000, 0, "l"),
    pin("w", "W", "3", 0, 500, "d", "passive", { hidden: true }),
    pin("b", "B", "2", 1000, 0, "r"),
  ],
  fields: [fieldRef("reference", "RT"), fieldValue("10k")],
  props: [
    prop("value", "10k", "End-to-end", "number", "Ω"),
    prop("travel", "0.5", "Wiper 0–1", "number"),
  ],
  spice: spice("RTRIM", ["a", "w", "b"], "{ref}a {p:a} {p:w} {value}", {
    extraTemplate: "{ref}b {p:w} {p:b} {value}",
  }),
  keywords: ["trimmer", "trimpot", "preset"],
});

export const C = def({
  id: "C",
  name: "Capacitor",
  category: "Passive",
  gfx: capPlates(),
  iec: gfx([line([-1000, 0], [-150, 0]), rect(-150, -400, 300, 800), line([150, 0], [1000, 0])]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "C"), fieldValue("100n")],
  props: [prop("value", "100n", "Capacitance", "number", "F")],
  spice: spice("C", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["capacitor", "cap", "farad"],
});

export const C_POL = def({
  id: "C_POL",
  name: "Polarized capacitor",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-150, 0]),
    line([150, 0], [1000, 0]),
    line([-150, -400], [-150, 400]),
    arc(250, 0, 420, deg(125), deg(235)),
    poly([-320, -520], [-180, -520]),
    poly([-320, -520], [-320, -380]),
  ]),
  pins: [pin("a", "P", "1", -1000, 0, "l"), pin("b", "N", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "C"), fieldValue("10u")],
  props: [prop("value", "10u", "Capacitance", "number", "F")],
  spice: spice("C", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["electrolytic", "polarized", "capacitor"],
});

export const C_TRIM = def({
  id: "C_TRIM",
  name: "Trimmer capacitor",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-150, 0]),
    line([150, 0], [1000, 0]),
    line([-150, -400], [-150, 400]),
    line([150, -400], [150, 400]),
    line([-250, -600], [250, -150]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "CT"), fieldValue("10p")],
  props: [prop("value", "10p", "Capacitance", "number", "F")],
  spice: spice("C", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["trimmer", "variable capacitor"],
});

export const L = def({
  id: "L",
  name: "Inductor",
  category: "Passive",
  gfx: gfx(coilArcs()),
  iec: gfx([line([-1000, 0], [-500, 0]), rect(-500, -250, 1000, 500), line([500, 0], [1000, 0])]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "L"), fieldValue("1m")],
  props: [prop("value", "1m", "Inductance", "number", "H")],
  spice: spice("L", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["inductor", "coil", "henry"],
});

export const L_CORE = def({
  id: "L_CORE",
  name: "Inductor with core",
  category: "Passive",
  gfx: gfx([...coilArcs(), line([-375, -450], [375, -450]), line([-375, -650], [375, -650])]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "L"), fieldValue("1m")],
  props: [prop("value", "1m", "Inductance", "number", "H")],
  spice: spice("L", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["inductor", "core", "choke"],
});

export const XFMR = def({
  id: "XFMR",
  name: "Transformer",
  category: "Passive",
  gfx: gfx([
    line([-1000, -750], [-500, -750]),
    arc(-375, -750, 125, deg(180), deg(360)),
    arc(-125, -750, 125, deg(180), deg(360)),
    arc(125, -750, 125, deg(180), deg(360)),
    line([375, -750], [1000, -750]),
    line([-1000, 750], [-500, 750]),
    arc(-375, 750, 125, deg(0), deg(180)),
    arc(-125, 750, 125, deg(0), deg(180)),
    arc(125, 750, 125, deg(0), deg(180)),
    arc(375, 750, 125, deg(0), deg(180)),
    line([500, 750], [1000, 750]),
    line([0, -500], [0, -250]),
    dot(0, -250),
    line([0, -250], [0, 250]),
    line([-150, 250], [150, 250]),
  ]),
  pins: [
    pin("a", "P1", "1", -1000, -750, "l"),
    pin("b", "P2", "2", 1000, -750, "r"),
    pin("c", "S1", "3", -1000, 750, "l"),
    pin("d", "S2", "4", 1000, 750, "r"),
  ],
  fields: [fieldRef("reference", "T"), fieldValue("1m 1m")],
  props: [
    prop("l1", "1m", "L1", "number", "H"),
    prop("l2", "1m", "L2", "number", "H"),
    prop("k", "0.99", "Coupling", "number"),
  ],
  spice: spice(
    "K",
    ["a", "b", "c", "d"],
    "L{ref}p {p:a} {p:b} {prop:l1}\nL{ref}s {p:c} {p:d} {prop:l2}\nK{ref} L{ref}p L{ref}s {prop:k}",
  ),
  keywords: ["transformer", "coupled", "primary", "secondary"],
});

export const FUSE = def({
  id: "FUSE",
  name: "Fuse",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-500, 0]),
    rect(-500, -200, 1000, 400),
    line([-500, 0], [500, 0]),
    line([500, 0], [1000, 0]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "F"), fieldValue("1")],
  props: [prop("value", "1", "Cold resistance", "number", "Ω")],
  spice: spice("R", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["fuse", "protection"],
});

export const LAMP = def({
  id: "LAMP",
  name: "Lamp",
  category: "Passive",
  gfx: gfx([
    line([-1000, 0], [-400, 0]),
    circle(0, 0, 400),
    poly([-180, 180], [0, 0], [180, 180], [0, 0], [-180, -180], [0, 0], [180, -180]),
    line([400, 0], [1000, 0]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "LAMP"), fieldValue("100")],
  props: [prop("value", "100", "Hot resistance", "number", "Ω")],
  spice: spice("R", ["a", "b"], "{ref} {p:a} {p:b} {value}"),
  keywords: ["lamp", "bulb", "light"],
});

// ── Sources ────────────────────────────────────────────────────────────────

const sourcePins = [
  pin("p", "+", "1", -1000, 0, "l", "power-out" as const),
  pin("n", "−", "2", 1000, 0, "r", "passive" as const),
];
const sourceFields = (v: string): readonly ReturnType<typeof fieldRef>[] => [
  fieldRef("reference", "V"),
  fieldValue(v),
];

export const V_DC = def({
  id: "V_DC",
  name: "DC voltage source",
  category: "Sources",
  gfx: gfx([...sourceCircle(), line([-250, 0], [250, 0]), poly([100, -150], [250, 0], [100, 150])]),
  pins: sourcePins,
  fields: sourceFields("5"),
  props: [prop("value", "5", "DC value", "number", "V")],
  spice: spice("V", ["p", "n"], "{ref} {p:p} {p:n} DC {value}"),
  keywords: ["dc", "voltage", "source", "supply"],
});

export const BATTERY = def({
  id: "BATTERY",
  name: "Battery",
  category: "Sources",
  gfx: gfx([
    line([-1000, 0], [-250, 0]),
    line([250, 0], [1000, 0]),
    line([-250, -350], [-250, 350]),
    line([-100, -180], [-100, 180]),
    line([100, -350], [100, 350]),
    line([250, -180], [250, 180]),
    poly([-420, -450], [-420, -580], [-300, -580]),
  ]),
  pins: sourcePins,
  fields: sourceFields("9"),
  props: [prop("value", "9", "EMF", "number", "V")],
  spice: spice("V", ["p", "n"], "{ref} {p:p} {p:n} DC {value}"),
  keywords: ["battery", "cell", "supply"],
});

export const V_SIN = def({
  id: "V_SIN",
  name: "Sine voltage source",
  category: "Sources",
  gfx: gfx([...sourceCircle(), poly([-200, 150], [0, -150], [200, 150], [200, 150])]),
  pins: sourcePins,
  fields: sourceFields("1k"),
  props: [
    prop("offset", "0", "Offset", "number", "V"),
    prop("amplitude", "1", "Amplitude", "number", "V"),
    prop("freq", "1k", "Frequency", "number", "Hz"),
  ],
  spice: spice(
    "V",
    ["p", "n"],
    "{ref} {p:p} {p:n} SIN({prop:offset} {prop:amplitude} {prop:freq})",
  ),
  keywords: ["sine", "ac", "signal", "source"],
});

export const V_GEN = def({
  id: "V_GEN",
  name: "Function generator",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    rect(-220, -160, 440, 320),
    poly([-160, 60], [-80, -60], [0, 60], [80, -60], [160, 60]),
  ]),
  pins: sourcePins,
  fields: sourceFields("1k"),
  props: [
    prop("wave", "SIN", "Waveform", "enum", undefined, [
      "SIN",
      "PULSE",
      "TRIANGLE",
      "SQUARE",
      "SAWTOOTH",
    ]),
    prop("offset", "0", "Offset", "number", "V"),
    prop("amplitude", "1", "Amplitude", "number", "V"),
    prop("freq", "1k", "Frequency", "number", "Hz"),
    prop("duty", "0.5", "Duty (PULSE/SQ)", "number"),
  ],
  spice: spice(
    "V",
    ["p", "n"],
    "{ref} {p:p} {p:n} {prop:wave}({prop:offset} {prop:amplitude} {prop:freq} {prop:duty})",
  ),
  keywords: ["function generator", "waveform", "sine", "square", "triangle", "pulse"],
  interactive: { kind: "pot", params: ["amplitude", "freq"] },
});

export const V_PULSE = def({
  id: "V_PULSE",
  name: "Pulse voltage source",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    poly([-200, 150], [-100, 150], [-100, -150], [100, -150], [100, 150], [200, 150]),
  ]),
  pins: sourcePins,
  fields: sourceFields("5"),
  props: [
    prop("v1", "0", "V1", "number", "V"),
    prop("v2", "5", "V2", "number", "V"),
    prop("td", "0", "Delay", "number", "s"),
    prop("tr", "1u", "Rise", "number", "s"),
    prop("tf", "1u", "Fall", "number", "s"),
    prop("pw", "100u", "Width", "number", "s"),
    prop("period", "200u", "Period", "number", "s"),
  ],
  spice: spice(
    "V",
    ["p", "n"],
    "{ref} {p:p} {p:n} PULSE({prop:v1} {prop:v2} {prop:td} {prop:tr} {prop:tf} {prop:pw} {prop:period})",
  ),
  keywords: ["pulse", "square", "clock"],
});

export const V_TRI = def({
  id: "V_TRI",
  name: "Triangle voltage source",
  category: "Sources",
  gfx: gfx([...sourceCircle(), poly([-200, 150], [-100, -150], [0, 150], [100, -150], [200, 150])]),
  pins: sourcePins,
  fields: sourceFields("1k"),
  props: [
    prop("offset", "0", "Offset", "number", "V"),
    prop("amplitude", "1", "Amplitude", "number", "V"),
    prop("freq", "1k", "Frequency", "number", "Hz"),
  ],
  spice: spice(
    "V",
    ["p", "n"],
    "{ref} {p:p} {p:n} TRIANGLE({prop:offset} {prop:amplitude} {prop:freq})",
  ),
  keywords: ["triangle", "ramp"],
});

export const V_SQ = def({
  id: "V_SQ",
  name: "Square voltage source",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    poly([-200, 150], [-200, -150], [0, -150], [0, 150], [200, 150], [200, -150]),
  ]),
  pins: sourcePins,
  fields: sourceFields("1k"),
  props: [
    prop("offset", "0", "Offset", "number", "V"),
    prop("amplitude", "1", "Amplitude", "number", "V"),
    prop("freq", "1k", "Frequency", "number", "Hz"),
  ],
  spice: spice(
    "V",
    ["p", "n"],
    "{ref} {p:p} {p:n} SQUARE({prop:offset} {prop:amplitude} {prop:freq})",
  ),
  keywords: ["square", "clock"],
});

export const V_AC = def({
  id: "V_AC",
  name: "AC small-signal source",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    circle(0, 0, 180),
    line([-400, 0], [-180, 0]),
    line([180, 0], [400, 0]),
  ]),
  pins: sourcePins,
  fields: sourceFields("1"),
  props: [prop("amplitude", "1", "AC amplitude", "number", "V")],
  spice: spice("V", ["p", "n"], "{ref} {p:p} {p:n} DC 0 AC {prop:amplitude}"),
  keywords: ["ac", "small signal", "bode", "frequency response"],
});

export const I_DC = def({
  id: "I_DC",
  name: "DC current source",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    line([0, 250], [0, -250]),
    poly([-150, -100], [0, -250], [150, -100]),
  ]),
  pins: [pin("p", "+", "1", -1000, 0, "l", "passive"), pin("n", "−", "2", 1000, 0, "r", "passive")],
  fields: [fieldRef("reference", "I"), fieldValue("1m")],
  props: [prop("value", "1m", "DC value", "number", "A")],
  spice: spice("I", ["p", "n"], "{ref} {p:p} {p:n} DC {value}"),
  keywords: ["current", "source"],
});

export const I_SIN = def({
  id: "I_SIN",
  name: "Sine current source",
  category: "Sources",
  gfx: gfx([
    ...sourceCircle(),
    line([0, 250], [0, -250]),
    poly([-150, -100], [0, -250], [150, -100]),
  ]),
  pins: [pin("p", "+", "1", -1000, 0, "l", "passive"), pin("n", "−", "2", 1000, 0, "r", "passive")],
  fields: [fieldRef("reference", "I"), fieldValue("1m")],
  props: [
    prop("offset", "0", "Offset", "number", "A"),
    prop("amplitude", "1m", "Amplitude", "number", "A"),
    prop("freq", "1k", "Frequency", "number", "Hz"),
  ],
  spice: spice(
    "I",
    ["p", "n"],
    "{ref} {p:p} {p:n} SIN({prop:offset} {prop:amplitude} {prop:freq})",
  ),
  keywords: ["current", "sine"],
});
