/**
 * Console panel (UX2-T5, UI-UX-SPEC §6.6): engine log, load warnings, run
 * stats, transport events. Filter chips (error/warn/info/engine), per-line
 * copy, clear, auto-scroll (sticky while the user is at the bottom).
 */
import { Copy, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { type LogLevel, type LogLine, useConsoleStore } from "../stores/console-store.ts";
import { cn } from "../ui/cn.ts";

const LEVELS: readonly LogLevel[] = ["error", "warn", "info", "engine"];

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-error",
  warn: "text-warning",
  info: "text-muted",
  engine: "text-accent",
};

function lineText(line: LogLine): string {
  const time = new Date(line.ts).toLocaleTimeString();
  const detail = line.detail !== undefined ? ` [${line.detail}]` : "";
  return `${time} ${line.level.padEnd(6)} ${line.text}${detail}`;
}

export function ConsolePanel(): ReactNode {
  const lines = useConsoleStore((s) => s.lines);
  const filter = useConsoleStore((s) => s.filter);
  const version = useConsoleStore((s) => s.version);
  const setFilter = useConsoleStore((s) => s.setFilter);
  const clear = useConsoleStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  // Auto-scroll only while the user is already at the bottom (no scroll jail).
  // `version` is an intentional re-trigger (it ticks on every log batch);
  // refs are read imperatively.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the re-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && stickyRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [version]);

  const visible = lines.filter((l) => filter.has(l.level));

  const toggleLevel = (level: LogLevel): void => {
    const next = new Set(filter);
    if (next.has(level)) {
      next.delete(level);
    } else {
      next.add(level);
    }
    // Never allow an empty view to look like a dead console.
    if (next.size > 0) {
      setFilter(next);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="console-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={filter.has(level)}
            data-testid={`console-filter-${level}`}
            className={cn(
              "rounded-full border px-2 py-0.5 text-2xs transition-colors",
              filter.has(level)
                ? "border-line bg-elevated text-fg"
                : "border-transparent text-faint hover:text-muted",
            )}
            onClick={() => toggleLevel(level)}
          >
            {level}
            <span className="ml-1 tabular-nums text-faint">
              {lines.filter((l) => l.level === level).length}
            </span>
          </button>
        ))}
        <span className="ml-auto" />
        <button
          type="button"
          aria-label="Clear console"
          className="rounded p-1 text-faint hover:bg-elevated hover:text-muted"
          onClick={clear}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-2xs leading-5"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {visible.length === 0 ? (
          <p className="p-2 text-faint">No entries. Run a simulation to see engine output.</p>
        ) : (
          visible.map((line) => (
            <div
              key={line.id}
              data-testid="console-line"
              className="group flex items-start gap-2 rounded px-1 hover:bg-elevated"
            >
              <span className={cn("shrink-0", LEVEL_CLASS[line.level])}>
                {line.level.padEnd(6)}
              </span>
              <span className="min-w-0 flex-1 break-words text-muted">{line.text}</span>
              {line.detail !== undefined ? (
                <span className="shrink-0 text-faint">{line.detail}</span>
              ) : null}
              <button
                type="button"
                aria-label="Copy line"
                className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-fg group-hover:opacity-100"
                onClick={() => {
                  void globalThis.navigator?.clipboard?.writeText(lineText(line)).catch(() => {});
                }}
              >
                <Copy size={11} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
