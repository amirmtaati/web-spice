/**
 * Probe marks (UX2-T6, §6.5/§6.7.1): user-placed voltage/current probes that
 * drive engine-side stream filtering via `.probe` cards. Probes live on the
 * document (undo/redo/persistence for free). Each probe gets a scope channel
 * number (1–8); colors derive from the `--sig-N` theme tokens at render time
 * (§4.1 — no hardcoded hexes).
 */
import type { ProbeMark, SchematicDoc } from "./types.ts";

export type { ProbeMark } from "./types.ts";

/** Scope channel count (drives --sig-1…--sig-8 tokens). */
export const MAX_CHANNELS = 8;

/** Probes of a document (optional field for backward compatibility). */
export function probesOf(doc: SchematicDoc): readonly ProbeMark[] {
  return doc.probes ?? [];
}

/** Lowest free channel number, or null when all 8 are taken. */
export function freeChannel(probes: readonly ProbeMark[]): number | null {
  const taken = new Set(probes.map((p) => p.channel));
  for (let c = 1; c <= MAX_CHANNELS; c++) {
    if (!taken.has(c)) {
      return c;
    }
  }
  return null;
}

/** CSS token name for a channel (1-based), e.g. `--sig-3`. */
export function sigToken(channel: number): string {
  return `--sig-${((channel - 1) % MAX_CHANNELS) + 1}`;
}

/**
 * Resolved channel color for DOM contexts (legends, badges). Reads the
 * current theme's CSS variables — empty string when no DOM (tests/SSR).
 */
export function channelColor(channel: number): string {
  if (typeof document === "undefined") {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(sigToken(channel)).trim();
}

/**
 * Add a probe (returns a new probes array). Re-probing the same target of the
 * same kind toggles it off; targets are matched case-insensitively.
 */
export function toggleProbe(
  probes: readonly ProbeMark[],
  spec: { kind: ProbeMark["kind"]; target: string; x: number; y: number; id: string },
): readonly ProbeMark[] {
  const target = spec.target.toLowerCase();
  const existing = probes.find((p) => p.kind === spec.kind && p.target.toLowerCase() === target);
  if (existing !== undefined) {
    return probes.filter((p) => p.id !== existing.id);
  }
  const channel = freeChannel(probes);
  if (channel === null) {
    return probes; // scope is full — silently ignore (UI shows a hint)
  }
  const probe: ProbeMark = {
    id: spec.id,
    kind: spec.kind,
    target: spec.target,
    x: spec.x,
    y: spec.y,
    channel,
  };
  return [...probes, probe];
}

/**
 * `.probe` signal names for the netlist text (engine lowercases signals;
 * AC aliases vm/vp per AGENTS.md §5.4 — the bare name selects magnitude).
 */
export function probeSignalsOf(probes: readonly ProbeMark[]): string[] {
  const signals = probes.map((p) => (p.kind === "voltage" ? `v(${p.target})` : `i(${p.target})`));
  return [...new Set(signals)];
}
