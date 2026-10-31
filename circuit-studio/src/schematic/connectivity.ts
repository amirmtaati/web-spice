/**
 * Connectivity (master §9.5 semantics, §9.8 extraction): union-find nets
 * over wires, pins, labels, and power ports. This is the single source of
 * connectivity for ERC, net highlight, and netlist export.
 */

import type { Vec2 } from "../geometry.ts";
import { pointSegmentDist } from "../geometry.ts";
import { symbolById } from "../symbols/index.ts";
import { pinsOf } from "./instances.ts";
import { normalizeWires } from "./normalize.ts";
import type { SchematicDoc, SymbolInstance, Wire } from "./types.ts";

const GROUND_NET = "0";

class UnionFind {
  private readonly parent = new Map<number, number>();

  find(a: number): number {
    let root = a;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) break;
      if (p === root) break;
      root = p;
    }
    // Path compress.
    let cur = a;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  add(a: number): void {
    if (!this.parent.has(a)) this.parent.set(a, a);
  }

  union(a: number, b: number): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface NetInfo {
  readonly name: string;
  /** Wire points on this net (normalized document points). */
  readonly points: readonly Vec2[];
  /** "instId:pinId" members. */
  readonly pins: readonly string[];
  /** Ground net if aliased to 0. */
  readonly isGround: boolean;
  /** The label/power text that named the net, if any. */
  readonly namedBy: readonly string[];
}

export interface Connectivity {
  readonly nets: readonly NetInfo[];
  readonly pinNet: ReadonlyMap<string, NetInfo>;
  /** wire id → net name (for highlight). */
  readonly wireNet: ReadonlyMap<string, NetInfo>;
  /** Labels that failed to anchor on any wire/pin (ERC uses this). */
  readonly unanchoredLabels: readonly string[];
}

const pk = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * Insert a vertex into every wire segment whose interior (or endpoint)
 * contains one of the attach points. Pure; returns new wire objects only
 * when a vertex was added.
 */
function insertInteriorVertices(wires: readonly Wire[], points: readonly Vec2[]): readonly Wire[] {
  if (points.length === 0) return wires;
  return wires.map((w) => {
    let changed = false;
    const pts: Vec2[] = [];
    for (const p of w.pts) pts.push(p);
    for (const t of points) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a === undefined || b === undefined) continue;
        if ((a.x === t.x && a.y === t.y) || (b.x === t.x && b.y === t.y)) continue;
        if (pointSegmentDist(t, a, b) <= 1) {
          pts.splice(i + 1, 0, t);
          changed = true;
          i++;
        }
      }
    }
    return changed ? { id: w.id, pts } : w;
  });
}

/**
 * Normalize wires (merging/splitting/junctions) and compute nets. Deterministic:
 * net numbering follows sorted representative points, so equal documents
 * produce identical netlists.
 */
export function computeConnectivity(doc: SchematicDoc): Connectivity {
  const norm = normalizeWires(
    doc.wires,
    doc.junctions.map((j) => j.at),
  );

  // Pins (for interior attachment + membership).
  interface PinRef {
    readonly inst: SymbolInstance;
    readonly pinId: string;
    readonly pinNum: string;
    readonly pinName: string;
    readonly etype: string;
    readonly at: Vec2;
    readonly defId: string;
  }
  const pinRefs: PinRef[] = [];
  for (const inst of doc.symbols) {
    for (const rp of pinsOf(inst)) {
      pinRefs.push({
        inst,
        pinId: rp.pin.id,
        pinNum: rp.pin.num,
        pinName: rp.pin.name,
        etype: rp.pin.etype,
        at: rp.at,
        defId: inst.defId,
      });
    }
  }

  interface LabelRef {
    readonly id: string;
    readonly kind: string;
    readonly text: string;
    readonly at: Vec2;
  }
  const labelRefs: LabelRef[] = doc.labels.map((l) => ({
    id: l.id,
    kind: l.kind,
    text: l.text,
    at: l.at,
  }));
  for (const inst of doc.symbols) {
    const d = symbolById(inst.defId);
    if (d?.spice.netAlias === undefined) continue;
    const pin0 = pinsOf(inst)[0];
    if (pin0 === undefined) continue;
    const text =
      inst.fields.net ??
      inst.props.net ??
      d.fields.find((f) => f.key === "net")?.defaultText ??
      d.id;
    labelRefs.push({ id: inst.id, kind: "power", text, at: pin0.at });
  }

  // Insert vertices for pins/labels/explicit junctions that sit on a wire
  // segment's interior — they join the net by exact point match below. (A
  // pin snapped to a wire end is already a vertex; this covers a wire drawn
  // straight through a pin, and user-placed junction dots on crossings.)
  const attachPoints: Vec2[] = [
    ...doc.junctions.map((j) => j.at),
    ...pinRefs.map((p) => p.at),
    ...labelRefs.map((l) => l.at),
  ];
  const wires = insertInteriorVertices(norm.wires, attachPoints);

  // Point → union-find node id.
  const ids = new Map<string, number>();
  const pointOf = new Map<number, Vec2>();
  const node = (p: Vec2): number => {
    const k = pk(p);
    const existing = ids.get(k);
    if (existing !== undefined) return existing;
    const id = ids.size;
    ids.set(k, id);
    pointOf.set(id, p);
    return id;
  };

  const uf = new UnionFind();

  // All wire polyline points join along the wire.
  for (const w of wires) {
    const first = w.pts[0];
    if (first === undefined) continue;
    let prev = node(first);
    for (const p of w.pts.slice(1)) {
      const cur = node(p);
      uf.union(prev, cur);
      prev = cur;
    }
  }

  // Explicit junction points exist even if ≥ 3 ends not reached (kept while
  // they touch ≥ 2 points — normalization drops degenerate ones later).
  for (const j of doc.junctions) node(j.at);

  for (const p of pinRefs) uf.union(node(p.at), node(p.at));

  for (const l of labelRefs) node(l.at);

  // Ground and power aliases union implicitly by position; naming happens below.

  // Group nodes into nets.
  const groups = new Map<number, number[]>();
  for (const [k, id] of ids) {
    void k;
    const root = uf.find(id);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [id]);
    else list.push(id);
  }

  // Pin membership per point.
  const pinsAtPoint = new Map<string, PinRef[]>();
  for (const p of pinRefs) {
    const k = pk(p.at);
    const list = pinsAtPoint.get(k);
    if (list === undefined) pinsAtPoint.set(k, [p]);
    else list.push(p);
  }

  const labelsAtPoint = new Map<string, LabelRef[]>();
  for (const l of labelRefs) {
    const k = pk(l.at);
    const list = labelsAtPoint.get(k);
    if (list === undefined) labelsAtPoint.set(k, [l]);
    else list.push(l);
  }

  const anchoredLabelIds = new Set<string>();

  // Deterministic ordering: sort groups by their lexicographically smallest
  // point key.
  const smallest = (members: readonly number[]): string => {
    let m = "~~~~~~~~";
    for (const id of members) {
      const p = pointOf.get(id);
      if (p === undefined) continue;
      const k = pk(p);
      if (k < m) m = k;
    }
    return m;
  };
  const ordered = [...groups.values()].sort((a, b) => {
    const ka = smallest(a);
    const kb = smallest(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const nets: NetInfo[] = [];
  const pinNet = new Map<string, NetInfo>();
  const wireNet = new Map<string, NetInfo>();
  let netCounter = 0;

  for (const members of ordered) {
    const points = members.flatMap((id) => {
      const p = pointOf.get(id);
      return p === undefined ? [] : [p];
    });
    const pins: string[] = [];
    const names: string[] = [];
    let isGround = false;

    for (const p of points) {
      const k = pk(p);
      for (const pr of pinsAtPoint.get(k) ?? []) {
        pins.push(`${pr.inst.id}:${pr.pinId}`);
        const d = symbolById(pr.defId);
        if (d?.spice.netAlias !== undefined) {
          const alias = pr.inst.fields.net ?? pr.inst.props.net ?? "NET";
          if (alias === "GND" || alias === "0") {
            isGround = true;
            names.push(GROUND_NET);
          } else {
            names.push(alias);
          }
        }
      }
      for (const l of labelsAtPoint.get(k) ?? []) {
        if (l.text !== "") names.push(l.text);
        if (l.kind === "power" && (l.text === "GND" || l.text === "0")) isGround = true;
      }
    }

    const name = isGround
      ? GROUND_NET
      : (names.find((n) => n !== "" && n !== GROUND_NET) ?? `net_${netCounter++}`);

    const info: NetInfo = {
      name,
      points,
      pins,
      isGround,
      namedBy: [...new Set(names)],
    };
    nets.push(info);
    for (const pinKey of pins) pinNet.set(pinKey, info);
  }

  // Wire → net: a wire belongs to the net of its first point's group.
  const netByPoint = new Map<string, NetInfo>();
  for (const n of nets) for (const p of n.points) netByPoint.set(pk(p), n);
  for (const w of wires) {
    const p0 = w.pts[0];
    if (p0 === undefined) continue;
    const n = netByPoint.get(pk(p0));
    if (n !== undefined) wireNet.set(w.id, n);
  }

  // A label is anchored iff its net also touches a wire or a pin — not when
  // it floats in space (which forms its own single-point group).
  const netNamesWithWires = new Set<string>();
  for (const n of wireNet.values()) netNamesWithWires.add(n.name);
  for (const n of nets) {
    const touchesAnything = n.pins.length > 0 || netNamesWithWires.has(n.name);
    if (!touchesAnything) continue;
    for (const p of n.points) {
      for (const l of labelsAtPoint.get(pk(p)) ?? []) anchoredLabelIds.add(l.id);
    }
  }
  const unanchoredLabels = labelRefs.map((l) => l.id).filter((id) => !anchoredLabelIds.has(id));

  return { nets, pinNet, wireNet, unanchoredLabels };
}
