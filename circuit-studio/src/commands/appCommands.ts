/**
 * Shell command registration (UX0-T5): the full §9.2 default binding table.
 * Editor/simulation commands whose bodies land in UX1–UX6 are registered
 * now as disabled stubs — the palette, the shortcut overlay, and the
 * uniqueness CI test see the complete table from day one.
 */
import { THEMES } from "../app/theme.ts";
import { useShellStore } from "../shell/shell-store.ts";
import { useUiStore } from "../stores/ui-store.ts";
import { type CommandDef, useCommandRegistry } from "./registry.ts";

const SOURCE = "shell";

function disabled(
  id: string,
  title: string,
  category: CommandDef["category"],
  shortcut?: string,
  keywords?: readonly string[],
): CommandDef {
  return {
    id,
    title,
    category,
    ...(shortcut === undefined ? {} : { shortcut }),
    ...(keywords === undefined ? {} : { keywords }),
    source: SOURCE,
    run: () => {},
    isEnabled: () => false,
  };
}

export function shellCommands(): CommandDef[] {
  const setTool = useUiStore.getState().setTool;
  const setTheme = useUiStore.getState().setTheme;
  const setPreset = useShellStore.getState().setPreset;
  const registry = useCommandRegistry.getState();

  return [
    // ── Palette / help ────────────────────────────────────────────────────
    {
      id: "view.palette",
      title: "Command palette",
      category: "View",
      shortcut: "Mod+K",
      keywords: ["search", "commands", "fuzzy"],
      source: SOURCE,
      run: () => registry.setPaletteOpen(true),
    },
    {
      id: "help.shortcuts",
      title: "Keyboard shortcuts",
      category: "Help",
      shortcut: "?",
      keywords: ["keys", "bindings", "help"],
      source: SOURCE,
      run: () => registry.setShortcutOverlayOpen(true),
    },

    // ── Layout presets (§3.2) ────────────────────────────────────────────
    {
      id: "layout.preset.build",
      title: "Layout: Build preset",
      category: "Layout",
      keywords: ["library", "inspector"],
      source: SOURCE,
      run: () => setPreset("build"),
    },
    {
      id: "layout.preset.debug",
      title: "Layout: Debug preset",
      category: "Layout",
      keywords: ["scope", "console", "instruments"],
      source: SOURCE,
      run: () => setPreset("debug"),
    },
    {
      id: "layout.preset.present",
      title: "Layout: Present preset",
      category: "Layout",
      keywords: ["demo", "teaching", "clean"],
      source: SOURCE,
      run: () => setPreset("present"),
    },

    // ── Themes (§4.2) ────────────────────────────────────────────────────
    ...THEMES.map(
      (theme): CommandDef => ({
        id: `view.theme.${theme.id}`,
        title: `Theme: ${theme.label}`,
        category: "View",
        keywords: ["appearance", "dark", "light", "paper"],
        source: SOURCE,
        run: () => setTheme(theme.id),
      }),
    ),

    // ── Tools (canvas tools activate; bodies land with UX1) ──────────────
    // Note: §3.1 mentions "select V" but §9.2 (authoritative) binds V to
    // "Edit value" — select stays palette-only until UX1 disambiguates by
    // context (selection vs. none).
    {
      id: "tool.select",
      title: "Select tool",
      category: "Edit",
      source: SOURCE,
      run: () => setTool("select"),
    },
    {
      id: "tool.wire",
      title: "Wire tool",
      category: "Edit",
      shortcut: "W",
      source: SOURCE,
      run: () => setTool("wire"),
    },
    {
      id: "tool.place",
      title: "Place component (library quick-add)",
      category: "Edit",
      shortcut: "A",
      keywords: ["add", "component", "library"],
      source: SOURCE,
      run: () => setTool("place"),
    },
    {
      id: "tool.text",
      title: "Text tool",
      category: "Edit",
      shortcut: "T",
      source: SOURCE,
      run: () => setTool("text"),
    },
    {
      id: "tool.probe",
      title: "Probe tool",
      category: "Measure",
      shortcut: "P",
      keywords: ["cross-probe", "measure"],
      source: SOURCE,
      run: () => setTool("probe"),
    },

    // ── Simulation control (§6.1; wired with UX2/UX5) ────────────────────
    disabled("sim.run", "Run analysis", "Simulate", "F5"),
    disabled("sim.stop", "Stop analysis", "Simulate", "Shift+F5"),
    disabled("sim.pause", "Pause / resume", "Simulate", "F6"),
    disabled("sim.step", "Step (live mode)", "Simulate", "F7"),
    disabled("sim.live", "Toggle live interactive mode", "Simulate", "Mod+L"),

    // ── Editing (UX1) ────────────────────────────────────────────────────
    disabled("edit.undo", "Undo", "Edit", "Mod+Z"),
    disabled("edit.redo", "Redo", "Edit", "Mod+Shift+Z"),
    disabled("edit.copy", "Copy selection", "Edit", "Mod+C"),
    disabled("edit.paste", "Paste", "Edit", "Mod+V"),
    disabled("edit.duplicate", "Duplicate selection", "Edit", "Mod+D"),
    disabled("edit.delete", "Delete selection", "Edit", "Delete"),
    disabled("edit.move", "Move selection", "Edit", "M"),
    disabled("edit.drag", "Drag (copy-move)", "Edit", "G"),
    disabled("edit.value", "Edit value", "Edit", "V", ["properties"]),
    disabled("edit.properties", "Edit properties", "Edit", "E"),
    disabled("edit.rotate", "Rotate", "Edit", "R"),
    disabled("edit.mirrorX", "Mirror X", "Edit", "X"),
    disabled("edit.mirrorY", "Mirror Y", "Edit", "Y"),
    disabled("tool.label", "Place net label", "Edit", "L"),

    // ── View / canvas overlays (UX1–UX4) ─────────────────────────────────
    disabled("view.voltages", "Show node voltages", "View", "Mod+Shift+V"),
    disabled("view.currents", "Show element currents", "View", "Mod+Shift+I"),
    disabled("view.power", "Show power", "View", "Mod+Shift+P"),
    disabled("view.resultsTable", "Results table", "Measure", "Mod+Shift+T"),
    disabled("view.console", "Toggle console", "View", "Mod+`"),
    disabled("view.zoomFit", "Zoom to fit", "View", "Home"),
    disabled("view.zoom100", "Zoom 100 %", "View", "Shift+1"),
    disabled("view.toggleGrid", "Toggle grid", "View", "Mod+G"),
    disabled("view.toggleSnap", "Toggle snap", "View", "Mod+Shift+G"),
    disabled("view.highlightNet", "Highlight net", "View", "`"),
    disabled("view.experiments", "Experiments menu", "Measure", "Mod+E"),
    disabled("view.sweep", "Parameter sweep builder", "Measure", "Mod+Alt+R"),
    disabled("file.export", "Export menu (SVG/PDF/PNG)", "File", "Mod+Alt+E"),
  ];
}

/** Idempotent registration (StrictMode double-invoke safe). */
export function registerShellCommands(): void {
  useCommandRegistry.getState().register(shellCommands());
}
