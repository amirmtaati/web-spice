/**
 * Wire normalization (master §9.5): runs after every edit, is idempotent, and
 * leaves the document in canonical form — zero-length wires removed,
 * redundant collinear points collapsed, overlapping collinear segments
 * merged, T-touches split, and derived junction points computed (≥ 3 wire
 * ends). Overlapping collinear wires merge; a wire passing another's middle
 * (crossing without an endpoint there) never connects.
 */
import { pointSegmentDist } from "../geometry.ts";
import type { Junction, Vec2, Wire } from "./types.ts";

const EPS = 1; // integer coordinates: 1 unit tolerance for touches

interface Seg {
  readonly a: Vec2;
  readonly b: Vec2;
  /** Origin wire id (provenance for id stability). */
  readonly w: string;
}

const vec = (x: number, y: number): Vec2 => ({ x, y });
const eq = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

function key(p: Vec2): string {
  return `${p.x},${p.y}`;
}

/** Segment points ordered canonically (lexicographic) for dedup. */
function canon(s: Seg): Seg {
  return lt(s.b, s.a) ? { a: s.b, b: s.a, w: s.w } : s;
}

function lt(p: Vec2, q: Vec2): boolean {
  return p.x < q.x || (p.x === q.x && p.y < q.y);
}

function colinearDir(s: Seg): "h" | "v" | "free" {
  if (s.a.y === s.b.y) return "h";
  if (s.a.x === s.b.x) return "v";
  return "free";
}

function dist(p: Vec2, s: Seg): number {
  return pointSegmentDist(p, s.a, s.b);
}

function onInterior(p: Vec2, s: Seg): boolean {
  if (eq(p, s.a) || eq(p, s.b)) return false;
  return dist(p, s) <= EPS;
}

/** Split a segment at every touch point (other segments' endpoints, junctions). */
function splitAtTouches(segs: readonly Seg[], touches: readonly Vec2[]): Seg[] {
  let out = [...segs];
  for (const t of touches) {
    const next: Seg[] = [];
    for (const s of out) {
      if (!onInterior(t, s)) {
        next.push(s);
        continue;
      }
      // Split only when the touch is collinear with the segment (a T on the
      // same line). A diagonal endpoint grazing a horizontal interior still
      // splits — connectivity is by position, not direction.
      next.push({ a: s.a, b: t, w: s.w }, { a: t, b: s.b, w: s.w });
    }
    out = next;
  }
  return out;
}

/** Merge collinear horizontal/vertical overlaps; dedupe exact duplicates. */
function mergeOverlaps(segs: readonly Seg[]): Seg[] {
  const seen = new Set<string>();
  const unique: Seg[] = [];
  for (const raw of segs) {
    const s = canon(raw);
    const k = `${key(s.a)}|${key(s.b)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(s);
  }

  const out: Seg[] = [];

  const consume = (bucket: Seg[]): void => {
    // Bucket = collinear segments on one line. Merge by interval sweep.
    const first = bucket[0];
    if (first === undefined) return;
    const horizontal = first.a.y === first.b.y;
    const axis = horizontal ? first.a.y : first.a.x;
    const intervals = bucket.map((s) => {
      const lo = horizontal ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y);
      const hi = horizontal ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y);
      return { lo, hi, s };
    });
    intervals.sort((p, q) => p.lo - q.lo || p.hi - q.hi);
    let cur = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      const n = intervals[i];
      if (n === undefined || cur === undefined) continue;
      if (n.lo <= cur.hi) {
        // Overlapping or touching: extend (provenance of the first).
        cur = { ...cur, hi: Math.max(cur.hi, n.hi) };
      } else {
        emit(cur);
        cur = n;
      }
    }
    if (cur !== undefined) emit(cur);

    function emit(iv: { readonly lo: number; readonly hi: number; readonly s: Seg }): void {
      const a = horizontal ? vec(iv.lo, axis) : vec(axis, iv.lo);
      const b = horizontal ? vec(iv.hi, axis) : vec(axis, iv.hi);
      out.push({ a, b, w: iv.s.w });
    }
  };

  const groups = new Map<string, Seg[]>();
  for (const s of unique) {
    const d = colinearDir(s);
    if (d === "free") {
      out.push(s);
      continue;
    }
    const k = d === "h" ? `h${s.a.y}` : `v${s.a.x}`;
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [s]);
    else list.push(s);
  }
  for (const bucket of groups.values()) consume(bucket);
  return out;
}

/** Chain segments into polylines, preserving provenance wire ids. */
function chain(segs: readonly Seg[]): { wires: Wire[]; usedIds: Set<string> } {
  const remaining = [...segs];
  const wires: Wire[] = [];
  const usedIds = new Set<string>();

  const extend = (pts: Vec2[], end: Vec2, w: string): Vec2[] => {
    let cur = end;
    for (;;) {
      const idx = remaining.findIndex((s) => s.w === w && (eq(s.a, cur) || eq(s.b, cur)));
      if (idx < 0) break;
      const s = remaining[idx];
      if (s === undefined) break;
      remaining.splice(idx, 1);
      cur = eq(s.a, cur) ? s.b : s.a;
      pts.push(cur);
    }
    return pts;
  };

  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (seed === undefined) break;
    const start = extend([seed.b], seed.a, seed.w).reverse();
    const pts = extend([seed.a, ...start], seed.b, seed.w);
    usedIds.add(seed.w);
    wires.push({ id: seed.w, pts });
  }
  return { wires, usedIds };
}

export interface Normalized {
  readonly wires: readonly Wire[];
  /** Derived + surviving explicit junction points (point with ≥ 3 ends). */
  readonly junctions: readonly Vec2[];
  /** Degrees: point → number of wire ends (post-split). */
  readonly endDegrees: ReadonlyMap<string, number>;
}

/**
 * Normalize a wire list. Pure; deterministic; idempotent (normalizing its
 * own output is a no-op). Explicit junctions participate as touch points but
 * are not themselves output here — the caller merges explicit junctions.
 */
export function normalizeWires(
  wires: readonly Wire[],
  explicitJunctions: readonly Vec2[] = [],
): Normalized {
  // Collapse per-wire duplicate consecutive points + drop zero-length.
  const collapsed: Wire[] = wires.flatMap((w) => {
    const pts: Vec2[] = [];
    for (const p of w.pts) {
      const last = pts[pts.length - 1];
      if (last === undefined || !eq(last, p)) pts.push(p);
    }
    return pts.length >= 2 ? [{ id: w.id, pts }] : [];
  });

  // Segments from all wires.
  let segs: Seg[] = collapsed.flatMap((w) =>
    w.pts.slice(0, -1).map((p, i) => ({ a: p, b: w.pts[i + 1] as Vec2, w: w.id })),
  );

  // Touch points: every segment endpoint + explicit junctions. Split any
  // segment whose interior contains them (T-connections).
  const touchKeys = new Set<string>();
  for (const s of segs) {
    touchKeys.add(key(s.a));
    touchKeys.add(key(s.b));
  }
  for (const j of explicitJunctions) touchKeys.add(key(j));
  const touchPoints: Vec2[] = [...touchKeys].map((k) => {
    const [x, y] = k.split(",");
    return vec(Number(x), Number(y));
  });
  segs = splitAtTouches(segs, touchPoints);

  // Dedupe exact duplicates BEFORE degree counting (a wire drawn twice is
  // one connection), then count endpoint degrees for junction derivation.
  const dedupKeys = new Set<string>();
  const deduped: Seg[] = [];
  for (const s of segs) {
    const c = canon(s);
    const k = `${key(c.a)}|${key(c.b)}`;
    if (dedupKeys.has(k)) continue;
    dedupKeys.add(k);
    deduped.push(c);
  }
  const degrees = new Map<string, number>();
  for (const s of deduped) {
    for (const p of [s.a, s.b]) {
      const k = key(p);
      degrees.set(k, (degrees.get(k) ?? 0) + 1);
    }
  }

  // Merge overlaps + rebuild polylines (also collapses redundant collinear
  // points when the polyline is re-chained).
  segs = mergeOverlaps(deduped);

  // Interval merging erases T-vertices; re-split at every junction point so
  // connection points remain polyline vertices for connectivity.
  const junctionPts: Vec2[] = [...degrees.entries()]
    .filter(([, d]) => d >= 3)
    .map(([k]) => {
      const [x, y] = k.split(",");
      return vec(Number(x), Number(y));
    });
  segs = splitAtTouches(segs, junctionPts);

  // Rebuild polylines, then order them canonically so equal inputs produce
  // identical output regardless of input order.
  const { wires: chained } = chain(segs);
  const out = chained.sort((a, b) => {
    const ka = key(a.pts[0] ?? { x: 0, y: 0 });
    const kb = key(b.pts[0] ?? { x: 0, y: 0 });
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Derived junctions: points with ≥ 3 wire ends (counted pre-merge).
  const junctions: Vec2[] = [];
  for (const [k, d] of degrees) {
    if (d >= 3) {
      const [x, y] = k.split(",");
      junctions.push(vec(Number(x), Number(y)));
    }
  }
  junctions.sort((a, b) => a.x - b.x || a.y - b.y);

  return { wires: out, junctions, endDegrees: degrees };
}

export type { Junction };
export { EPS as TOUCH_EPS, eq as ptEq, key as pointKey };
