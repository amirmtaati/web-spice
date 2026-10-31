/**
 * Symbol validator (master §9.6): pins on the 25-mil grid (250 units),
 * unique pin ids and numbers per unit, sane graphics extent, required
 * fields, complete SPICE mapping. Runs over the whole library in CI.
 */
import type { SymbolDef } from "../schematic/types.ts";
import { SYMBOL_LIBRARY } from "./index.ts";

export interface SymbolIssue {
  readonly defId: string;
  readonly rule: string;
  readonly message: string;
}

const GRID_MIN = 250; // 25 mil — the finest selectable grid

function checkDef(d: SymbolDef): readonly SymbolIssue[] {
  const issues: SymbolIssue[] = [];
  const fail = (rule: string, message: string): void => {
    issues.push({ defId: d.id, rule, message });
  };

  // Pins on the minimum grid.
  for (const p of d.pins) {
    if (p.x % GRID_MIN !== 0 || p.y % GRID_MIN !== 0) {
      fail("pin-grid", `pin ${p.id} at (${p.x}, ${p.y}) is off the 25-mil grid`);
    }
  }

  // Unique pin ids across the symbol; unique pin numbers per unit.
  const idSeen = new Set<string>();
  for (const p of d.pins) {
    if (idSeen.has(p.id)) fail("pin-ids", `duplicate pin id "${p.id}"`);
    idSeen.add(p.id);
  }
  for (const u of d.units) {
    const numSeen = new Set<string>();
    for (const pid of u.pins) {
      const p = d.pins.find((x) => x.id === pid);
      if (p === undefined) {
        fail("unit-pins", `unit ${u.name} references unknown pin "${pid}"`);
        continue;
      }
      if (numSeen.has(p.num)) fail("pin-nums", `unit ${u.name} repeats pin number ${p.num}`);
      numSeen.add(p.num);
    }
  }

  // Graphics stay within a sane extent (± 4000 units = ± 400 mil of origin).
  const EXTENT = 4000;
  for (const s of d.standards.ansi.shapes) {
    const pts: readonly { readonly x: number; readonly y: number }[] =
      s.op === "rect"
        ? [
            { x: s.x, y: s.y },
            { x: s.x + s.w, y: s.y + s.h },
          ]
        : "pts" in s
          ? s.pts
          : [{ x: s.x, y: s.y }];
    for (const p of pts) {
      if (Math.abs(p.x) > EXTENT || Math.abs(p.y) > EXTENT) {
        fail("graphics-extent", `shape extends beyond ±${EXTENT} units at (${p.x}, ${p.y})`);
      }
    }
  }

  // Element definitions carry a reference + value field; SPICE maps complete.
  const isGraphical = d.spice.template === undefined;
  if (!isGraphical) {
    if (!d.fields.some((f) => f.key === "reference")) fail("fields", "missing reference field");
    for (const pid of d.spice.pinOrder) {
      if (!d.pins.some((p) => p.id === pid))
        fail("spice", `pinOrder references unknown pin "${pid}"`);
    }
    const nodeRefs = d.spice.template.match(/\{p:([a-zA-Z0-9_]+)\}/g) ?? [];
    for (const raw of nodeRefs) {
      const pid = raw.slice(3, -1);
      if (!d.spice.pinOrder.includes(pid)) {
        fail("spice", `template node {p:${pid}} is not in pinOrder`);
      }
    }
    for (const key of d.spice.template.match(/\{prop:([a-zA-Z0-9_]+)\}/g) ?? []) {
      const pk = key.slice(6, -1);
      if (!d.properties.some((p) => p.key === pk)) {
        fail("spice", `template references unknown property "{prop:${pk}}"`);
      }
    }
    if (d.spice.tie !== undefined) {
      for (const [hiddenPin, target] of Object.entries(d.spice.tie)) {
        if (!d.pins.some((p) => p.id === hiddenPin))
          fail("spice", `tie source "${hiddenPin}" unknown`);
        if (!d.pins.some((p) => p.id === target)) fail("spice", `tie target "${target}" unknown`);
      }
    }
    if (d.spice.netAlias !== undefined && d.pins.length !== 1) {
      fail("spice", "net aliases attach to exactly one pin");
    }
  }

  // Ground alias must exist only on the ground port; aliases resolve through
  // the "net" property.
  if (d.spice.netAlias !== undefined && d.spice.netAlias !== "{net}" && d.id !== "GND") {
    fail("spice", "net alias must be the {net} property placeholder");
  }

  return issues;
}

/** Validate the whole library; returns issues grouped by definition. */
export function validateLibrary(
  library: readonly SymbolDef[] = SYMBOL_LIBRARY,
): readonly SymbolIssue[] {
  return library.flatMap(checkDef);
}
