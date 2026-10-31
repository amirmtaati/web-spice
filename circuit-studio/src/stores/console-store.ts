/**
 * Console store (UX2-T5, UI-UX-SPEC §6.6): engine log, load warnings, run
 * stats, transport events. Bounded (drops oldest); every line is copyable.
 * React consumers throttle reads via the `version` counter (same pattern as
 * resultStore — the log never re-renders React per message in bursts).
 */
import { create } from "zustand";

export type LogLevel = "error" | "warn" | "info" | "engine";

export interface LogLine {
  readonly id: number;
  readonly level: LogLevel;
  readonly text: string;
  readonly ts: number;
  /** Optional structured detail (RunStats, warning payloads). */
  readonly detail?: string;
}

/** Ring capacity — old lines drop off (§6.6 "last 200" for diagnostics). */
export const CONSOLE_MAX_LINES = 500;

interface ConsoleState {
  readonly lines: readonly LogLine[];
  readonly filter: ReadonlySet<LogLevel>;
  readonly version: number;
  log: (level: LogLevel, text: string, detail?: string) => void;
  setFilter: (levels: ReadonlySet<LogLevel>) => void;
  clear: () => void;
}

let nextId = 1;

export const useConsoleStore = create<ConsoleState>((set) => ({
  lines: [],
  filter: new Set<LogLevel>(["error", "warn", "info", "engine"]),
  version: 0,
  log: (level, text, detail) =>
    set((s) => {
      const line: LogLine = {
        id: nextId++,
        level,
        text,
        ts: Date.now(),
        ...(detail === undefined ? {} : { detail }),
      };
      const lines =
        s.lines.length >= CONSOLE_MAX_LINES
          ? [...s.lines, line].slice(-CONSOLE_MAX_LINES)
          : [...s.lines, line];
      return { lines, version: s.version + 1 };
    }),
  setFilter: (filter) => set((s) => ({ filter, version: s.version + 1 })),
  clear: () => set((s) => ({ lines: [], version: s.version + 1 })),
}));

/** Module-level log helper (usable outside React). */
export function logLine(level: LogLevel, text: string, detail?: string): void {
  useConsoleStore.getState().log(level, text, detail);
}
