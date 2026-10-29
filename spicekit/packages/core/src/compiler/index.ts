/**
 * Compiler (SPEC §5.2): resolve params and `{expr}` values, assign node
 * indices (case-insensitive, "0" = ground), allocate branch-current unknowns
 * (V, L, E, H), run pre-flight checks with typed located errors, and emit
 * compiled element records ready for device construction.
 *
 * Pre-flight (§5.2): duplicate names, missing ground, floating nodes (no DC
 * path via R/L/V/E/H to ground), voltage-source loops (union-find over
 * V/E/H-bridged nodes), unknown models, bad values, subcircuit/behavioral
 * instantiation deferred to E2/E3 with explicit E_NOT_IMPLEMENTED.
 */

import { type Circuit, type Element, EngineError } from "@spicekit/protocol";

import { ParamScope, resolveExpr } from "../eval/index.ts";
import {
  builtinModel,
  canonicalModelType,
  modelTypeMismatch,
  unknownModelParams,
} from "../models/index.ts";
import {
  checkControls,
  checkCouplings,
  checkGroundAndFloating,
  checkModelRefs,
  checkSourceLoops,
} from "./checks.ts";
import { expandSubcircuits } from "./subckt.ts";

export type { CompiledCircuit, CompiledElement, CompileWarning } from "./types.ts";

import type { CompiledCircuit, CompiledElement, CompileWarning } from "./types.ts";

const MAX_ELEMENTS = 50_000; // SPEC §16 resource limits
const MAX_NODES = 50_000;

export function compile(irInput: Circuit): CompiledCircuit {
  // Subcircuit expansion (E3) runs first: X instances flatten into plain
  // elements with hierarchical names, so every later stage sees a flat IR.
  const ir = expandSubcircuits(irInput);
  if (ir.elements.length > MAX_ELEMENTS) {
    throw limitError(`Circuit has ${ir.elements.length} elements (limit ${MAX_ELEMENTS})`);
  }
  const params = resolveParams(ir);
  const scope = new ParamScope(params, ir.options.temp);
  const warnings: CompileWarning[] = [];

  const nodeIndex = new Map<string, number>();
  const nodeNames: string[] = [];
  const nodeOf = (name: string): number => {
    const lower = name.toLowerCase();
    if (lower === "0") {
      return -1; // ground
    }
    const existing = nodeIndex.get(lower);
    if (existing !== undefined) {
      return existing;
    }
    if (nodeNames.length >= MAX_NODES) {
      throw limitError(`Circuit has more than ${MAX_NODES} nodes`);
    }
    const index = nodeNames.length;
    nodeNames.push(name);
    nodeIndex.set(lower, index);
    return index;
  };

  const elements: CompiledElement[] = [];
  const branchByName = new Map<string, number>();
  const branchOwners: string[] = [];
  const nameSet = new Set<string>();
  // IR node tuples are typed with fixed arity; the parser always fills every
  // slot, so indexing is provably in-range (noUncheckedIndexedAccess only
  // sees an array). nd() centralizes the assertion.
  const nd = (arr: readonly string[], i: number): string => arr[i] as string;

  for (const el of ir.elements) {
    checkName(el, nameSet);
    rejectDeferred(el);
    const ce: CompiledElement = { element: el, type: el.type, name: el.name, nodes: [] };
    switch (el.type) {
      case "R": {
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.value = positive(resolveExpr(el.value, scope), el.name, "resistance");
        if (el.tc1 !== undefined) {
          ce.tc1 = el.tc1;
        }
        if (el.tc2 !== undefined) {
          ce.tc2 = el.tc2;
        }
        break;
      }
      case "C":
      case "L": {
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.value =
          el.type === "C"
            ? nonNegative(resolveExpr(el.value, scope), el.name, "capacitance")
            : positive(resolveExpr(el.value, scope), el.name, "inductance");
        if (el.ic !== undefined) {
          ce.ic = el.ic;
        }
        if (el.type === "L") {
          // Inductor current is an MNA unknown (branch equation v = L di/dt).
          ce.branch = branchCount0(branchOwners);
          branchByName.set(el.name.toLowerCase(), ce.branch);
          branchOwners.push(el.name);
        }
        break;
      }
      case "K": {
        ce.value = coupling(resolveExpr(el.coupling, scope), el.name);
        break;
      }
      case "V":
      case "I": {
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.dc = el.dc !== undefined ? resolveExpr(el.dc, scope) : defaultDc(el, warnings);
        if (el.type === "V") {
          ce.branch = branchCount0(branchOwners);
          branchByName.set(el.name.toLowerCase(), ce.branch);
          branchOwners.push(el.name);
        }
        break;
      }
      case "E":
      case "G": {
        ce.nodes = el.n.map((n) => nodeOf(n));
        ce.value = numericExtra(el, el.type === "E" ? "gain" : "gm", el.name, scope);
        if (el.type === "E") {
          // VCVS defines a branch current unknown; G (VCCS) does not.
          ce.branch = branchCount0(branchOwners);
          branchByName.set(el.name.toLowerCase(), ce.branch);
          branchOwners.push(el.name);
        }
        break;
      }
      case "F":
      case "H": {
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.value = numericExtra(el, "gain", el.name, scope);
        ce.controlName = stringExtra(el, "control");
        if (el.type === "H") {
          ce.branch = branchCount0(branchOwners);
          branchByName.set(el.name.toLowerCase(), ce.branch);
          branchOwners.push(el.name);
        }
        break;
      }
      case "D":
      case "Q":
      case "J": {
        ce.nodes = el.n.map((n) => nodeOf(n));
        if (el.area !== undefined) {
          ce.area = el.area;
        }
        resolveModel(ce, ir, scope, warnings);
        if (el.type === "Q") {
          // Parasitic RB/RC/RE get real internal MNA nodes (b', c', e') so
          // the junction limiting sees the actual junction voltages — the
          // folded-composite alternative is ill-conditioned for the coupled
          // 2×2 BJT system (SPEC §5.7, ngspice-44 internal-node structure).
          const mp = ce.modelParams ?? {};
          const rs = [mp.rb ?? 0, mp.rc ?? 0, mp.re ?? 0];
          if (rs.some((r) => r > 0)) {
            const owned: number[] = [];
            for (const r of rs) {
              if (r > 0) {
                owned.push(branchCount0(branchOwners));
                branchOwners.push(`${el.name}#internal${owned.length}`);
              }
            }
            ce.branches = owned;
          }
        }
        break;
      }
      case "M": {
        ce.nodes = el.n.map((n) => nodeOf(n));
        resolveModel(ce, ir, scope, warnings);
        if (el.w !== undefined) {
          ce.w = resolveExpr(el.w, scope);
        }
        if (el.l !== undefined) {
          ce.l = resolveExpr(el.l, scope);
        }
        break;
      }
      case "S": {
        // Sxxx n+ n- nc+ nc- mname [ON|OFF]: element terminals first, then
        // the control terminals (the switch device reads positions 0..3).
        ce.nodes = [
          nodeOf(nd(el.n, 0)),
          nodeOf(nd(el.n, 1)),
          nodeOf(el.ctrl[0]),
          nodeOf(el.ctrl[1]),
        ];
        if (el.on !== undefined) {
          ce.on = el.on;
        }
        resolveModel(ce, ir, scope, warnings);
        break;
      }
      case "W": {
        // Wxxx n+ n- vsource mname [ON|OFF]
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.controlName = el.control;
        if (el.on !== undefined) {
          ce.on = el.on;
        }
        resolveModel(ce, ir, scope, warnings);
        break;
      }
      case "B": {
        // Behavioral source: nodes + expression payload; a V-kind B owns a
        // branch unknown (v_p − v_n = f) exactly like E/H (I-kind is matrix
        // and rhs only, like G). Expression validity is checked by the
        // device's dual compiler (operator names resolve against the full
        // node/branch tables there).
        ce.nodes = [nodeOf(nd(el.n, 0)), nodeOf(nd(el.n, 1))];
        ce.kind = el.kind;
        ce.expr = el.expr;
        if (el.kind === "V") {
          ce.branch = branchCount0(branchOwners);
          branchByName.set(el.name.toLowerCase(), ce.branch);
          branchOwners.push(el.name);
        }
        break;
      }
      case "X": {
        // Unreachable after expandSubcircuits — X instances are flattened
        // away; a residual one means an undefined subcircuit (already
        // reported by the expander). Kept for exhaustive switching.
        throw new EngineError({
          code: "E_UNKNOWN_MODEL",
          message: `${el.name} instantiates unknown subcircuit "${el.subckt}"`,
          location: { elementName: el.name },
        });
      }
      default: {
        // Exhaustive over the Element union; unreachable for valid IR.
        throw new EngineError({ code: "E_PARSE", message: "Unsupported element type" });
      }
    }
    elements.push(ce);
  }

  const compiled: CompiledCircuit = {
    probes: ir.probes,
    ...(ir.measures !== undefined ? { measures: ir.measures } : {}),
    ...(ir.ic !== undefined ? { ic: ir.ic } : {}),
    nodeNames,
    nodeCount: nodeNames.length,
    branchCount: branchOwners.length,
    branchOwners,
    branchByName,
    elements,
    options: ir.options,
    params,
    warnings,
  };
  checkGroundAndFloating(compiled);
  checkSourceLoops(compiled);
  checkModelRefs(ir);
  checkControls(compiled);
  checkCouplings(ir);
  // Branch unknowns occupy MNA rows after the node voltages: convert the
  // allocation indices used during compilation into absolute MNA offsets.
  const nodeTotal = nodeNames.length;
  for (const ce of elements) {
    if (ce.branch !== undefined) {
      ce.branch += nodeTotal;
    }
    if (ce.branches !== undefined) {
      ce.branches = ce.branches.map((b) => b + nodeTotal);
    }
    if ((ce.type === "F" || ce.type === "H" || ce.type === "W") && ce.controlBranch !== undefined) {
      ce.controlBranch += nodeTotal;
    }
  }
  return compiled;
}

function branchCount0(owners: string[]): number {
  return owners.length;
}

/**
 * Resolve the `.model` card for a model-backed element (D/Q/M/J/S/W) into
 * numeric parameters (SPEC §5.2 "resolved model parameters"). String param
 * values are expressions evaluated against the parameter scope. The model
 * reference itself is validated by checkModelRefs (netlist cards and
 * built-in library cards both satisfy it; the netlist card wins).
 */
function resolveModel(
  ce: CompiledElement,
  ir: Circuit,
  scope: ParamScope,
  warnings: CompileWarning[],
): void {
  const el = ce.element as Extract<Element, { model: string }>;
  const card = ir.models[el.model.toLowerCase()] ?? builtinModel(el.model);
  if (card === undefined) {
    return; // checkModelRefs already reported E_UNKNOWN_MODEL
  }
  const mismatch = modelTypeMismatch(el.type, card.type);
  if (mismatch !== undefined) {
    throw new EngineError({
      code: "E_BAD_MODEL",
      message: `${el.name}: ${mismatch}`,
      location: { elementName: el.name },
    });
  }
  // Canonical type (long spellings like "diode" normalize to "d") — the
  // devices and the parameter schema key on the canonical form.
  const canon = canonicalModelType(card.type) ?? card.type;
  ce.modelType = canon;
  const params: Record<string, number> = {};
  for (const [key, raw] of Object.entries(card.parameters)) {
    if (typeof raw === "number") {
      params[key.toLowerCase()] = raw;
    } else {
      try {
        params[key.toLowerCase()] = resolveExpr(raw, scope);
      } catch {
        warnings.push({
          code: "W_MODEL_PARAM",
          message: `${ce.name}: cannot evaluate model parameter ${key}="${raw}"; ignored`,
          elementName: ce.name,
        });
      }
    }
  }
  // Unknown parameter names are almost always typos that would otherwise
  // silently fall back to device defaults (model library schema, SPEC §5.2).
  for (const key of unknownModelParams(canon, card.parameters)) {
    warnings.push({
      code: "W_MODEL_PARAM_UNKNOWN",
      message: `${el.name}: model "${card.name}" has no parameter "${key}" for type "${card.type}"; ignored`,
      elementName: el.name,
    });
  }
  ce.modelParams = params;
}

function defaultDc(el: Extract<Element, { type: "V" | "I" }>, warnings: CompileWarning[]): number {
  warnings.push({
    code: "W_DEFAULT_DC",
    message: `${el.name} has no DC value; defaulting to 0`,
    elementName: el.name,
  });
  return 0;
}

function numericExtra(el: Element, key: string, name: string, scope?: ParamScope): number {
  const raw = (el as Record<string, unknown>)[key];
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw badGain(name, key);
    }
    return raw;
  }
  // Expression form ({...} from the netlist): resolve against the scope.
  if (typeof raw === "string" && scope !== undefined) {
    try {
      const v = resolveExpr(raw, scope);
      if (Number.isFinite(v)) {
        return v;
      }
    } catch {
      // fall through to the located error below
    }
  }
  throw badGain(name, key);
}

function badGain(name: string, key: string): EngineError {
  return new EngineError({
    code: "E_PARSE",
    message: `${name} is missing a finite ${key}`,
    location: { elementName: name },
  });
}

function stringExtra(el: Element, key: string): string {
  const raw = (el as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : "";
}

function resolveParams(ir: Circuit): Record<string, number> {
  const scope = new ParamScope(ir.params, ir.options.temp);
  const out: Record<string, number> = {};
  for (const key of Object.keys(ir.params)) {
    const value = scope.param(key);
    if (value === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `Parameter "${key}" could not be resolved`,
      });
    }
    out[key.toLowerCase()] = value;
  }
  return out;
}

function checkName(el: Element, seen: Set<string>): void {
  const lower = el.name.toLowerCase();
  if (seen.has(lower)) {
    throw new EngineError({
      code: "E_PARSE",
      message: `Duplicate element name "${el.name}"`,
      location: { elementName: el.name },
    });
  }
  seen.add(lower);
}

const IMPLEMENTED_TYPES = new Set([
  "R",
  "C",
  "L",
  "K",
  "V",
  "I",
  "E",
  "G",
  "F",
  "H",
  "B",
  "D",
  "Q",
  "M",
  "J",
  "S",
  "W",
]);

function rejectDeferred(el: Element): void {
  if (!IMPLEMENTED_TYPES.has(el.type)) {
    throw new EngineError({
      code: "E_NOT_IMPLEMENTED",
      message: `Element type "${el.type}" is not implemented yet`,
      location: { elementName: el.name },
    });
  }
}

function positive(v: number, name: string, what: string): number {
  if (!(v > 0) || !Number.isFinite(v)) {
    throw new EngineError({
      code: "E_PARSE",
      message: `${name}: ${what} must be > 0 (got ${v})`,
      location: { elementName: name },
    });
  }
  return v;
}

function nonNegative(v: number, name: string, what: string): number {
  if (!(v >= 0) || !Number.isFinite(v)) {
    throw new EngineError({
      code: "E_PARSE",
      message: `${name}: ${what} must be >= 0 (got ${v})`,
      location: { elementName: name },
    });
  }
  return v;
}

function coupling(v: number, name: string): number {
  if (!(v > 0 && v < 1)) {
    throw new EngineError({
      code: "E_PARSE",
      message: `${name}: coupling coefficient must be in (0, 1) — k=1 makes the inductance matrix singular`,
      location: { elementName: name },
    });
  }
  return v;
}

function limitError(message: string): EngineError {
  return new EngineError({ code: "E_LIMIT_EXCEEDED", message });
}
