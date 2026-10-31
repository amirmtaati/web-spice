/**
 * ERC — electrical rules check (master §9.9). Pure function over the doc;
 * every result carries severity, message, a location for canvas markers and
 * "Zoom to", and the involved ids for the panel + per-instance ignore.
 */

import { symbolById } from "../symbols/index.ts";
import { type Connectivity, computeConnectivity } from "./connectivity.ts";
import { pinsOf, referenceOf } from "./instances.ts";
import type { SchematicDoc, SymbolInstance, Vec2 } from "./types.ts";

export type ErcSeverity = "error" | "warning" | "info";

export interface ErcIssue {
  readonly rule: string;
  readonly severity: ErcSeverity;
  readonly message: string;
  /** Canvas anchor for the marker + "Zoom to". */
  readonly at: Vec2;
  /** Involved instance/other ids (panel selection + ignore bookkeeping). */
  readonly items: readonly string[];
}

export function runErc(doc: SchematicDoc, nets?: Connectivity): readonly ErcIssue[] {
  const conn = nets ?? computeConnectivity(doc);
  const issues: ErcIssue[] = [];
  const push = (i: ErcIssue): void => {
    issues.push(i);
  };

  checkDuplicateReferences(doc, push);
  checkMissingGround(doc, conn, push);
  checkUnconnectedPins(doc, conn, push);
  checkFloatingNets(conn, push);
  checkPinTypeConflicts(doc, conn, push);
  checkLabelIssues(doc, conn, push);

  return issues;
}

type Sink = (issue: ErcIssue) => void;

function checkDuplicateReferences(doc: SchematicDoc, push: Sink): void {
  const byRef = new Map<string, SymbolInstance[]>();
  for (const s of doc.symbols) {
    const ref = referenceOf(s);
    const list = byRef.get(ref);
    if (list === undefined) byRef.set(ref, [s]);
    else list.push(s);
  }
  for (const [ref, syms] of byRef) {
    if (syms.length < 2) continue;
    const first = syms[0];
    const at = first !== undefined ? { x: first.x, y: first.y } : { x: 0, y: 0 };
    push({
      rule: "duplicate-reference",
      severity: "error",
      message: `Reference "${ref}" is used ${syms.length} times — run auto-annotate`,
      at,
      items: syms.map((s) => s.id),
    });
  }
}

function checkMissingGround(doc: SchematicDoc, conn: Connectivity, push: Sink): void {
  const hasGround = conn.nets.some((n) => n.isGround);
  if (hasGround || doc.symbols.length === 0) return;
  const first = doc.symbols[0];
  push({
    rule: "missing-ground",
    severity: "error",
    message: "No ground (net 0) — add a GND port; SPICE needs a reference node",
    at: first !== undefined ? { x: first.x, y: first.y } : { x: 0, y: 0 },
    items: [],
  });
}

function checkUnconnectedPins(doc: SchematicDoc, conn: Connectivity, push: Sink): void {
  for (const inst of doc.symbols) {
    for (const rp of pinsOf(inst)) {
      const key = `${inst.id}:${rp.pin.id}`;
      const net = conn.pinNet.get(key);
      // A pin is unconnected when it sits alone on its net (no other pin).
      if (net !== undefined && net.pins.length >= 2) continue;
      if (rp.pin.hidden) continue;
      if (rp.pin.etype === "no-connect") continue;
      if (rp.pin.etype === "power-out") continue; // rail ports stand alone fine
      if (doc.noConnects.some((nc) => nc.at.x === rp.at.x && nc.at.y === rp.at.y)) continue;
      push({
        rule: "unconnected-pin",
        severity: "warning",
        message: `${referenceOf(inst)} pin ${rp.pin.name} (${rp.pin.num}) is unconnected`,
        at: rp.at,
        items: [inst.id],
      });
    }
  }
}

function checkFloatingNets(conn: Connectivity, push: Sink): void {
  // Single-pin nets are reported per-pin by checkUnconnectedPins; here we
  // flag nets whose ONLY membership is wires (a wire stub touching nothing).
  for (const net of conn.nets) {
    if (net.pins.length > 0) continue;
    const p0 = net.points[0];
    if (p0 === undefined) continue;
    push({
      rule: "dangling-wire",
      severity: "info",
      message: `Wire stub not connected to anything (net ${net.name})`,
      at: p0,
      items: [...conn.wireNet.entries()].filter(([, n]) => n.name === net.name).map(([id]) => id),
    });
  }
}

function checkPinTypeConflicts(doc: SchematicDoc, conn: Connectivity, push: Sink): void {
  for (const net of conn.nets) {
    const outputs: string[] = [];
    const powers: string[] = [];
    for (const key of net.pins) {
      const [instId, pinId] = key.split(":");
      const inst = doc.symbols.find((s) => s.id === instId);
      if (inst === undefined) continue;
      const rp = pinsOf(inst).find((p) => p.pin.id === pinId);
      if (rp === undefined) continue;
      if (rp.pin.etype === "output" || rp.pin.etype === "open-collector") outputs.push(key);
      if (rp.pin.etype === "power-out") powers.push(key);
    }
    const at = net.points[0] ?? { x: 0, y: 0 };
    if (outputs.length >= 2) {
      push({
        rule: "output-conflict",
        severity: "error",
        message: `Net ${net.name} has ${outputs.length} driven outputs fighting each other`,
        at,
        items: outputs,
      });
    }
    if (powers.length >= 2 && !net.isGround) {
      push({
        rule: "power-conflict",
        severity: "error",
        message: `Net ${net.name} is driven by ${powers.length} power sources`,
        at,
        items: powers,
      });
    }
  }
}

function checkLabelIssues(doc: SchematicDoc, conn: Connectivity, push: Sink): void {
  // Unanchored labels.
  for (const id of conn.unanchoredLabels) {
    const label = doc.labels.find((l) => l.id === id);
    const at = label?.at ?? { x: 0, y: 0 };
    push({
      rule: "unanchored-label",
      severity: "warning",
      message: `Label "${label?.text ?? id}" is not attached to a wire or pin`,
      at,
      items: [id],
    });
  }
  // Conflicting names on one net (two different local labels).
  for (const net of conn.nets) {
    const localNames = net.namedBy.filter((n) => n !== "" && n !== "0");
    const unique = [...new Set(localNames)];
    if (unique.length < 2) continue;
    const at = net.points[0] ?? { x: 0, y: 0 };
    push({
      rule: "label-conflict",
      severity: "warning",
      message: `Net has conflicting names: ${unique.join(", ")}`,
      at,
      items: [],
    });
  }
  void symbolById;
}
