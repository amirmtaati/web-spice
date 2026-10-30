/**
 * Title bar (UI-UX-SPEC §3.1 region A, 36 px): logo, editable project name
 * with dirty dot, and the global command entries — palette, layout presets,
 * theme, export. Palette-first: no classic menu bar.
 */
import { ChevronDown, Command, FileDown } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeId } from "../app/theme.ts";
import { THEMES } from "../app/theme.ts";
import { useCommandRegistry } from "../commands/registry.ts";
import { formatShortcut } from "../commands/shortcut.ts";
import { useUiStore } from "../stores/ui-store.ts";
import { Button } from "../ui/Button.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { PRESET_IDS, PRESET_LABELS, type PresetId } from "./presets.ts";
import { useShellStore } from "./shell-store.ts";

export function TitleBar(): ReactNode {
  const projectName = useShellStore((s) => s.projectName);
  const dirty = useShellStore((s) => s.dirty);
  const setProjectName = useShellStore((s) => s.setProjectName);
  const preset = useShellStore((s) => s.preset);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const setPreset = useShellStore((s) => s.setPreset);
  const setPaletteOpen = useCommandRegistry((s) => s.setPaletteOpen);

  return (
    <header
      data-testid="titlebar"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg">
        <CircuitMark />
        Circuit Studio
      </span>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
      <input
        data-testid="project-name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        aria-label="Project name"
        size={Math.max(projectName.length, 8)}
        className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted outline-none hover:border-line focus:border-line focus:text-fg"
      />
      {dirty && (
        <span
          role="img"
          aria-label="Unsaved changes"
          title="Unsaved changes"
          className="h-1.5 w-1.5 rounded-full bg-warning"
        />
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          data-testid="open-palette"
          onClick={() => setPaletteOpen(true)}
        >
          <Command size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="text-xs">Commands</span>
          <Kbd>{formatShortcut("Mod+K")}</Kbd>
        </Button>
        <PresetMenu current={preset} onPick={setPreset} />
        <ThemeMenu current={theme} onPick={setTheme} />
        <Button size="sm" variant="ghost" disabled title="Export lands with UX2 (§6.10)">
          <FileDown size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="text-xs">Export</span>
        </Button>
      </div>
    </header>
  );
}

function CircuitMark(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-accent">
      <circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8h4M12 6v2M8 4v4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12H6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PresetMenu({
  current,
  onPick,
}: {
  readonly current: PresetId;
  readonly onPick: (id: PresetId) => void;
}): ReactNode {
  return (
    <Menu
      align="end"
      trigger={
        <Button size="sm" variant="ghost" aria-label="Layout preset">
          <span className="text-xs">{PRESET_LABELS[current]}</span>
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      }
    >
      {PRESET_IDS.map((id) => (
        <MenuItem key={id} onSelect={() => onPick(id)}>
          {PRESET_LABELS[id]}
          {id === current && (
            <span aria-hidden="true" className="text-accent">
              •
            </span>
          )}
        </MenuItem>
      ))}
    </Menu>
  );
}

function ThemeMenu({
  current,
  onPick,
}: {
  readonly current: ThemeId;
  readonly onPick: (id: ThemeId) => void;
}): ReactNode {
  return (
    <Menu
      align="end"
      trigger={
        <Button size="sm" variant="ghost" aria-label="Theme">
          <span className="text-xs capitalize">{current}</span>
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      }
    >
      {THEMES.map((t) => (
        <MenuItem key={t.id} onSelect={() => onPick(t.id)}>
          {t.label}
          {t.id === current && (
            <span aria-hidden="true" className="text-accent">
              •
            </span>
          )}
        </MenuItem>
      ))}
    </Menu>
  );
}
