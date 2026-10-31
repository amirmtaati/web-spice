/**
 * Debug/diagnostics handles (§6.6): the diagnostics drawer and the e2e
 * journeys read stores through `window.studio`. Attaching is harmless in
 * production (read-only handles, no secrets) and invaluable for bug reports.
 */

import { useShellStore } from "../shell/shell-store.ts";
import { attachResultStoreDebug, resultStore } from "../stores/result-store.ts";
import { useSimStore } from "../stores/sim-store.ts";
import { getSimController } from "./controller.ts";
import { frameStats } from "./frames.ts";

/** Install `window.studio` (idempotent). Called from main.tsx. */
export function installStudioDebug(): void {
  const w = globalThis as unknown as { studio?: Record<string, unknown> };
  if (w.studio !== undefined) {
    return;
  }
  const handles: Record<string, unknown> = {};
  attachResultStoreDebug(handles);
  handles.simStore = useSimStore;
  handles.shellStore = useShellStore;
  handles.sim = () => getSimController();
  handles.frames = () => frameStats();
  /** Journey helper: signal samples + axis (interleaved [x, y, …]). */
  handles.readSignal = (name: string): { axis: number[]; values: number[] } => {
    const values = resultStore.readSignal(name);
    const axis = new Float64Array(values.length);
    resultStore.readAxisInto(values.length, axis);
    return { axis: [...axis], values: [...values] };
  };
  w.studio = handles;
}
