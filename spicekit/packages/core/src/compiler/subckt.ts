/**
 * Subcircuit expansion (E3, SPEC §5.2/§5.7): flatten X instances into the
 * parent circuit before compilation. Semantics (classic SPICE hierarchy):
 *
 *  - Ports map positionally to the X card's node list; ground stays ground.
 *  - Internal node and element names are prefixed with the instance path
 *    (`x1.r2`, nested `xmid.xleaf.r1`) so instances never collide.
 *  - Models are global (classic SPICE): body-defined model cards are hoisted
 *    under their own name — EXCEPT cards whose parameters are expressions
 *    referencing instance parameters (e.g. `is={ISD}`); those are frozen
 *    against the instance scope and emitted under the instance-prefixed
 *    name, with that instance's references rewritten to it.
 *  - Parameters (ngspice order): instance params are assigned first;
 *    subckt-line defaults apply only to keys the instance did not override,
 *    and their expressions see the final instance values. Element values in
 *    the body freeze against this scope at expansion time (multi-instance
 *    correctness); names that do not resolve stay expressions for the
 *    compiler to diagnose against the global parameter table.
 *  - Nested X instances recurse; the element path joins (`x1.x2.r3`).
 *
 * Built-in macromodel subcircuits (op-amp ideal / single-pole GBW) resolve
 * through `builtinSubckt` when the IR does not define the name.
 */

import {
  type Circuit,
  type Element,
  EngineError,
  type ModelCard,
  type Subcircuit,
} from "@spicekit/protocol";

import { ParamScope, resolveExpr } from "../eval/index.ts";
import { builtinSubckt } from "../models/index.ts";

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 50_000; // SPEC §16 — total after flattening

export function expandSubcircuits(ir: Circuit): Circuit {
  const count = { n: 0 };
  const models: Circuit["models"] = { ...ir.models };
  const elements: Element[] = [];
  for (const el of ir.elements) {
    if (el.type !== "X") {
      count.n += 1;
      elements.push(el);
      continue;
    }
    const r = instantiate(el, ir, ir.subcircuits, "", count);
    elements.push(...r.elements);
    Object.assign(models, r.models);
  }
  return {
    title: ir.title,
    elements,
    models,
    subcircuits: ir.subcircuits,
    params: ir.params,
    options: ir.options,
    analyses: ir.analyses,
    probes: ir.probes,
    ...(ir.measures !== undefined ? { measures: ir.measures } : {}),
    ...(ir.ic !== undefined ? { ic: ir.ic } : {}),
  };
}

interface InstanceResult {
  elements: Element[];
  /** Instance-frozen, prefixed model cards contributed by this instance. */
  models: Record<string, ModelCard>;
}

function lookupSubckt(name: string, defs: Record<string, Subcircuit>): Subcircuit | undefined {
  return defs[name.toLowerCase()] ?? builtinSubckt(name);
}

/** Expand one X instance into fully-rewritten flat elements. */
function instantiate(
  el: Extract<Element, { type: "X" }>,
  parentIr: Circuit,
  visibleSubckts: Record<string, Subcircuit>,
  prefix: string,
  count: { n: number },
): InstanceResult {
  if (prefix.split(".").length - 1 > MAX_DEPTH) {
    throw new EngineError({
      code: "E_LIMIT_EXCEEDED",
      message: `Subcircuit nesting deeper than ${MAX_DEPTH} at ${el.name}`,
      location: { elementName: el.name },
    });
  }
  const def = lookupSubckt(el.subckt, visibleSubckts);
  if (def === undefined) {
    throw new EngineError({
      code: "E_UNKNOWN_MODEL",
      message: `${el.name} instantiates unknown subcircuit "${el.subckt}"`,
      location: { elementName: el.name },
    });
  }
  if (def.ports.length !== el.n.length) {
    throw new EngineError({
      code: "E_PARSE",
      message: `${el.name}: subcircuit "${el.subckt}" expects ${def.ports.length} nodes, got ${el.n.length}`,
      location: { elementName: el.name },
    });
  }
  const childPrefix = `${prefix}${el.name}.`;

  // Parameter scope (ngspice order — see file header).
  const scopeParams: Record<string, number | string> = { ...parentIr.params };
  const scope = new ParamScope(scopeParams, def.circuit.options.temp);
  const applyEntry = (key: string, raw: number | string): void => {
    if (typeof raw === "number") {
      scopeParams[key.toLowerCase()] = raw;
      return;
    }
    try {
      scopeParams[key.toLowerCase()] = resolveExpr(raw, scope);
    } catch {
      scopeParams[key.toLowerCase()] = raw;
    }
  };
  const instanceKeys = new Set<string>();
  for (const [k, v] of Object.entries(el.params ?? {})) {
    applyEntry(k, v);
    instanceKeys.add(k.toLowerCase());
  }
  for (const [k, v] of Object.entries(def.circuit.params)) {
    if (!instanceKeys.has(k.toLowerCase())) {
      applyEntry(k, v);
    }
  }
  const instScope = new ParamScope(scopeParams, def.circuit.options.temp);

  // Port map: subckt port name → external node name.
  const portMap = new Map<string, string>();
  def.ports.forEach((port, i) => {
    portMap.set(port.toLowerCase(), el.n[i] as string);
  });
  const mapNode = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower === "0") {
      return "0";
    }
    return portMap.get(lower) ?? `${childPrefix}${name}`;
  };

  // Model handling: parametrized body cards (any expression parameter) are
  // frozen and prefixed per instance; plain cards stay global.
  const bodyModels = def.circuit.models;
  const prefixedModels = new Map<string, string>(); // original lower → prefixed
  const modelCards: Record<string, ModelCard> = {};
  for (const [name, card] of Object.entries(bodyModels)) {
    const lower = name.toLowerCase();
    if (Object.values(card.parameters).some((v) => typeof v === "string")) {
      const frozen: ModelCard = {
        name: `${childPrefix}${card.name}`,
        type: card.type,
        parameters: Object.fromEntries(
          Object.entries(card.parameters).map(([k, v]) => [
            k,
            typeof v === "string" ? resolveInScope(v, instScope) : v,
          ]),
        ),
      };
      // Keys are lowercase for consistency with the parser's model table.
      const prefixed = `${childPrefix}${name}`.toLowerCase();
      modelCards[prefixed] = frozen;
      prefixedModels.set(lower, prefixed);
    } else {
      modelCards[name] = card;
    }
  }
  const mapModel = (ref: string): string => prefixedModels.get(ref.toLowerCase()) ?? ref;

  const elements: Element[] = [];
  const childSubckts = { ...visibleSubckts, ...def.circuit.subcircuits };
  for (const inner of def.circuit.elements) {
    count.n += 1;
    if (count.n > MAX_ELEMENTS) {
      throw limitError(`Circuit has more than ${MAX_ELEMENTS} elements after subcircuit expansion`);
    }
    if (inner.type === "X") {
      // Nested instance: recurse with the joined path; its returned nodes
      // (port positions) are names in THIS body's namespace, so remap them.
      const nested = instantiate(inner, def.circuit, childSubckts, childPrefix, count);
      for (const e of nested.elements) {
        elements.push(rewriteElement(e, mapNode, mapModel, instScope, false));
      }
      Object.assign(modelCards, nested.models);
      continue;
    }
    elements.push(rewriteElement(inner, mapNode, mapModel, instScope, true, childPrefix));
  }
  return { elements, models: modelCards };
}

/** Resolve an Expr against the instance scope; strings that fail stay. */
function resolveInScope(expr: number | string, scope: ParamScope): number | string {
  if (typeof expr === "number") {
    return expr;
  }
  try {
    return resolveExpr(expr, scope);
  } catch {
    return expr;
  }
}

/**
 * Rewrite one body element: prefix the name (optionally — nested instances
 * arrive pre-prefixed), remap nodes, rewrite scoped model references, and
 * freeze parameterized values against the instance scope.
 */
function rewriteElement(
  el: Element,
  mapNode: (n: string) => string,
  mapModel: (m: string) => string,
  scope: ParamScope,
  renameNames: boolean,
  prefix = "",
): Element {
  const rename = (name: string): string => (renameNames ? `${prefix}${name}` : name);
  const val = (expr: number | string): number | string => resolveInScope(expr, scope);
  const nodes2 = (a: readonly string[]): [string, string] => [
    mapNode(a[0] as string),
    mapNode(a[1] as string),
  ];
  const nodes3 = (a: readonly string[]): [string, string, string] => [
    mapNode(a[0] as string),
    mapNode(a[1] as string),
    mapNode(a[2] as string),
  ];
  const nodes4 = (a: readonly string[]): [string, string, string, string] => [
    mapNode(a[0] as string),
    mapNode(a[1] as string),
    mapNode(a[2] as string),
    mapNode(a[3] as string),
  ];
  switch (el.type) {
    case "R":
      return {
        type: "R",
        name: rename(el.name),
        n: nodes2(el.n),
        value: val(el.value),
        ...(el.tc1 !== undefined ? { tc1: el.tc1 } : {}),
        ...(el.tc2 !== undefined ? { tc2: el.tc2 } : {}),
      };
    case "C":
      return {
        type: "C",
        name: rename(el.name),
        n: nodes2(el.n),
        value: val(el.value),
        ...(el.ic !== undefined ? { ic: el.ic } : {}),
      };
    case "L":
      return {
        type: "L",
        name: rename(el.name),
        n: nodes2(el.n),
        value: val(el.value),
        ...(el.ic !== undefined ? { ic: el.ic } : {}),
      };
    case "K":
      return {
        type: "K",
        name: rename(el.name),
        inductors: [rename(el.inductors[0]), rename(el.inductors[1])],
        coupling: el.coupling,
      };
    case "V":
    case "I":
      return {
        type: el.type,
        name: rename(el.name),
        n: nodes2(el.n),
        ...(el.dc !== undefined ? { dc: val(el.dc) } : {}),
        ...(el.ac !== undefined ? { ac: el.ac } : {}),
        ...(el.wave !== undefined ? { wave: el.wave } : {}),
      };
    case "E":
    case "G":
      return {
        type: el.type,
        name: rename(el.name),
        n: el.n.map(mapNode),
        gain: val(el.gain as number),
      };
    case "F":
    case "H":
      return {
        type: el.type,
        name: rename(el.name),
        n: el.n.map(mapNode),
        control: rename(el.control as string),
        gain: val(el.gain as number),
      };
    case "B":
      return {
        type: "B",
        name: rename(el.name),
        n: nodes2(el.n),
        kind: el.kind,
        expr: el.expr,
      };
    case "D":
      return {
        type: "D",
        name: rename(el.name),
        n: nodes2(el.n),
        model: mapModel(el.model),
        ...(el.area !== undefined ? { area: el.area } : {}),
      };
    case "Q":
      return {
        type: "Q",
        name: rename(el.name),
        n: nodes3(el.n),
        model: mapModel(el.model),
        ...(el.area !== undefined ? { area: el.area } : {}),
      };
    case "M":
      return {
        type: "M",
        name: rename(el.name),
        n: nodes4(el.n),
        model: mapModel(el.model),
        ...(el.w !== undefined ? { w: val(el.w) } : {}),
        ...(el.l !== undefined ? { l: val(el.l) } : {}),
      };
    case "J":
      return {
        type: "J",
        name: rename(el.name),
        n: nodes3(el.n),
        model: mapModel(el.model),
        ...(el.area !== undefined ? { area: el.area } : {}),
      };
    case "S":
      return {
        type: "S",
        name: rename(el.name),
        n: nodes2(el.n),
        ctrl: nodes2(el.ctrl),
        model: mapModel(el.model),
        ...(el.on !== undefined ? { on: el.on } : {}),
      };
    case "W":
      return {
        type: "W",
        name: rename(el.name),
        n: nodes2(el.n),
        control: rename(el.control),
        model: mapModel(el.model),
        ...(el.on !== undefined ? { on: el.on } : {}),
      };
    case "X":
      // Unreachable: nested instances are expanded by the caller.
      return el;
  }
}

function limitError(message: string): EngineError {
  return new EngineError({ code: "E_LIMIT_EXCEEDED", message });
}
