/**
 * Shell state (UX0): active layout preset + project identity. The shell
 * component owns the dockview api; commands mutate this store and the shell
 * reacts — commands stay decoupled from dockview.
 */
import { create } from "zustand";
import { DEFAULT_PROJECT_ID } from "./layout-persistence.ts";
import type { PresetId } from "./presets.ts";

interface ShellState {
  readonly projectId: string;
  readonly preset: PresetId;
  /** Bumped on every setPreset so re-picking the same preset re-applies it. */
  readonly presetNonce: number;
  readonly projectName: string;
  readonly dirty: boolean;
  /** Last panel-focus request (commands → shell bridge), null initially. */
  readonly focusPanel: { readonly panelId: string; readonly nonce: number } | null;
  setPreset: (preset: PresetId) => void;
  setProjectName: (name: string) => void;
  markDirty: (dirty: boolean) => void;
  requestPanelFocus: (panelId: string) => void;
}

let focusNonce = 0;

export const useShellStore = create<ShellState>((set) => ({
  projectId: DEFAULT_PROJECT_ID,
  preset: "build",
  presetNonce: 0,
  projectName: "Untitled circuit",
  dirty: false,
  focusPanel: null,
  setPreset: (preset) => set((state) => ({ preset, presetNonce: state.presetNonce + 1 })),
  setProjectName: (projectName) => set({ projectName, dirty: true }),
  markDirty: (dirty) => set({ dirty }),
  requestPanelFocus: (panelId) => {
    focusNonce += 1;
    set({ focusPanel: { panelId, nonce: focusNonce } });
  },
}));
