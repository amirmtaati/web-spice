/**
 * Compiler pre-flight checks (SPEC §5.2): ground presence, floating nodes
 * (no DC path to ground through R/L/V/E/H), voltage-source loops, unknown
 * model references, F/H controlling-source resolution, and K inductor
 * references. Each failure is a typed, located EngineError so the UI can
 * highlight the culprit (SPEC §4.3).
 */

import { type Circuit, EngineError } from "@spicekit/protocol";
import type { CompiledCircuit } from "./types.ts";

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root] as number;
    }
    let current = x;
    while (this.parent[current] !== root) {
      const next = this.parent[current] as number;
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent[rb] = ra;
    }
  }
}

/**
 * DC-conduction node roles per element type: which of the element's compiled
 * nodes join their group into one DC component for the floating check.
 * C is open at DC; I/G/B are open circuits; the MOS gate is insulated (its
 * DC path runs through the bulk junctions d-s-b only). Nonlinear junction
 * devices conduct (leakage) at DC, so a node held only through them still
 * has a DC path — matching what the MNA matrix can actually solve.
 */
const DC_CONDUCTION_NODES: Readonly<Record<string, readonly number[]>> = {
  R: [0, 1],
  L: [0, 1],
  V: [0, 1],
  E: [0, 1],
  H: [0, 1],
  D: [0, 1],
  Q: [0, 1, 2], // b-e, b-c junctions conduct
  M: [0, 2, 3], // d, s, b (bulk diodes); gate excluded (insulated)
  J: [0, 1, 2], // gate junctions conduct
  S: [0, 1, 2, 3],
  W: [0, 1],
};

export function checkGroundAndFloating(compiled: CompiledCircuit): void {
  if (compiled.nodeCount === 0) {
    throw new EngineError({
      code: "E_FLOATING_NODE",
      message: "Circuit has no non-ground nodes (empty circuit?)",
    });
  }
  let hasGround = false;
  for (const el of compiled.elements) {
    if (el.nodes.some((n) => n === -1)) {
      hasGround = true;
      break;
    }
  }
  if (!hasGround) {
    throw new EngineError({
      code: "E_NO_GROUND",
      message: 'Circuit has no ground: no element references node "0"',
    });
  }

  const uf = new UnionFind(compiled.nodeCount);
  for (const el of compiled.elements) {
    const roles = DC_CONDUCTION_NODES[el.type];
    if (roles === undefined) {
      continue;
    }
    const nodes = roles.map((i) => el.nodes[i]).filter((n) => n !== undefined && n >= 0);
    for (let i = 1; i < nodes.length; i++) {
      uf.union(nodes[0] as number, nodes[i] as number);
    }
  }
  // A component is grounded iff some DC-conducting element joins one of its
  // nodes to ground. Elements touching -1 ground the whole component of their
  // other DC-conducting node.
  const groundedRoots = new Set<number>();
  for (const el of compiled.elements) {
    const roles = DC_CONDUCTION_NODES[el.type];
    if (roles === undefined) {
      continue;
    }
    const grounded = roles.some((i) => el.nodes[i] === -1);
    if (!grounded) {
      continue;
    }
    const other = roles.map((i) => el.nodes[i]).find((n) => n !== undefined && n >= 0);
    if (other !== undefined) {
      groundedRoots.add(uf.find(other));
    }
  }
  for (let n = 0; n < compiled.nodeCount; n++) {
    // nodeNames[n] is defined for every n < nodeCount by construction.
    const name = compiled.nodeNames[n] as string;
    if (!groundedRoots.has(uf.find(n))) {
      throw new EngineError({
        code: "E_FLOATING_NODE",
        message: `Node "${name}" has no DC path to ground (add a large resistor or an .ic)`,
        location: { node: name },
      });
    }
  }
}

/**
 * Voltage sources in parallel (directly or via other V/E/H sources) create a
 * loop MNA cannot solve. Union-find over nodes bridged by V/E/H: any
 * component containing two or more source branches is a loop.
 */
export function checkSourceLoops(compiled: CompiledCircuit): void {
  const SOURCES = new Set(["V", "E", "H"]);
  const uf = new UnionFind(Math.max(1, compiled.nodeCount));
  const sourceRoots = new Map<number, string>();
  for (const el of compiled.elements) {
    if (!SOURCES.has(el.type)) {
      continue;
    }
    const [a, b] = [el.nodes[0] as number, el.nodes[1] as number];
    if (a >= 0 && b >= 0) {
      uf.union(a, b);
    }
  }
  for (const el of compiled.elements) {
    if (!SOURCES.has(el.type)) {
      continue;
    }
    const a = el.nodes[0] as number;
    const root = a >= 0 ? uf.find(a) : -1;
    const existing = sourceRoots.get(root);
    if (existing !== undefined) {
      throw new EngineError({
        code: "E_VSOURCE_LOOP",
        message: `Voltage-source loop: ${existing} and ${el.name} are connected through voltage sources only`,
        location: { elementName: el.name },
      });
    }
    sourceRoots.set(root, el.name);
  }
}

export function checkModelRefs(ir: Circuit): void {
  for (const el of ir.elements) {
    if (
      el.type !== "D" &&
      el.type !== "Q" &&
      el.type !== "M" &&
      el.type !== "J" &&
      el.type !== "S" &&
      el.type !== "W"
    ) {
      continue;
    }
    const model = ir.models[el.model.toLowerCase()];
    if (model === undefined) {
      throw new EngineError({
        code: "E_UNKNOWN_MODEL",
        message: `${el.name} references unknown model "${el.model}"`,
        location: { elementName: el.name },
      });
    }
  }
}

/** F/H/W need an existing controlling V source (branch unknown owner). */
export function checkControls(compiled: CompiledCircuit): void {
  for (const el of compiled.elements) {
    if (el.type !== "F" && el.type !== "H" && el.type !== "W") {
      continue;
    }
    const control = el.controlName ?? "";
    const branch = compiled.branchByName.get(control.toLowerCase());
    if (branch === undefined) {
      throw new EngineError({
        code: "E_PARSE",
        message: `${el.name} controls on "${control}", which is not a voltage source (F/H/W require a V element)`,
        location: { elementName: el.name },
      });
    }
    el.controlBranch = branch;
  }
}

/** K cards must reference existing inductors. */
export function checkCouplings(ir: Circuit): void {
  const lByName = new Set<string>();
  for (const el of ir.elements) {
    if (el.type === "L") {
      lByName.add(el.name.toLowerCase());
    }
  }
  for (const k of ir.elements) {
    if (k.type !== "K") {
      continue;
    }
    for (const ref of k.inductors) {
      if (!lByName.has(ref.toLowerCase())) {
        throw new EngineError({
          code: "E_PARSE",
          message: `${k.name} references unknown inductor "${ref}"`,
          location: { elementName: k.name },
        });
      }
    }
  }
}
