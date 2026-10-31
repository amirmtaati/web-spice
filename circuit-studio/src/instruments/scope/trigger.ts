/**
 * Scope trigger engine (UX3-T3, UI-UX-SPEC §6.7.1): edge/level trigger with
 * Auto/Normal/Single acquisition modes and holdoff. Pure and deterministic —
 * the pipeline calls `findTrigger` against the channel's retained samples
 * (recorded streams in tests), so every mode decision is reproducible.
 *
 * Semantics (documented, deterministic):
 *  - A trigger is a sample index `i` where `y[i−1]`/`y[i]` crosses `level`
 *    in the configured direction.
 *  - `notBefore` / `notAfter` bound the search (the display window must fit
 *    the retained data).
 *  - Holdoff: a candidate is rejected when it lies within `holdoffSamples`
 *    after the previously accepted trigger (`lastAccepted`). This is the
 *    bench-scope "blind time" between acquisitions; on a static window with
 *    no previous trigger (`lastAccepted < 0`) holdoff is inert.
 */
export type TriggerEdge = "rise" | "fall" | "either";

export interface TriggerConfig {
  readonly level: number;
  readonly edge: TriggerEdge;
  /** Blind time after an accepted trigger, in samples (≥ 0). */
  readonly holdoffSamples: number;
}

/**
 * Find the newest valid trigger index in `[notBefore, notAfter]`, or null.
 * Scanning backwards (newest first) is what the scope wants: the display
 * window hugs the freshest event. O(window) worst case.
 */
export function findTrigger(
  y: ArrayLike<number>,
  cfg: TriggerConfig,
  notBefore: number,
  notAfter: number,
  lastAccepted = -1,
): number | null {
  const lo = Math.max(1, notBefore);
  for (let i = notAfter; i >= lo; i--) {
    const prev = y[i - 1];
    const cur = y[i];
    if (prev === undefined || cur === undefined || Number.isNaN(prev) || Number.isNaN(cur)) {
      continue;
    }
    if (!crosses(cfg.edge, prev, cur, cfg.level)) {
      continue;
    }
    if (lastAccepted >= 0 && i - lastAccepted < cfg.holdoffSamples) {
      continue;
    }
    return i;
  }
  return null;
}

function crosses(edge: TriggerEdge, prev: number, cur: number, level: number): boolean {
  switch (edge) {
    case "rise":
      return prev < level && cur >= level;
    case "fall":
      return prev > level && cur <= level;
    case "either":
      return (prev < level && cur >= level) || (prev > level && cur <= level);
  }
}

/**
 * Acquisition mode resolution for one frame (deterministic state machine —
 * the pipeline feeds it recorded data and gets a display anchor back).
 *
 * - `auto`: use the newest trigger; when none exists return `anchor: null`
 *   and the pipeline free-runs (§6.7.1: free-run trace dims behind
 *   triggered traces).
 * - `normal`: when none exists, keep the previous window — the trace
 *   freezes instead of free-running.
 * - `single`: identical resolution to normal; the PIPELINE owns the
 *   single-shot arming (it stops searching once a trigger was accepted and
 *   re-arms when the user clicks Single again).
 */
export function resolveAnchor(
  mode: "auto" | "normal" | "single",
  found: number | null,
  previousAnchor: number | null,
): { anchor: number | null; triggered: boolean; accepted: number | null } {
  if (found !== null) {
    return { anchor: found, triggered: true, accepted: found };
  }
  if (mode === "auto") {
    return { anchor: null, triggered: false, accepted: null };
  }
  return { anchor: previousAnchor, triggered: false, accepted: null };
}

/**
 * Interpolated trigger crossing time between samples `i−1` and `i` (for the
 * trigger glyph position and cursor snap). Falls back to `axis[i]` when the
 * samples do not straddle `level` cleanly.
 */
export function triggerTime(
  axis: ArrayLike<number>,
  y: ArrayLike<number>,
  i: number,
  level: number,
): number {
  const t0 = axis[i - 1];
  const t1 = axis[i];
  const y0 = y[i - 1];
  const y1 = y[i];
  if (t0 === undefined || t1 === undefined || y0 === undefined || y1 === undefined) {
    return Number.NaN;
  }
  const denom = y1 - y0;
  if (denom === 0 || !Number.isFinite(denom)) {
    return t1;
  }
  return t0 + ((level - y0) / denom) * (t1 - t0);
}
