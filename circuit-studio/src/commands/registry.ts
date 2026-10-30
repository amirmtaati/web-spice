/**
 * Command registry (UI-UX-SPEC §3.3): every user-invokable action registers
 * here — the palette, the shortcut table, toolbar buttons, and context menus
 * are all views over this registry. Single source of truth: the §9.2 shortcut
 * table is generated *from* these definitions, and uniqueness of every
 * binding is asserted by a CI test.
 */
import { create } from "zustand";

/** Categories shown as palette groups; the shortcut overlay sorts by these. */
export type CommandCategory = "File" | "Edit" | "View" | "Layout" | "Simulate" | "Measure" | "Help";

export interface CommandDef {
  /** Namespaced and stable, e.g. `view.theme.dark` (palette identity). */
  readonly id: string;
  readonly title: string;
  readonly category: CommandCategory;
  /** Canonical chord, e.g. "Mod+K", "F5", "?" — see shortcut.ts grammar. */
  readonly shortcut?: string | undefined;
  /** Extra search terms (fuzzy palette match). */
  readonly keywords?: readonly string[];
  /** Lucide icon name hint; palette renders a generic dot when absent. */
  readonly icon?: string;
  /** Registration source (e.g. "shell", "editor") — used for bulk removal. */
  readonly source: string;
  readonly run: () => void;
  /** Disabled commands render grayed and refuse to run. */
  readonly isEnabled?: () => boolean;
}

interface CommandState {
  readonly commands: ReadonlyMap<string, CommandDef>;
  /** Most-recently-run command ids (palette weighting). */
  readonly recents: readonly string[];
  /** Palette/overlay dialog open state (registry-hosted so shortcuts work). */
  readonly paletteOpen: boolean;
  readonly shortcutOverlayOpen: boolean;
  register: (defs: readonly CommandDef[]) => void;
  unregisterSource: (source: string) => void;
  run: (id: string) => void;
  markRecent: (id: string) => void;
  /** Remap a command's chord; conflicts are surfaced by `findShortcutConflicts`. */
  setShortcut: (id: string, shortcut: string | undefined) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutOverlayOpen: (open: boolean) => void;
}

export const useCommandRegistry = create<CommandState>((set, get) => ({
  commands: new Map<string, CommandDef>(),
  recents: [],
  paletteOpen: false,
  shortcutOverlayOpen: false,

  register: (defs) => {
    set((state) => {
      const next = new Map(state.commands);
      for (const def of defs) {
        next.set(def.id, def);
      }
      return { commands: next };
    });
  },

  unregisterSource: (source) => {
    set((state) => {
      const next = new Map(state.commands);
      for (const [id, def] of next) {
        if (def.source === source) {
          next.delete(id);
        }
      }
      return { commands: next };
    });
  },

  run: (id) => {
    const def = get().commands.get(id);
    if (def === undefined) {
      return;
    }
    if (def.isEnabled !== undefined && !def.isEnabled()) {
      return;
    }
    def.run();
    get().markRecent(id);
  },

  markRecent: (id) => {
    set((state) => ({
      recents: [id, ...state.recents.filter((r) => r !== id)].slice(0, 8),
    }));
  },

  setShortcut: (id, shortcut) => {
    set((state) => {
      const def = state.commands.get(id);
      if (def === undefined) {
        return {};
      }
      const next = new Map(state.commands);
      next.set(id, { ...def, shortcut });
      return { commands: next };
    });
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutOverlayOpen: (shortcutOverlayOpen) => set({ shortcutOverlayOpen }),
}));

/** All commands sorted for palette display (category, then title). */
export function sortedCommands(commands: ReadonlyMap<string, CommandDef>): CommandDef[] {
  return [...commands.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
  );
}

/**
 * Shortcut conflicts within one registry — must be empty. The CI test
 * (`registry.test.ts`) asserts this over the fully-registered app.
 */
export function findShortcutConflicts(
  commands: ReadonlyMap<string, CommandDef>,
): { shortcut: string; ids: string[] }[] {
  const byShortcut = new Map<string, string[]>();
  for (const def of commands.values()) {
    if (def.shortcut === undefined) {
      continue;
    }
    const list = byShortcut.get(def.shortcut) ?? [];
    list.push(def.id);
    byShortcut.set(def.shortcut, list);
  }
  return [...byShortcut]
    .filter(([, ids]) => ids.length > 1)
    .map(([shortcut, ids]) => ({ shortcut, ids }));
}
