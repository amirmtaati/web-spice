/**
 * Shared plot data access (UX3-T6): reads the current run out of
 * resultStore — axis, per-signal buffers, run identity — plus small helpers
 * shared by the Bode / sweep / X-Y / spectrum views (§6.7.2–6.7.3).
 *
 * Subscription contract: resultStore.getSnapshot() allocates a fresh object
 * per call, so React consumers subscribe to the throttled numeric `version`
 * (stable — §7 rule 2) and derive everything in a memo keyed on it.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { AnalysisRequest } from "../../sim/types.ts";
import { resultStore } from "../../stores/result-store.ts";

export interface RunData {
  readonly runId: string | null;
  readonly kind: string;
  readonly axisLabel: string;
  readonly axis: Float64Array;
  readonly names: readonly string[];
  readonly points: number;
}

function subscribeResultStore(cb: () => void): () => void {
  return resultStore.subscribe(cb);
}

function resultVersion(): number {
  return resultStore.getSnapshot().version;
}

function axisLabelOf(analysis: AnalysisRequest): string {
  switch (analysis.kind) {
    case "tran":
      return "time (s)";
    case "dc":
      return `${analysis.source} (V)`;
    case "ac":
    case "noise":
      return "frequency (Hz)";
    case "op":
    case "tf":
      return "point";
  }
}

/** React-facing run data, refreshed only when the store version bumps. */
export function useRunData(): RunData | null {
  useSyncExternalStore(subscribeResultStore, resultVersion);
  const version = resultVersion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the subscription handle — every buffer read below is gated on it
  return useMemo(() => {
    const snap = resultStore.getSnapshot();
    const analysis = resultStore.currentAnalysis;
    if (snap.signalNames.length === 0 || analysis === null) {
      return null;
    }
    const n = resultStore.sampleCount;
    const axis = new Float64Array(n);
    resultStore.readAxisInto(n, axis);
    return {
      runId: snap.runId,
      kind: analysis.kind,
      axisLabel: axisLabelOf(analysis),
      axis,
      names: snap.signalNames,
      points: n,
    };
  }, [version]);
}

/** Read one signal's retained values (copy). */
export function readSignalValues(name: string): Float64Array {
  return resultStore.readSignal(name);
}

/** First signal matching a prefix (e.g. magnitude aliases). */
export function findSignal(names: readonly string[], prefix: string): string | null {
  for (const n of names) {
    if (n.startsWith(prefix)) {
      return n;
    }
  }
  return null;
}
