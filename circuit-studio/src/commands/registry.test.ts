/** Registry tests (UX0-T5): uniqueness, registration hygiene, remap. */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  type CommandDef,
  findShortcutConflicts,
  sortedCommands,
  useCommandRegistry,
} from "./registry.ts";
import { normalizeShortcut } from "./shortcut.ts";

function def(overrides: Partial<CommandDef> & { id: string }): CommandDef {
  return {
    title: overrides.id,
    category: "View",
    source: "test",
    run: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  useCommandRegistry.setState({
    commands: new Map(),
    recents: [],
    paletteOpen: false,
    shortcutOverlayOpen: false,
  });
});

describe("command registry", () => {
  it("registers commands and keeps them sorted by category then title", () => {
    useCommandRegistry
      .getState()
      .register([
        def({ id: "b.title", title: "Beta", category: "View" }),
        def({ id: "a.file", title: "Alpha", category: "File" }),
      ]);
    const sorted = sortedCommands(useCommandRegistry.getState().commands);
    expect(sorted.map((d) => d.id)).toEqual(["a.file", "b.title"]);
  });

  it("unregisterSource removes only that source's commands", () => {
    useCommandRegistry
      .getState()
      .register([
        def({ id: "shell.a", source: "shell" }),
        def({ id: "editor.a", source: "editor" }),
      ]);
    useCommandRegistry.getState().unregisterSource("shell");
    const ids = [...useCommandRegistry.getState().commands.keys()];
    expect(ids).toEqual(["editor.a"]);
  });

  it("run() refuses disabled commands but enabled ones execute and become recent", () => {
    let ran = 0;
    useCommandRegistry.getState().register([
      def({
        id: "off",
        isEnabled: () => false,
        run: () => {
          ran += 1;
        },
      }),
      def({
        id: "on",
        run: () => {
          ran += 10;
        },
      }),
    ]);
    useCommandRegistry.getState().run("off");
    expect(ran).toBe(0);
    useCommandRegistry.getState().run("on");
    expect(ran).toBe(10);
    expect(useCommandRegistry.getState().recents).toEqual(["on"]);
  });

  it("setShortcut remaps a binding and conflict detection reports duplicates", () => {
    useCommandRegistry
      .getState()
      .register([def({ id: "one", shortcut: "F5" }), def({ id: "two", shortcut: "F6" })]);
    expect(findShortcutConflicts(useCommandRegistry.getState().commands)).toEqual([]);

    useCommandRegistry.getState().setShortcut("two", "F5");
    const conflicts = findShortcutConflicts(useCommandRegistry.getState().commands);
    expect(conflicts).toEqual([{ shortcut: "F5", ids: ["one", "two"] }]);

    useCommandRegistry.getState().setShortcut("one", undefined);
    expect(findShortcutConflicts(useCommandRegistry.getState().commands)).toEqual([]);
    const one = useCommandRegistry.getState().commands.get("one");
    expect(one?.shortcut).toBeUndefined();
  });

  it("every registered shortcut is canonical (normalization is idempotent)", () => {
    useCommandRegistry
      .getState()
      .register([
        def({ id: "k", shortcut: "Mod+K" }),
        def({ id: "v", shortcut: "Mod+Shift+V" }),
        def({ id: "q", shortcut: "?" }),
        def({ id: "f", shortcut: "F5" }),
        def({ id: "d", shortcut: "Delete" }),
      ]);
    for (const command of useCommandRegistry.getState().commands.values()) {
      if (command.shortcut === undefined) {
        continue;
      }
      expect(normalizeShortcut(command.shortcut)).toBe(command.shortcut);
    }
  });
});
