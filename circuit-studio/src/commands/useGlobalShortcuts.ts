/**
 * Global shortcut dispatch (UI-UX-SPEC §9.2): one window keydown listener
 * walks the registry (longest/most-specific chords first) and runs the first
 * matching enabled command. Palette and overlay dialogs swallow keys while
 * open; text-entry targets only ever see modifier chords.
 */
import { useEffect } from "react";
import { useCommandRegistry } from "./registry.ts";
import { eventMatches, isTextEntryTarget } from "./shortcut.ts";

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const registry = useCommandRegistry.getState();
      // Dialogs own the keyboard while open (Radix already traps focus).
      if (registry.paletteOpen || registry.shortcutOverlayOpen) {
        return;
      }
      // Don't hijack typing: single-key commands only outside text entry.
      if (isTextEntryTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
      for (const def of registry.commands.values()) {
        if (def.shortcut === undefined) {
          continue;
        }
        if (eventMatches(event, def.shortcut)) {
          const enabled = def.isEnabled === undefined || def.isEnabled();
          if (enabled) {
            event.preventDefault();
            registry.run(def.id);
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
