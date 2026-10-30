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
  setPreset: (preset: PresetId) => void;
  setProjectName: (name: string) => void;
  markDirty: (dirty: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  projectId: DEFAULT_PROJECT_ID,
  preset: "build",
  presetNonce: 0,
  projectName: "Untitled circuit",
  dirty: false,
  setPreset: (preset) => set((state) => ({ preset, presetNonce: state.presetNonce + 1 })),
  setProjectName: (projectName) => set({ projectName, dirty: true }),
  markDirty: (dirty) => set({ dirty }),
}));
