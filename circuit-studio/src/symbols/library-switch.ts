/**
 * Symbol library — Switches (master §9.7 interactive components).
 * Switches emit S-cards with synthesized control sources (`V__ctl_{ref}`
 * driven by the `state` property) so live interactive flipping is a
 * setParam on the control source (UX5).
 */
import { def, dot, fieldRef, fieldValue, gfx, line, pin, prop, spice } from "./builders.ts";

export const SW_SPST = def({
  id: "SW_SPST",
  name: "Switch (SPST)",
  category: "Switches",
  gfx: gfx([
    line([-1000, 0], [-400, 0]),
    line([400, 0], [1000, 0]),
    dot(-400, 0),
    dot(400, 0),
    line([-400, 0], [350, -400]),
    line([-150, -550], [150, -700]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "SW"), fieldValue("off")],
  props: [prop("state", "0", "0 = open, 1 = closed", "enum", undefined, ["0", "1"])],
  spice: spice(
    "S",
    ["a", "b"],
    "{ref} {p:a} {p:b} net__ctl_{ref} 0 sw_fast\nV__ctl_{ref} net__ctl_{ref} 0 DC {prop:state}",
  ),
  keywords: ["switch", "spst", "toggle"],
  interactive: { kind: "switch", params: ["state"] },
});

export const SW_PB = def({
  id: "SW_PB",
  name: "Push button (NO)",
  category: "Switches",
  gfx: gfx([
    line([-1000, 0], [-400, 0]),
    line([400, 0], [1000, 0]),
    dot(-400, 0),
    dot(400, 0),
    line([-400, 0], [300, -350]),
    line([-250, -500], [250, -500]),
    line([-150, -500], [-150, -650]),
    line([150, -500], [150, -650]),
    line([-150, -650], [150, -650]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "SW"), fieldValue("0")],
  props: [prop("state", "0", "0 = released, 1 = pressed", "enum", undefined, ["0", "1"])],
  spice: spice(
    "S",
    ["a", "b"],
    "{ref} {p:a} {p:b} net__ctl_{ref} 0 sw_fast\nV__ctl_{ref} net__ctl_{ref} 0 DC {prop:state}",
  ),
  keywords: ["button", "push", "momentary"],
  interactive: { kind: "button", params: ["state"] },
});

export const SW_PB_NC = def({
  id: "SW_PB_NC",
  name: "Push button (NC)",
  category: "Switches",
  gfx: gfx([
    line([-1000, 0], [-400, 0]),
    line([400, 0], [1000, 0]),
    dot(-400, 0),
    dot(400, 0),
    line([-400, 0], [300, -350]),
    line([100, -500], [500, -500]),
    line([300, -350], [300, -500]),
  ]),
  pins: [pin("a", "A", "1", -1000, 0, "l"), pin("b", "B", "2", 1000, 0, "r")],
  fields: [fieldRef("reference", "SW"), fieldValue("1")],
  props: [prop("state", "1", "1 = released (closed), 0 = pressed", "enum", undefined, ["0", "1"])],
  spice: spice(
    "S",
    ["a", "b"],
    "{ref} {p:a} {p:b} net__ctl_{ref} 0 sw_fast\nV__ctl_{ref} net__ctl_{ref} 0 DC {prop:state}",
  ),
  keywords: ["button", "normally closed"],
  interactive: { kind: "button", params: ["state"] },
});

export const SW_SPDT = def({
  id: "SW_SPDT",
  name: "Switch (SPDT)",
  category: "Switches",
  gfx: gfx([
    line([-1000, 0], [-400, 0]),
    dot(-400, 0),
    dot(400, -500),
    dot(400, 500),
    line([400, -500], [1000, -500]),
    line([400, 500], [1000, 500]),
    line([-400, 0], [350, -450]),
  ]),
  pins: [
    pin("com", "COM", "1", -1000, 0, "l"),
    pin("t1", "A", "2", 1000, -500, "r"),
    pin("t2", "B", "3", 1000, 500, "r"),
  ],
  fields: [fieldRef("reference", "SW"), fieldValue("A")],
  props: [prop("state", "1", "1 = COM–A, 0 = COM–B", "enum", undefined, ["0", "1"])],
  spice: spice(
    "SSPDT",
    ["com", "t1", "t2"],
    "{ref}a {p:com} {p:t1} net__ctl_{ref}a 0 sw_fast\nV__ctl_{ref}a net__ctl_{ref}a 0 DC {prop:state}\nS {ref}b {p:com} {p:t2} net__ctl_{ref}b 0 sw_fast",
  ),
  keywords: ["switch", "spdt", "changeover"],
  interactive: { kind: "switch", params: ["state"] },
});

export const SW_DPST = def({
  id: "SW_DPST",
  name: "Switch (DPST)",
  category: "Switches",
  gfx: gfx([
    line([-1000, -500], [-400, -500]),
    line([400, -500], [1000, -500]),
    dot(-400, -500),
    dot(400, -500),
    line([-400, -500], [350, -850]),
    line([-1000, 500], [-400, 500]),
    line([400, 500], [1000, 500]),
    dot(-400, 500),
    dot(400, 500),
    line([-400, 500], [350, -250]),
  ]),
  pins: [
    pin("a1", "A1", "1", -1000, -500, "l"),
    pin("b1", "B1", "2", 1000, -500, "r"),
    pin("a2", "A2", "3", -1000, 500, "l"),
    pin("b2", "B2", "4", 1000, 500, "r"),
  ],
  fields: [fieldRef("reference", "SW"), fieldValue("0")],
  props: [prop("state", "0", "0 = open, 1 = closed", "enum", undefined, ["0", "1"])],
  spice: spice(
    "SDPST",
    ["a1", "b1", "a2", "b2"],
    "{ref}1 {p:a1} {p:b1} net__ctl_{ref} 0 sw_fast\nS {ref}2 {p:a2} {p:b2} net__ctl_{ref} 0 sw_fast\nV__ctl_{ref} net__ctl_{ref} 0 DC {prop:state}",
  ),
  keywords: ["switch", "dpst", "double"],
  interactive: { kind: "switch", params: ["state"] },
});
