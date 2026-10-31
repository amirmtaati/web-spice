/**
 * Netlist extraction (master §9.8): schematic graph → SPICE text + sourceMap.
 * Deterministic: identical documents produce identical netlists (instances
 * sorted by reference; nets numbered by sorted representative points).
 *
 * Interactive elements expand specially (master §9.7): switches become S-cards
 * with synthesized control sources; potentiometers become two resistors split
 * by wiper travel. These overrides win over the definition template.
 */

import { symbolById } from "../symbols/index.ts";
import { parseEngineering } from "../ui/format.ts";
import { type Connectivity, computeConnectivity } from "./connectivity.ts";
import { pinsOf, referenceOf } from "./instances.ts";
import type { SchematicDoc, SymbolInstance } from "./types.ts";

export interface SourceMapEntry {
  readonly instanceId: string;
  readonly defId: string;
  readonly card: number;
}

export interface Extraction {
  readonly netlist: string;
  readonly sourceMap: ReadonlyMap<number, SourceMapEntry>;
  readonly connectivity: Connectivity;
  /** Warnings that don't block emission (e.g. duplicate references). */
  readonly warnings: readonly string[];
}

/** Compact SPICE-safe number formatting (integers stay integers). */
export function spiceNum(x: number): string {
  if (Number.isInteger(x)) return String(x);
  const p = x.toPrecision(12);
  const f = Number(p).toString();
  return f;
}

function substitute(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z0-9_:]+)\}/g, (raw, name: string) => {
    const v = vars[name];
    return v === undefined ? raw : v;
  });
}

/** Parse a stored numeric-ish prop ("4.7k"); invalid → fallback. */
function num(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const v = parseEngineering(text);
  return v ?? fallback;
}

interface Emitted {
  readonly lines: string[];
  readonly map: ReadonlyMap<number, SourceMapEntry>;
  readonly warnings: readonly string[];
}

function expandInstance(
  inst: SymbolInstance,
  vars: Readonly<Record<string, string>>,
  nets: Connectivity,
  warnings: readonly string[],
): Emitted {
  const d = symbolById(inst.defId);
  if (d === undefined || d.spice.template === undefined) {
    return { lines: [], map: new Map(), warnings };
  }

  // Node resolver: pin → net name; tie fallbacks; synthesized fallbacks.
  const nodeOf = (pinId: string): string => {
    const direct = nets.pinNet.get(`${inst.id}:${pinId}`);
    if (direct !== undefined) return direct.name;
    const tieTarget = d.spice.tie?.[pinId];
    if (tieTarget !== undefined) {
      const t = nets.pinNet.get(`${inst.id}:${tieTarget}`);
      if (t !== undefined) return t.name;
    }
    return `net__tie_${referenceOf(inst)}_${pinId}`;
  };

  const interactive = d.interactive !== undefined && templateHasNodes(d.spice.template);

  if (d.interactive?.kind === "pot" && interactive) {
    return expandPot(inst, nodeOf, warnings);
  }
  if (d.interactive?.kind === "switch" || d.interactive?.kind === "button") {
    return expandSwitch(inst, nodeOf, warnings);
  }

  const lines: string[] = [];
  const map = new Map<number, SourceMapEntry>();
  const cards = d.spice.template.split("\n");
  cards.forEach((card, i) => {
    lines.push(substitute(card, vars));
    map.set(lines.length - 1, { instanceId: inst.id, defId: inst.defId, card: i });
  });
  return { lines, map, warnings };
}

function templateHasNodes(template: string): boolean {
  return template.includes("{p:");
}

function expandPot(
  inst: SymbolInstance,
  nodeOf: (pinId: string) => string,
  warnings: readonly string[],
): Emitted {
  const value = num(inst.fields.value ?? inst.props.value, 1000);
  const travel = Math.min(Math.max(num(inst.props.travel, 0.5), 0), 1);
  const ref = referenceOf(inst);
  const lines = [
    `${ref}a ${nodeOf("a")} ${nodeOf("w")} ${spiceNum(value * travel)}`,
    `${ref}b ${nodeOf("w")} ${nodeOf("b")} ${spiceNum(value * (1 - travel))}`,
  ];
  const map = new Map<number, SourceMapEntry>([
    [0, { instanceId: inst.id, defId: inst.defId, card: 0 }],
    [1, { instanceId: inst.id, defId: inst.defId, card: 1 }],
  ]);
  void warnings;
  return { lines, map, warnings };
}

function expandSwitch(
  inst: SymbolInstance,
  nodeOf: (pinId: string) => string,
  warnings: readonly string[],
): Emitted {
  const state = num(inst.props.state ?? inst.fields.value, 0);
  const closed = state !== 0;
  const ref = referenceOf(inst);
  const lines: string[] = [];
  const map = new Map<number, SourceMapEntry>();

  if (inst.defId === "SW_SPDT") {
    const ctlA = `net__ctl_${ref}a`;
    const ctlB = `net__ctl_${ref}b`;
    lines.push(
      `${ref}a ${nodeOf("com")} ${nodeOf("t1")} ${ctlA} 0 sw_fast`,
      `V__ctl_${ref}a ${ctlA} 0 DC ${closed ? 1 : 0}`,
      `${ref}b ${nodeOf("com")} ${nodeOf("t2")} ${ctlB} 0 sw_fast`,
      `V__ctl_${ref}b ${ctlB} 0 DC ${closed ? 0 : 1}`,
    );
    for (let i = 0; i < lines.length; i++) {
      map.set(i, { instanceId: inst.id, defId: inst.defId, card: i });
    }
    return { lines, map, warnings };
  }

  const ctl = `net__ctl_${ref}`;
  lines.push(
    `${ref} ${nodeOf("a")} ${nodeOf("b")} ${ctl} 0 sw_fast`,
    `V__ctl_${ref} ${ctl} 0 DC ${closed ? 1 : 0}`,
  );
  for (let i = 0; i < lines.length; i++) {
    map.set(i, { instanceId: inst.id, defId: inst.defId, card: i });
  }
  return { lines, map, warnings };
}

const refCollate = (a: string, b: string): number => {
  const na = /^([A-Za-z]+)(\d+)$/.exec(a);
  const nb = /^([A-Za-z]+)(\d+)$/.exec(b);
  if (na !== null && nb !== null && na[1] === nb[1]) {
    return Number(na[2]) - Number(nb[2]);
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Extract the SPICE netlist + sourceMap for the document. */
export function extractNetlist(doc: SchematicDoc): Extraction {
  const connectivity = computeConnectivity(doc);
  const lines: string[] = [`* ${doc.title}`];
  const map = new Map<number, SourceMapEntry>();
  const warnings: string[] = [];

  const instances = [...doc.symbols]
    .filter((s) => symbolById(s.defId)?.spice.template !== undefined)
    .sort((a, b) => refCollate(referenceOf(a), referenceOf(b)) || a.id.localeCompare(b.id));

  const seenRefs = new Map<string, number>();
  for (const inst of instances) {
    const ref = referenceOf(inst);
    seenRefs.set(ref, (seenRefs.get(ref) ?? 0) + 1);
  }
  for (const [ref, count] of seenRefs) {
    if (count > 1) warnings.push(`duplicate reference "${ref}" on ${count} symbols`);
  }

  for (const inst of instances) {
    const d = symbolById(inst.defId);
    if (d === undefined) continue;

    const vars: Record<string, string> = {
      ref: referenceOf(inst),
      value: inst.fields.value ?? d.fields.find((f) => f.key === "value")?.defaultText ?? "",
      model: inst.props.model ?? d.properties.find((p) => p.key === "model")?.default ?? "",
    };
    for (const [pid, node] of d.spice.pinOrder.map(
      (pid) => [pid, nodeOfSafe(inst, pid, connectivity)] as const,
    )) {
      vars[`p:${pid}`] = node;
    }
    for (const p of d.properties) {
      vars[`prop:${p.key}`] = inst.props[p.key] ?? p.default;
    }

    const out = expandInstance(inst, vars, connectivity, warnings);
    if (out.warnings.length > warnings.length) {
      warnings.push(...out.warnings.slice(warnings.length));
    }
    const base = lines.length; // remap local card indexes → global line numbers
    for (const line of out.lines) {
      lines.push(line);
      const entry = out.map.get(lines.length - 1 - base);
      if (entry !== undefined) map.set(lines.length - 1, entry);
    }
  }

  lines.push(".end");
  return {
    netlist: lines.join("\n"),
    sourceMap: map,
    connectivity,
    warnings,
  };
}

function nodeOfSafe(inst: SymbolInstance, pinId: string, nets: Connectivity): string {
  const direct = nets.pinNet.get(`${inst.id}:${pinId}`);
  if (direct !== undefined) return direct.name;
  const d = symbolById(inst.defId);
  const tieTarget = d?.spice.tie?.[pinId];
  if (tieTarget !== undefined) {
    const t = nets.pinNet.get(`${inst.id}:${tieTarget}`);
    if (t !== undefined) return t.name;
  }
  return `net__tie_${referenceOf(inst)}_${pinId}`;
}

/** Pin count on an instance that participates in extraction (UI affordances). */
export function connectedPinCount(inst: SymbolInstance, nets: Connectivity): number {
  return pinsOf(inst).filter((p) => nets.pinNet.has(`${inst.id}:${p.pin.id}`)).length;
}
