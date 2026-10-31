/**
 * Shell command registration (UX0-T5): the full §9.2 default binding table.
 * Editor/simulation commands whose bodies land in UX1–UX6 are registered
 * now as disabled stubs — the palette, the shortcut overlay, and the
 * uniqueness CI test see the complete table from day one.
 */
import { THEMES } from "../app/theme.ts";
import { zoomToFit } from "../canvas/CanvasView.tsx";
import { useEditorStore } from "../editor/store.ts";
import { AMP_EXAMPLE, RC_EXAMPLE } from "../netlist/examples.ts";
import { useShellStore } from "../shell/shell-store.ts";
import { getSimController } from "../sim/controller.ts";
import { useSimStore } from "../stores/sim-store.ts";
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
      id: "view.console",
      title: "Toggle console panel",
      category: "View",
      shortcut: "Mod+`",
      keywords: ["log", "engine", "warnings", "output"],
      source: SOURCE,
      run: () => useShellStore.getState().requestPanelFocus("console"),
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

    // ── Simulation control (§6.1, wired UX2-T3) ──────────────────────────
    {
      id: "sim.run",
      title: "Run / stop analysis",
      category: "Simulate",
      shortcut: "F5",
      keywords: ["simulate", "start", "run"],
      source: SOURCE,
      run: () => void getSimController().run(),
    },
    {
      id: "sim.stop",
      title: "Stop analysis",
      category: "Simulate",
      shortcut: "Shift+F5",
      source: SOURCE,
      run: () => getSimController().stop(),
    },
    {
      id: "sim.pause",
      title: "Pause / resume",
      category: "Simulate",
      shortcut: "F6",
      source: SOURCE,
      run: () => getSimController().togglePause(),
    },
    {
      id: "sim.step",
      title: "Step (live mode)",
      category: "Simulate",
      shortcut: "F7",
      source: SOURCE,
      run: () => getSimController().step(),
    },
    {
      id: "sim.live",
      title: "Toggle live interactive mode",
      category: "Simulate",
      shortcut: "Mod+L",
      keywords: ["interactive", "realtime"],
      source: SOURCE,
      run: () => {
        const s = useSimStore.getState();
        if (s.analysisKind !== "tran") {
          s.setAnalysisKind("tran");
          s.setLive(true);
        } else {
          s.setLive(!s.live);
        }
      },
    },
    {
      id: "sim.load-example",
      title: "Load example: RC charging (τ = 1 ms)",
      category: "Simulate",
      keywords: ["example", "template", "rc", "capacitor", "charging"],
      source: SOURCE,
      run: () => {
        void getSimController()
          .loadSpice(RC_EXAMPLE)
          .catch(() => {
            /* error surfaces via banner + console */
          });
      },
    },
    {
      id: "sim.load-example-amp",
      title: "Load example: inverting amplifier (gain −10)",
      category: "Simulate",
      keywords: ["example", "template", "amplifier", "opamp", "op-amp", "inverting", "ac"],
      source: SOURCE,
      run: () => {
        void getSimController()
          .loadSpice(AMP_EXAMPLE)
          .catch(() => {
            /* error surfaces via banner + console */
          });
      },
    },

    // ── Editing (UX1) ────────────────────────────────────────────────────
    {
      id: "edit.undo",
      title: "Undo",
      category: "Edit",
      shortcut: "Mod+Z",
      source: SOURCE,
      run: () => useEditorStore.getState().undo(),
      isEnabled: () => useEditorStore.getState().historyVersion >= 0,
    },
    {
      id: "edit.redo",
      title: "Redo",
      category: "Edit",
      shortcut: "Mod+Shift+Z",
      source: SOURCE,
      run: () => useEditorStore.getState().redo(),
    },
    {
      id: "edit.delete",
      title: "Delete selection",
      category: "Edit",
      shortcut: "Delete",
      source: SOURCE,
      run: () => useEditorStore.getState().deleteSelection(),
    },
    {
      id: "edit.rotate",
      title: "Rotate",
      category: "Edit",
      shortcut: "R",
      source: SOURCE,
      run: () => useEditorStore.getState().rotateSelection(),
    },
    {
      id: "edit.mirrorX",
      title: "Mirror X",
      category: "Edit",
      shortcut: "X",
      source: SOURCE,
      run: () => useEditorStore.getState().mirrorSelection(),
    },
    disabled("edit.copy", "Copy selection", "Edit", "Mod+C"),
    disabled("edit.paste", "Paste", "Edit", "Mod+V"),
    disabled("edit.duplicate", "Duplicate selection", "Edit", "Mod+D"),
    // edit.delete / edit.rotate / edit.mirrorX are registered (wired) above;
    // duplicate ids would silently shadow the wired bodies with stubs.
    disabled("edit.move", "Move selection", "Edit", "M"),
    disabled("edit.drag", "Drag (copy-move)", "Edit", "G"),
    disabled("edit.value", "Edit value", "Edit", "V", ["properties"]),
    disabled("edit.properties", "Edit properties", "Edit", "E"),
    disabled("edit.mirrorY", "Mirror Y", "Edit", "Y"),
    disabled("tool.label", "Place net label", "Edit", "L"),

    // ── View / canvas overlays (UX1–UX4) ─────────────────────────────────
    disabled("view.voltages", "Show node voltages", "View", "Mod+Shift+V"),
    disabled("view.currents", "Show element currents", "View", "Mod+Shift+I"),
    disabled("view.power", "Show power", "View", "Mod+Shift+P"),
    disabled("view.resultsTable", "Results table", "Measure", "Mod+Shift+T"),
    // view.console is registered (wired) above — the §6.6 Ctrl+` binding.
    {
      id: "view.zoomFit",
      title: "Zoom to fit",
      category: "View",
      shortcut: "Home",
      source: SOURCE,
      run: () => zoomToFit(),
    },
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
