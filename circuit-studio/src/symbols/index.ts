/**
 * Symbol library registry (master §9.6): ≥ 60 ANSI+IEC symbol definitions,
 * category index, and lookup helpers. The validator (`validateSymbol`) runs
 * over the whole library in CI (see validate.test.ts).
 */
import type { PinDef, SymbolDef, SymbolUnit } from "../schematic/types.ts";
import {
  G_AND,
  G_BUF,
  G_INV,
  G_NAND,
  G_NOR,
  G_OR,
  G_XNOR,
  G_XOR,
  GLOB_LABEL,
  GND,
  HIER_LABEL,
  NET_LABEL,
  NOCONN,
  P3V3,
  P5V,
  PROBE_I,
  PROBE_V,
  SW_DPST,
  SW_PB,
  SW_PB_NC,
  SW_SPDT,
  SW_SPST,
  TEXT,
  VCC_PORT,
  VDD_PORT,
  VEE_PORT,
  VSS_PORT,
} from "./library-misc.ts";
import {
  BATTERY,
  C,
  C_POL,
  C_TRIM,
  FUSE,
  I_DC,
  I_SIN,
  L,
  L_CORE,
  LAMP,
  R,
  R_POT,
  R_TRIM,
  V_AC,
  V_DC,
  V_GEN,
  V_PULSE,
  V_SIN,
  V_SQ,
  V_TRI,
  XFMR,
} from "./library-passive.ts";
import {
  COMP,
  D,
  D_BRIDGE,
  D_LED,
  D_SCH,
  D_TVS,
  D_Z,
  J_NJF,
  J_PJF,
  M_NMOS,
  M_PMOS,
  OPAMP,
  OPAMP_QUAD,
  Q_NPN,
  Q_PNP,
  REG7805,
  SUBCKT,
  T555,
} from "./library-semi.ts";

export const SYMBOL_LIBRARY: readonly SymbolDef[] = [
  // Passive
  R,
  R_POT,
  R_TRIM,
  C,
  C_POL,
  C_TRIM,
  L,
  L_CORE,
  XFMR,
  FUSE,
  LAMP,
  // Sources
  V_DC,
  BATTERY,
  V_SIN,
  V_GEN,
  V_PULSE,
  V_TRI,
  V_SQ,
  V_AC,
  I_DC,
  I_SIN,
  // Diodes
  D,
  D_LED,
  D_Z,
  D_SCH,
  D_BRIDGE,
  D_TVS,
  // Transistors
  Q_NPN,
  Q_PNP,
  M_NMOS,
  M_PMOS,
  J_NJF,
  J_PJF,
  // ICs + blocks
  OPAMP,
  OPAMP_QUAD,
  COMP,
  T555,
  REG7805,
  SUBCKT,
  // Switches
  SW_SPST,
  SW_PB,
  SW_PB_NC,
  SW_SPDT,
  SW_DPST,
  // Logic
  G_BUF,
  G_INV,
  G_AND,
  G_OR,
  G_NAND,
  G_NOR,
  G_XOR,
  G_XNOR,
  // Power ports
  GND,
  VCC_PORT,
  VDD_PORT,
  VSS_PORT,
  VEE_PORT,
  P5V,
  P3V3,
  // Annotations
  NET_LABEL,
  GLOB_LABEL,
  HIER_LABEL,
  TEXT,
  PROBE_V,
  PROBE_I,
  NOCONN,
];

const BY_ID: ReadonlyMap<string, SymbolDef> = new Map(SYMBOL_LIBRARY.map((d) => [d.id, d]));

export const symbolById = (id: string): SymbolDef | undefined => BY_ID.get(id);

export const LIBRARY_CATEGORIES: readonly string[] = [
  ...new Set(SYMBOL_LIBRARY.map((d) => d.category)),
];

export const symbolsInCategory = (category: string): readonly SymbolDef[] =>
  SYMBOL_LIBRARY.filter((d) => d.category === category);

/** Pins of the unit an instance shows (falls back to unit "A"). */
export function pinsForUnit(defId: string, unit: string | undefined): readonly PinDef[] {
  const d = symbolById(defId);
  if (d === undefined) return [];
  const unitName = unit ?? "A";
  const u: SymbolUnit | undefined = d.units.find((x) => x.name === unitName) ?? d.units[0];
  const ids = new Set(u?.pins ?? []);
  return d.pins.filter((p) => ids.has(p.id));
}

export function searchLibrary(query: string): readonly SymbolDef[] {
  const q = query.trim().toLowerCase();
  if (q === "") return SYMBOL_LIBRARY;
  return SYMBOL_LIBRARY.filter((d) => {
    if (d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) return true;
    if (d.keywords.some((k) => k.includes(q))) return true;
    return d.properties.some((p) => p.key === "value" && p.default.toLowerCase().includes(q));
  });
}
