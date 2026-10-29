/**
 * Theme state (SPEC §9.12): dark (default), light, paper. Applied via
 * `data-theme` on the document root so CSS variables cascade everywhere.
 */
export type ThemeId = "dark" | "light" | "paper";

export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "paper", label: "Paper" },
];

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}
