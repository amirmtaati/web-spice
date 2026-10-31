/**
 * Scope cursors (UX3-T4, UI-UX-SPEC §6.7.1): X1/X2 (Δt, 1/Δt), Y1/Y2 per
 * channel (ΔV, ΔI), track mode, snap-to-data, numeric entry. Pure model +
 * math; the canvas overlay (`CursorOverlay.tsx`) renders and drags, the
 * legend table shows the readouts.
 *
 * Cursor positions are stored in DATA coordinates (seconds / volts) so they
 * survive timebase and scale changes; the overlay converts to pixels via the
 * pipeline's current scale facets.
 */

export interface CursorState {
  /** Horizontal cursors, seconds (null = hidden). */
  readonly x1: number | null;
  readonly x2: number | null;
  /** Vertical cursors, data units of the active channel (null = hidden). */
  readonly y1: number | null;
  readonly y2: number | null;
  /** Track: Y1/Y2 follow the signal at X1/X2. */
  readonly track: boolean;
  /** Snap X (and tracked Y) to the nearest sample. */
  readonly snap: boolean;
}

export const CURSORS_OFF: CursorState = {
  x1: null,
  x2: null,
  y1: null,
  y2: null,
  track: false,
  snap: true,
};

export interface CursorReadouts {
  readonly dt: number;
  readonly oneOverDt: number;
  readonly dx: number;
  readonly dy: number;
}

export function cursorReadouts(c: CursorState): CursorReadouts {
  const x1 = c.x1;
  const x2 = c.x2;
  const dt = x1 !== null && x2 !== null ? x2 - x1 : Number.NaN;
  const y1 = c.y1;
  const y2 = c.y2;
  const dy = y1 !== null && y2 !== null ? y2 - y1 : Number.NaN;
  return {
    dt,
    oneOverDt: dt !== 0 && Number.isFinite(dt) ? 1 / dt : Number.NaN,
    dx: dt,
    dy,
  };
}

/**
 * Snap a data-coordinate x to the nearest sample on a uniform grid
 * (x[k] = x0 + k·dt — the resultStore axis contract, AGENTS.md §5.2).
 */
export function snapX(x: number, x0: number, dt: number, count: number): number {
  if (!Number.isFinite(x) || dt <= 0 || count === 0) {
    return x;
  }
  const k = Math.round((x - x0) / dt);
  const kc = Math.min(count - 1, Math.max(0, k));
  return x0 + kc * dt;
}

/**
 * Sample value at data-coordinate x on a uniform grid with linear
 * interpolation between neighbors (NaN outside the data).
 */
export function sampleAt(x: number, x0: number, dt: number, y: ArrayLike<number>): number {
  const n = y.length;
  if (dt <= 0 || n === 0 || !Number.isFinite(x)) {
    return Number.NaN;
  }
  const kf = (x - x0) / dt;
  const k = Math.floor(kf);
  if (k < 0 || k >= n) {
    return Number.NaN;
  }
  const v0 = y[k] ?? Number.NaN;
  if (k + 1 >= n) {
    return v0;
  }
  const v1 = y[k + 1] ?? Number.NaN;
  const frac = kf - k;
  return v0 + (v1 - v0) * frac;
}

/** Hit-test radius for drag handles, in CSS pixels. */
export const CURSOR_GRAB_PX = 8;

/** Which handle (if any) is under the pointer at pixel `px`/`py`. */
export function hitCursor(
  c: CursorState,
  toPxX: (x: number) => number,
  toPxY: (y: number) => number,
  px: number,
  py: number,
): "x1" | "x2" | "y1" | "y2" | null {
  const hits: { id: "x1" | "x2" | "y1" | "y2"; dist: number }[] = [];
  if (c.x1 !== null) {
    hits.push({ id: "x1", dist: Math.abs(toPxX(c.x1) - px) });
  }
  if (c.x2 !== null) {
    hits.push({ id: "x2", dist: Math.abs(toPxX(c.x2) - px) });
  }
  if (c.y1 !== null) {
    hits.push({ id: "y1", dist: Math.abs(toPxY(c.y1) - py) });
  }
  if (c.y2 !== null) {
    hits.push({ id: "y2", dist: Math.abs(toPxY(c.y2) - py) });
  }
  let best: { id: "x1" | "x2" | "y1" | "y2"; dist: number } | null = null;
  for (const h of hits) {
    if (h.dist <= CURSOR_GRAB_PX && (best === null || h.dist < best.dist)) {
      best = h;
    }
  }
  return best?.id ?? null;
}
