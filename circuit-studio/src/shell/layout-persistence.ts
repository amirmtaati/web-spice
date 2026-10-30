/**
 * Layout persistence (UI-UX-SPEC §3.2): custom arrangements persist to
 * localStorage per project id and rehydrate on mount. Validation is
 * structural (no schema dependency): anything that doesn't look like a
 * dockview layout is discarded so a corrupted store can never brick the
 * shell.
 */
import type { SerializedDockview } from "dockview-core";

const KEY_PREFIX = "circuit-studio/layout/v1/";

export const DEFAULT_PROJECT_ID = "default";

export function saveLayout(projectId: string, layout: SerializedDockview): void {
  try {
    globalThis.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(layout));
  } catch {
    // Private-mode / quota errors are non-fatal: layouts are a convenience.
  }
}

export function loadLayout(projectId: string): SerializedDockview | null {
  try {
    const raw = globalThis.localStorage.getItem(KEY_PREFIX + projectId);
    if (raw === null) {
      return null;
    }
    return parseLayout(raw);
  } catch {
    return null;
  }
}

/** Structural validation: `{ grid: { root, orientation }, panels }`. */
export function parseLayout(raw: string): SerializedDockview | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const grid = value.grid;
  if (!isRecord(grid) || !isRecord(grid.root)) {
    return null;
  }
  if (grid.root.type !== "leaf" && grid.root.type !== "branch") {
    return null;
  }
  if (!isRecord(value.panels)) {
    return null;
  }
  return value as unknown as SerializedDockview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
