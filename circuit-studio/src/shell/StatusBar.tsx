/**
 * Status bar (UI-UX-SPEC §3.1 region G, 24 px): selection summary, contextual
 * hint for the active tool, and viewport info. Selection/zoom values come
 * from the canvas (UX1); the bar and its hint text are live from UX0.
 */
import type { ReactNode } from "react";
import { useUiStore } from "../stores/ui-store.ts";

const HINTS: Record<string, string> = {
  select: "Click to select · Tab cycles · Enter edits",
  wire: "Click to start a wire · Esc done",
  place: "Pick a component from the library · R rotate",
  text: "Click to place text",
  probe: "Click a node or element to probe",
  pan: "Hold Space and drag to pan",
};

export function StatusBar(): ReactNode {
  const tool = useUiStore((s) => s.tool);

  return (
    <footer
      data-testid="statusbar"
      className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-2xs text-faint"
    >
      <span data-testid="selection-summary">0 symbols · 0 wires</span>
      <span className="h-3 w-px bg-line" aria-hidden="true" />
      <span data-testid="tool-hint" className="text-muted">
        {HINTS[tool] ?? ""}
      </span>
      <span className="ml-auto flex items-center gap-3">
        <span>snap 1.0</span>
        <span>grid 10</span>
        <span className="font-mono tabular-nums">zoom 100 %</span>
      </span>
    </footer>
  );
}
