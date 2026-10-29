/**
 * Device model library (SPEC §22 E2 "model library").
 *
 * Three jobs:
 *  1. **Schemas** — for every model type the engine implements, the set of
 *     recognized parameters with their units and SPICE defaults. The
 *     compiler consults this to reject unknown parameters with a warning
 *     (ngspice: "unknown model parameter") instead of silently dropping a
 *     typo like `iss=1e-15` on a diode card — the classic silent-wrong-
 *     results trap.
 *  2. **Type/element compatibility** — a D element may reference a `d`
 *     model, a Q element `npn`/`pnp`, and so on. Mismatches throw
 *     `E_BAD_MODEL` at compile time.
 *  3. **Built-in cards** — a small library of generic, documented models
 *     (`D_SIGNAL`, `NPN_GENERIC`, `NMOS_5V`, …) that elements may reference
 *     without a `.model` card. Netlist `.model` cards always win over a
 *     built-in of the same name.
 *
 * Parameter values are NOT range-checked here beyond type: SPICE practice
 * is to trust the model author; the devices clamp where physically
 * required (e.g. switch RON/ROFF positivity).
 */

import type { ModelCard, Subcircuit } from "@spicekit/protocol";

import { parseNetlist } from "../parser/index.ts";

/** One recognized model parameter: SPICE name, unit, default, aliases. */
export interface ModelParamSpec {
  name: string;
  unit: string;
  /** SPICE default when omitted. Absent = device-specific/infinite. */
  default?: number;
  /** Alternative card spellings accepted by the devices. */
  aliases?: readonly string[];
  description: string;
}

/** Model types each element letter may reference (checked at compile). */
export const MODEL_TYPES_BY_ELEMENT: Readonly<Record<string, readonly string[]>> = {
  D: ["d"],
  Q: ["npn", "pnp"],
  M: ["nmos", "pmos"],
  J: ["njf", "pjf"],
  S: ["sw"],
  W: ["csw"],
};

/**
 * Accepted spellings per canonical model type (case-insensitive). The long
 * forms are common in hand-written netlists and textbooks.
 */
const MODEL_TYPE_SYNONYMS: Readonly<Record<string, string>> = {
  d: "d",
  diode: "d",
  npn: "npn",
  pnp: "pnp",
  nmos: "nmos",
  pmos: "pmos",
  njf: "njf",
  pjf: "pjf",
  sw: "sw",
  vswitch: "sw",
  csw: "csw",
  iswitch: "csw",
};

/** Canonical model type for a card's spelling ("diode" → "d"), or undefined. */
export function canonicalModelType(spelling: string): string | undefined {
  return MODEL_TYPE_SYNONYMS[spelling.toLowerCase()];
}

const DIODE_PARAMS: readonly ModelParamSpec[] = [
  { name: "is", unit: "A", default: 1e-14, description: "saturation current" },
  { name: "rs", unit: "Ω", default: 0, description: "series resistance" },
  { name: "n", unit: "-", default: 1, description: "emission coefficient" },
  { name: "bv", unit: "V", description: "reverse breakdown knee voltage" },
  { name: "ibv", unit: "A", default: 1e-3, description: "current at breakdown" },
  {
    name: "cjo",
    unit: "F",
    default: 0,
    aliases: ["cj0"],
    description: "zero-bias junction capacitance",
  },
  { name: "m", unit: "-", default: 0.5, description: "grading coefficient" },
  { name: "vj", unit: "V", default: 1, description: "junction potential" },
  { name: "fc", unit: "-", default: 0.5, description: "forward-bias cap coefficient" },
  { name: "tt", unit: "s", default: 0, description: "transit time" },
  { name: "eg", unit: "eV", default: 1.11, description: "bandgap energy (Is temperature)" },
  { name: "xti", unit: "-", default: 3, description: "Is temperature exponent" },
  { name: "level", unit: "-", default: 1, description: "model level (L1 only; ignored)" },
];

const BJT_PARAMS: readonly ModelParamSpec[] = [
  { name: "is", unit: "A", default: 1e-16, description: "transport saturation current" },
  { name: "bf", unit: "-", default: 100, description: "forward beta" },
  { name: "br", unit: "-", default: 1, description: "reverse beta" },
  { name: "nf", unit: "-", default: 1, description: "forward emission coefficient" },
  { name: "nr", unit: "-", default: 1, description: "reverse emission coefficient" },
  { name: "vaf", unit: "V", description: "forward Early voltage" },
  { name: "var", unit: "V", description: "reverse Early voltage" },
  { name: "rb", unit: "Ω", default: 0, description: "base resistance" },
  { name: "rc", unit: "Ω", default: 0, description: "collector resistance" },
  { name: "re", unit: "Ω", default: 0, description: "emitter resistance" },
  { name: "cje", unit: "F", default: 0, description: "B-E zero-bias depletion capacitance" },
  { name: "vje", unit: "V", default: 0.75, description: "B-E junction potential" },
  { name: "mje", unit: "-", default: 0.33, description: "B-E grading coefficient" },
  { name: "cjc", unit: "F", default: 0, description: "B-C zero-bias depletion capacitance" },
  { name: "vjc", unit: "V", default: 0.75, description: "B-C junction potential" },
  { name: "mjc", unit: "-", default: 0.33, description: "B-C grading coefficient" },
  { name: "tf", unit: "s", default: 0, description: "forward transit time" },
  { name: "tr", unit: "s", default: 0, description: "reverse transit time" },
  { name: "fc", unit: "-", default: 0.5, description: "forward-bias cap coefficient" },
  { name: "level", unit: "-", default: 1, description: "model level (L1 only; ignored)" },
];

const MOSFET_PARAMS: readonly ModelParamSpec[] = [
  { name: "vto", unit: "V", default: 0, description: "zero-bias threshold voltage" },
  { name: "kp", unit: "A/V²", default: 2e-5, description: "transconductance parameter" },
  { name: "gamma", unit: "√V", default: 0, description: "bulk threshold parameter" },
  { name: "phi", unit: "V", default: 0.6, description: "surface potential" },
  { name: "lambda", unit: "1/V", default: 0, description: "channel-length modulation" },
  { name: "tox", unit: "m", description: "oxide thickness (capacitance scaling)" },
  { name: "cgso", unit: "F/m", default: 0, description: "gate-source overlap capacitance" },
  { name: "cgdo", unit: "F/m", default: 0, description: "gate-drain overlap capacitance" },
  { name: "cgbo", unit: "F/m", default: 0, description: "gate-bulk overlap capacitance" },
  { name: "is", unit: "A", default: 1e-14, description: "bulk junction saturation current" },
  { name: "n", unit: "-", default: 1, description: "bulk junction emission coefficient" },
  { name: "cbd", unit: "F", default: 0, description: "bulk-drain zero-bias capacitance" },
  { name: "cbs", unit: "F", default: 0, description: "bulk-source zero-bias capacitance" },
  { name: "pb", unit: "V", default: 0.8, description: "bulk junction potential" },
  { name: "mj", unit: "-", default: 0.5, description: "bulk junction grading coefficient" },
  { name: "fc", unit: "-", default: 0.5, description: "forward-bias cap coefficient" },
  { name: "level", unit: "-", default: 1, description: "model level (L1 only; ignored)" },
];

const JFET_PARAMS: readonly ModelParamSpec[] = [
  { name: "vto", unit: "V", default: -2, description: "threshold voltage" },
  { name: "beta", unit: "A/V²", default: 1e-4, description: "transconductance parameter" },
  { name: "lambda", unit: "1/V", default: 0, description: "channel-length modulation" },
  { name: "is", unit: "A", default: 1e-14, description: "gate junction saturation current" },
  { name: "n", unit: "-", default: 1, description: "gate junction emission coefficient" },
  { name: "cgs", unit: "F", default: 0, description: "zero-bias gate-source capacitance" },
  { name: "cgd", unit: "F", default: 0, description: "zero-bias gate-drain capacitance" },
  { name: "pb", unit: "V", default: 1, description: "gate junction potential" },
  { name: "m", unit: "-", default: 0.5, description: "gate junction grading coefficient" },
  { name: "fc", unit: "-", default: 0.5, description: "forward-bias cap coefficient" },
  { name: "level", unit: "-", default: 1, description: "model level (L1 only; ignored)" },
];

const VSWITCH_PARAMS: readonly ModelParamSpec[] = [
  { name: "vt", unit: "V", default: 0, description: "threshold voltage" },
  { name: "vh", unit: "V", default: 0, description: "hysteresis half-band" },
  { name: "ron", unit: "Ω", default: 1, description: "on resistance" },
  { name: "roff", unit: "Ω", default: 1e12, description: "off resistance" },
  {
    name: "smooth",
    unit: "V",
    default: 0,
    description: "smooth-transition band width (0 = hard switching)",
  },
];

/** Current-controlled switch: same analog params, current thresholds. */
const CSWITCH_PARAMS: readonly ModelParamSpec[] = VSWITCH_PARAMS.map((p) =>
  p.name === "vt"
    ? { ...p, name: "it", unit: "A", description: "threshold current" }
    : p.name === "vh"
      ? { ...p, name: "ih", unit: "A", description: "hysteresis half-band" }
      : p,
);

/** Parameter schemas per model type. `pnp`/`pmos`/`pjf` share their N twin. */
export const MODEL_PARAM_SPECS: Readonly<Record<string, readonly ModelParamSpec[]>> = {
  d: DIODE_PARAMS,
  npn: BJT_PARAMS,
  pnp: BJT_PARAMS,
  nmos: MOSFET_PARAMS,
  pmos: MOSFET_PARAMS,
  njf: JFET_PARAMS,
  pjf: JFET_PARAMS,
  sw: VSWITCH_PARAMS,
  csw: CSWITCH_PARAMS,
};

/** Specs for a model type, or undefined when the type is unknown. */
export function modelSpecsFor(modelType: string): readonly ModelParamSpec[] | undefined {
  return MODEL_PARAM_SPECS[modelType.toLowerCase()];
}

/** Every recognized spelling (name + aliases) for a model type. */
export function knownModelParams(modelType: string): Set<string> {
  const out = new Set<string>();
  for (const spec of modelSpecsFor(modelType) ?? []) {
    out.add(spec.name);
    for (const alias of spec.aliases ?? []) {
      out.add(alias);
    }
  }
  return out;
}

/**
 * Card parameters the schema does not recognize, in card order. These are
 * almost always typos; the compiler warns (W_MODEL_PARAM_UNKNOWN) and the
 * devices ignore them.
 */
export function unknownModelParams(
  modelType: string,
  parameters: Record<string, number | string>,
): string[] {
  const known = knownModelParams(modelType);
  return Object.keys(parameters).filter((key) => !known.has(key.toLowerCase()));
}

/**
 * Type/element compatibility: the reason string when an element of
 * `elementType` may not reference a `modelType` card, else undefined. Long
 * spellings ("diode") canonicalize to the short SPICE form ("d").
 */
export function modelTypeMismatch(elementType: string, modelType: string): string | undefined {
  const canon = canonicalModelType(modelType);
  if (canon === undefined) {
    return `unknown model type "${modelType}"`;
  }
  const allowed = MODEL_TYPES_BY_ELEMENT[elementType.toUpperCase()];
  if (allowed === undefined) {
    return `element ${elementType.toUpperCase()} does not take a model`;
  }
  if (!allowed.includes(canon)) {
    return `a ${elementType.toUpperCase()} element cannot use a "${modelType}" model (expected ${allowed.join(" or ")})`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Built-in cards
// ---------------------------------------------------------------------------

/**
 * Generic built-in models. Values are textbook/small-signal numbers, chosen
 * to be physically sensible rather than to mimic one exact part:
 *  - `D_SIGNAL` ≈ a 1N4148-class switching diode (public datasheet numbers).
 *  - `*_GENERIC` transistors: moderate beta, 100 V Early voltage, small
 *    parasitic resistances — useful for bias-point teaching circuits.
 *  - `NMOS_4000` mimics CD4000-era MOSFETs (high VTO, weak drive); `*_5V`
 *    are the workhorse 5 V logic models used by the E2 fixtures.
 *  - `SW_*`: fast hard switches with 1 Ω / 1 TΩ endpoints.
 */
export const BUILTIN_MODEL_CARDS: readonly ModelCard[] = [
  { name: "d_ideal", type: "d", parameters: { is: 1e-14, n: 1 } },
  {
    name: "d_signal",
    type: "d",
    parameters: {
      is: 2.52e-9,
      rs: 0.568,
      n: 1.752,
      cjo: 4e-12,
      m: 0.333,
      vj: 0.75,
      bv: 100,
      ibv: 1e-10,
      tt: 11.5e-9,
    },
  },
  {
    name: "npn_generic",
    type: "npn",
    parameters: {
      is: 1e-15,
      bf: 200,
      br: 3,
      vaf: 100,
      rb: 100,
      rc: 50,
      re: 2,
      cje: 1e-12,
      cjc: 5e-13,
      tf: 4e-10,
      tr: 2e-7,
    },
  },
  {
    name: "pnp_generic",
    type: "pnp",
    parameters: {
      is: 1e-15,
      bf: 150,
      br: 3,
      vaf: 80,
      rb: 150,
      rc: 60,
      re: 3,
      cje: 1e-12,
      cjc: 6e-13,
      tf: 6e-10,
      tr: 2e-7,
    },
  },
  { name: "nmos_5v", type: "nmos", parameters: { vto: 0.8, kp: 2e-4, lambda: 0.02 } },
  { name: "pmos_5v", type: "pmos", parameters: { vto: -0.8, kp: 1e-4, lambda: 0.02 } },
  { name: "nmos_4000", type: "nmos", parameters: { vto: 1.5, kp: 1e-4, lambda: 0.01 } },
  { name: "njf_generic", type: "njf", parameters: { vto: -2, beta: 2e-4, lambda: 1e-3 } },
  { name: "pjf_generic", type: "pjf", parameters: { vto: 2, beta: 2e-4, lambda: 1e-3 } },
  { name: "sw_fast", type: "sw", parameters: { vt: 1.5, vh: 0.1, ron: 1, roff: 1e12 } },
  { name: "csw_fast", type: "csw", parameters: { it: 1e-3, ih: 1e-4, ron: 1, roff: 1e12 } },
];

const BUILTIN_BY_NAME: ReadonlyMap<string, ModelCard> = new Map(
  BUILTIN_MODEL_CARDS.map((card) => [card.name, card]),
);

/** The built-in card `name` (case-insensitive), or undefined. */
export function builtinModel(name: string): ModelCard | undefined {
  return BUILTIN_BY_NAME.get(name.toLowerCase());
}

/** Sorted built-in card names (for library browsers / CLI listing). */
export function builtinModelNames(): string[] {
  return BUILTIN_MODEL_CARDS.map((card) => card.name).sort();
}

/**
 * Built-in op-amp macromodel subcircuits (E3, SPEC §5.7 "Op-amp: Subcircuit
 * macromodels: ideal, single-pole (GBW, …)"). Written as SPICE text and
 * parsed once — they exercise the exact same `.subckt` path as user code.
 *
 *  OPAMP_IDEAL — infinite-bandwidth voltage amplifier: Rin 1 MΩ, gain 1e6.
 *  OPAMP1P     — single-pole macromodel: gain A0, dominant pole at
 *                GBW/A0 (R=1 k, C = A0/(2π·R·GBW)), output resistance.
 *                GBW verification: non-inverting closed-loop gain G has
 *                bandwidth GBW/G (gain-bandwidth product constant).
 */
const OPAMP_IDEAL_TEXT = `builtin op-amp macromodels
.subckt OPAMP_IDEAL INP INN OUT params: GAIN=1e6 RIN=1meg
  RIN INP INN {RIN}
  E1 OUT 0 INP INN {GAIN}
.ends
`;

const OPAMP1P_TEXT = `builtin op-amp macromodels
.subckt OPAMP1P INP INN OUT params: A0=1e6 GBW=1e6 ROUT=100 RIN=1meg
  RIN INP INN {RIN}
  E1 N1 0 INP INN {A0}
  R1 N1 N2 1000
  C1 N2 0 {A0/(2*pi*1000*GBW)}
  E2 N3 0 N2 0 1
  ROUTE N3 OUT {ROUT}
.ends
`;

const BUILTIN_SUBCKT_CACHE = new Map<string, Subcircuit>();

/** The built-in macromodel subcircuit `name` (case-insensitive), or undefined. */
export function builtinSubckt(name: string): Subcircuit | undefined {
  const lower = name.toLowerCase();
  const cached = BUILTIN_SUBCKT_CACHE.get(lower);
  if (cached !== undefined) {
    return cached;
  }
  let sub: Subcircuit | undefined;
  if (lower === "opamp_ideal") {
    sub = parseBuiltin(OPAMP_IDEAL_TEXT, "OPAMP_IDEAL");
  } else if (lower === "opamp1p" || lower === "opamp_1p") {
    sub = parseBuiltin(OPAMP1P_TEXT, "OPAMP1P");
  }
  if (sub !== undefined) {
    BUILTIN_SUBCKT_CACHE.set(lower, sub);
  }
  return sub;
}

/** Sorted built-in macromodel names (for library browsers / CLI listing). */
export function builtinSubcktNames(): string[] {
  return ["OPAMP1P", "OPAMP_IDEAL"].sort();
}

/** Parse a built-in template into a Subcircuit IR. */
function parseBuiltin(text: string, name: string): Subcircuit {
  const circuit = parseNetlist(text);
  const sub = circuit.subcircuits[name.toLowerCase()];
  if (sub === undefined) {
    throw new Error(`builtinSubckt: template for ${name} did not parse`);
  }
  return sub;
}

/** Default value a spec contributes when the card omits the parameter. */
export function specDefault(modelType: string, paramName: string): number | undefined {
  return modelSpecsFor(modelType)?.find((spec) => spec.name === paramName)?.default;
}
