/**
 * Shell command suite (UX0-T5): the §9.2 binding table is registered in
 * full, conflict-free — this is the CI uniqueness gate. Tool commands drive
 * the ui-store.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { useUiStore } from "../stores/ui-store.ts";
import { registerShellCommands, shellCommands } from "./appCommands.ts";
import { findShortcutConflicts, useCommandRegistry } from "./registry.ts";
import { normalizeShortcut } from "./shortcut.ts";

/** Every binding from UI-UX-SPEC §9.2 (canonicalized). */
const SPEC_9_2_BINDINGS = [
  "Mod+K", // command palette
  "F5", // run
  "Shift+F5", // stop
  "F6", // pause/resume
  "F7", // step
  "Mod+L", // live toggle
  "Mod+Shift+V", // show voltages
  "Mod+Shift+I", // show currents
  "Mod+Shift+P", // show power
  "Mod+Shift+T", // results table
  "Mod+`", // console
  "Home", // zoom fit
  "Shift+1", // zoom 100 %
  "Mod+G", // toggle grid
  "Mod+Shift+G", // toggle snap
  "`", // highlight net
  "Mod+E", // experiments
  "Mod+Alt+R", // sweep builder
  "Mod+Alt+E", // export menu
  "?", // help / shortcuts
  "A", // library quick-add
  "W", // wire
  "L", // label
  "T", // text
  "P", // probe
  "M", // move
  "G", // drag
  "V", // edit value
  "E", // properties
  "R", // rotate
  "X", // mirror X
  "Y", // mirror Y
  "Delete", // delete
  "Mod+D", // duplicate
  "Mod+Z", // undo
  "Mod+Shift+Z", // redo
  "Mod+C", // copy
  "Mod+V", // paste
] as const;

beforeEach(() => {
  useCommandRegistry.setState({
    commands: new Map(),
    recents: [],
    paletteOpen: false,
    shortcutOverlayOpen: false,
  });
});

describe("shell commands (§9.2)", () => {
  it("registers every §9.2 binding, canonical and conflict-free", () => {
    registerShellCommands();
    const { commands } = useCommandRegistry.getState();
    const bound = new Set(
      [...commands.values()]
        .filter((c) => c.shortcut !== undefined)
        .map((c) => normalizeShortcut(c.shortcut as string)),
    );
    for (const binding of SPEC_9_2_BINDINGS) {
      expect(bound.has(normalizeShortcut(binding))).toBe(true);
    }
    expect(findShortcutConflicts(commands)).toEqual([]);
  });

  it("every command has a unique id and title, and a category", () => {
    const commands = shellCommands();
    const ids = new Set<string>();
    const titles = new Set<string>();
    for (const command of commands) {
      expect(command.id.length).toBeGreaterThan(0);
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.category.length).toBeGreaterThan(0);
      // Duplicate ids silently overwrite earlier registrations (Map.set) —
      // a wired command must never be shadowed by a stale stub (UX2 lesson).
      expect(ids.has(command.id)).toBe(false);
      ids.add(command.id);
      expect(titles.has(command.title)).toBe(false);
      titles.add(command.title);
    }
  });

  it("tool commands switch the active tool in the ui-store", () => {
    registerShellCommands();
    const registry = useCommandRegistry.getState();
    registry.run("tool.wire");
    expect(useUiStore.getState().tool).toBe("wire");
    registry.run("tool.probe");
    expect(useUiStore.getState().tool).toBe("probe");
    registry.run("layout.preset.debug");
  });
});
