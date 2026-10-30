/**
 * Command palette (UI-UX-SPEC §3.3, §9.2 Ctrl/Cmd+K): fuzzy search over the
 * command registry with category chips, shortcut hints, and recent
 * weighting. The palette is the *only* registration surface for commands —
 * anything not registered here does not exist for the user.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "../ui/Kbd.tsx";
import { type CommandDef, sortedCommands, useCommandRegistry } from "./registry.ts";
import { formatShortcut } from "./shortcut.ts";

/** Subsequence fuzzy score; 0 = no match. Higher is better. */
export function fuzzyScore(query: string, text: string): number {
  if (query.length === 0) {
    return 1;
  }
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let hayIndex = 0;
  let streak = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, hayIndex);
    if (found === -1) {
      return 0;
    }
    streak = found === hayIndex ? streak + 1 : 1;
    score += 1 + streak + (found === 0 || haystack[found - 1] === " " ? 2 : 0);
    hayIndex = found + 1;
  }
  return score;
}

function commandScore(query: string, def: CommandDef): number {
  const title = fuzzyScore(query, def.title);
  const id = fuzzyScore(query, def.id) * 0.5;
  const keywords = (def.keywords ?? []).reduce(
    (best, k) => Math.max(best, fuzzyScore(query, k)),
    0,
  );
  return Math.max(title, id, keywords * 0.9);
}

function useFilteredCommands(query: string): CommandDef[] {
  const commands = useCommandRegistry((s) => s.commands);
  const recents = useCommandRegistry((s) => s.recents);
  const trimmed = query.trim();
  return useMemo(() => {
    const all = sortedCommands(commands);
    if (trimmed === "") {
      return [
        ...recents.map((id) => commands.get(id)).filter((d): d is CommandDef => d !== undefined),
        ...all.filter((d) => !recents.includes(d.id)),
      ];
    }
    return all
      .map((def) => ({ def, score: commandScore(trimmed, def) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.def);
  }, [commands, recents, trimmed]);
}

export function CommandPalette(): ReactNode {
  const open = useCommandRegistry((s) => s.paletteOpen);
  const setOpen = useCommandRegistry((s) => s.setPaletteOpen);
  const run = useCommandRegistry((s) => s.run);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useFilteredCommands(query);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const choose = (def: CommandDef | undefined): void => {
    if (def === undefined) {
      return;
    }
    setOpen(false);
    run(def.id);
  };

  const onListKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  useEffect(() => {
    const active = listRef.current?.children[activeIndex];
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--fg)_32%,transparent)] backdrop-blur-[2px]" />
        <Dialog.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[14%] z-50 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-elevated shadow-[var(--shadow-popover)] outline-none"
          onKeyDown={onListKeyDown}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            data-testid="palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search commands…"
            aria-label="Search commands"
            className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-faint"
          />
          <div
            ref={listRef}
            role="listbox"
            aria-label="Commands"
            className="max-h-[46vh] overflow-y-auto p-1.5"
          >
            {results.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-faint" aria-live="polite">
                No commands match “{query}”
              </div>
            )}
            {results.map((def, index) => (
              <div
                key={def.id}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                data-testid="palette-item"
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(def)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    choose(def);
                  }
                }}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  index === activeIndex ? "bg-accent-soft text-fg" : "text-fg"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    def.isEnabled === undefined || def.isEnabled() ? "bg-accent" : "bg-faint"
                  }`}
                  aria-hidden="true"
                />
                <span className={`flex-1 truncate ${index === activeIndex ? "" : "text-muted"}`}>
                  {def.title}
                </span>
                <span className="text-2xs text-faint">{def.category}</span>
                {def.shortcut !== undefined && <Kbd>{formatShortcut(def.shortcut)}</Kbd>}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
