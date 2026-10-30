/**
 * Shortcut overlay (UI-UX-SPEC §3.3, §9.2 `?`): the full shortcut table,
 * generated from the command registry (single source of truth), searchable.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useMemo, useState } from "react";
import { Kbd } from "../ui/Kbd.tsx";
import { sortedCommands, useCommandRegistry } from "./registry.ts";
import { formatShortcut } from "./shortcut.ts";

export function ShortcutOverlay(): ReactNode {
  const open = useCommandRegistry((s) => s.shortcutOverlayOpen);
  const setOpen = useCommandRegistry((s) => s.setShortcutOverlayOpen);
  const commands = useCommandRegistry((s) => s.commands);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = sortedCommands(commands).filter((d) => d.shortcut !== undefined);
    const q = query.trim().toLowerCase();
    return all.filter(
      (d) => q === "" || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--fg)_32%,transparent)] backdrop-blur-[2px]" />
        <Dialog.Content
          aria-label="Keyboard shortcuts"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-[var(--shadow-popover)] outline-none"
        >
          <Dialog.Title className="border-b border-line px-4 py-3 text-sm font-medium text-fg">
            Keyboard shortcuts
          </Dialog.Title>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter shortcuts"
            className="w-full border-b border-line bg-transparent px-4 py-2.5 text-sm text-fg outline-none placeholder:text-faint"
          />
          <div className="overflow-y-auto p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-faint">
                  <th className="pb-2 font-medium">Action</th>
                  <th className="pb-2 text-right font-medium">Shortcut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((def) => (
                  <tr key={def.id} className="border-t border-line/60">
                    <td className="py-1.5 pr-4 text-muted">
                      {def.title}
                      <span className="ml-2 text-2xs text-faint">{def.category}</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <Kbd>{formatShortcut(def.shortcut ?? "")}</Kbd>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-xs text-faint">
                      No shortcuts match “{query}”
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
