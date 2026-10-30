/**
 * UI store (SPEC §8.1 `uiStore`): theme, tool, selection, viewport. The
 * document model (projectStore) and resultStore land with U2/U4 — this slice
 * demonstrates the Zustand + selectors pattern the rest of the app follows.
 */
import { create } from "zustand";
import { applyTheme, type ThemeId } from "../app/theme.ts";

export type ToolId = "select" | "wire" | "place" | "text" | "probe" | "pan";

interface UiState {
  theme: ThemeId;
  tool: ToolId;
  setTheme: (theme: ThemeId) => void;
  setTool: (tool: ToolId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "dark",
  tool: "select",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setTool: (tool) => set({ tool }),
}));
