/**
 * Studio shell (UI-UX-SPEC §3.1): title bar (A) · tool rail (B) · dockview
 * center (C canvas / D inspector / E instruments) · run bar (F) · status bar
 * (G). Applies layout presets (§3.2), persists custom arrangements, enforces
 * the canvas ≥ 50 % width guard, and hosts the command palette + shortcut
 * overlay + per-panel error boundaries.
 */
import { type DockviewApi, DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef } from "react";
import { registerShellCommands } from "../commands/appCommands.ts";
import { CommandPalette } from "../commands/CommandPalette.tsx";
import { ShortcutOverlay } from "../commands/ShortcutOverlay.tsx";
import { useGlobalShortcuts } from "../commands/useGlobalShortcuts.ts";
import { ErrorBanner } from "../sim/ErrorBanner.tsx";
import { useUiStore } from "../stores/ui-store.ts";
import { loadLayout, saveLayout } from "./layout-persistence.ts";
import { PANEL_COMPONENTS } from "./panels.tsx";
import { CANVAS_MIN_WIDTH_FRACTION, PANEL_TITLES, type PresetId, presetLayout } from "./presets.ts";
import { RunBar } from "./RunBar.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { useShellStore } from "./shell-store.ts";
import { TitleBar } from "./TitleBar.tsx";
import { ToolRail } from "./ToolRail.tsx";

const LAYOUT_GUARD_DEBOUNCE_MS = 250;

export function StudioShell(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<DockviewApi | null>(null);
  const appliedRef = useRef<PresetId | "custom">("build");
  const applyingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);

  const presetNonce = useShellStore((s) => s.presetNonce);
  const focusPanel = useShellStore((s) => s.focusPanel);
  const projectId = useShellStore((s) => s.projectId);
  const theme = useUiStore((s) => s.theme);

  useGlobalShortcuts();
  useEffect(() => {
    registerShellCommands();
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      const stored = loadLayout(projectId);
      if (stored === null) {
        api.fromJSON(presetLayout(useShellStore.getState().preset));
        appliedRef.current = useShellStore.getState().preset;
      } else {
        api.fromJSON(stored);
        appliedRef.current = "custom";
      }
      // User-initiated arrangement changes → persist as custom layout.
      api.onDidLayoutChange(() => {
        if (applyingRef.current) {
          return;
        }
        appliedRef.current = "custom";
        enforceCanvasGuard(api);
        globalThis.clearTimeout(saveTimer.current);
        saveTimer.current = globalThis.setTimeout(() => {
          saveLayout(useShellStore.getState().projectId, api.toJSON());
        }, LAYOUT_GUARD_DEBOUNCE_MS);
      });
    },
    [projectId],
  );

  // Preset changes (menu, palette, commands) — nonce makes re-picking the
  // current preset reset the layout after customization.
  // biome-ignore lint/correctness/useExhaustiveDependencies: presetNonce is an explicit re-trigger
  useEffect(() => {
    const api = apiRef.current;
    if (api === null) {
      return;
    }
    const target = useShellStore.getState().preset;
    applyingRef.current = true;
    try {
      api.fromJSON(presetLayout(target));
      appliedRef.current = target;
    } finally {
      applyingRef.current = false;
    }
  }, [presetNonce]);

  // Panel-focus requests (commands → shell bridge, e.g. Ctrl+` console).
  useEffect(() => {
    const api = apiRef.current;
    if (focusPanel === null || api === null) {
      return;
    }
    const panel = api.getPanel(focusPanel.panelId);
    if (panel !== undefined) {
      panel.api.setActive();
    } else {
      // Panel not in the current preset — add it next to the last group.
      const refGroup = api.groups.at(-1);
      if (refGroup !== undefined) {
        api.addPanel({
          id: focusPanel.panelId,
          component: focusPanel.panelId,
          title:
            PANEL_TITLES[focusPanel.panelId as keyof typeof PANEL_TITLES] ?? focusPanel.panelId,
          position: { referenceGroup: refGroup },
        });
      }
    }
  }, [focusPanel]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <div
          ref={containerRef}
          data-testid="dock-root"
          className="min-w-0 flex-1"
          style={{ "--dv-background": "var(--bg-panel)" } as CSSProperties}
        >
          <DockviewReact
            components={PANEL_COMPONENTS}
            onReady={onReady}
            className={`h-full ${theme === "light" || theme === "paper" ? "dockview-theme-light" : "dockview-theme-dark"}`}
          />
        </div>
      </div>
      <ErrorBanner />
      <RunBar />
      <StatusBar />
      <CommandPalette />
      <ShortcutOverlay />
    </div>
  );
}

/** §3.1 region C guard: the canvas keeps ≥ 50 % of window width. */
export function enforceCanvasGuard(api: DockviewApi): boolean {
  const canvas = api.groups.find((group) => group.panels.some((p) => p.id === "canvas"));
  if (canvas === undefined || api.width <= 0) {
    return false;
  }
  const share = canvas.width / api.width;
  if (share >= CANVAS_MIN_WIDTH_FRACTION) {
    return false;
  }
  canvas.api.setSize({ width: Math.floor(api.width * CANVAS_MIN_WIDTH_FRACTION) });
  return true;
}
