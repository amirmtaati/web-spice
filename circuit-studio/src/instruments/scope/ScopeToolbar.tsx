/**
 * Scope toolbar (UX3-T1..T4, UI-UX-SPEC §6.7.1): Experiments ▸ menu, timebase
 * (s/div 1-2-5 + position + auto-fit), trigger cluster (source/level/edge/
 * mode/holdoff/re-arm), Y scaling, roll, cursors, measurements, history
 * overlay, and the export menu (PNG/CSV).
 */
import {
  Activity,
  Download,
  FlaskConical,
  Gauge,
  History,
  MoveHorizontal,
  Scan,
  Timer,
  Waves,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../ui/Menu.tsx";
import { NumberInput } from "../../ui/NumberInput.tsx";
import { Select } from "../../ui/Select.tsx";
import { runRecipe } from "../experiments/apply.ts";
import { RECIPES } from "../experiments/recipes.ts";
import { autoFit } from "./CursorOverlay.tsx";
import { csvString, downloadPng, downloadText } from "./export.ts";
import { scopePipeline } from "./scope-data.ts";
import { useScopeStore } from "./scope-store.ts";
import type { TriggerEdge } from "./trigger.ts";
import { plotPalette } from "./uplot-theme.ts";

const TIMEBASE_STEPS = [
  1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4,
  2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5, 10,
];

function divLabel(v: number): string {
  if (v >= 1) {
    return `${v}s/div`;
  }
  if (v >= 1e-3) {
    return `${v * 1e3}ms/div`;
  }
  if (v >= 1e-6) {
    return `${v * 1e6}µs/div`;
  }
  return `${v * 1e9}ns/div`;
}

export function ScopeToolbar(): ReactNode {
  const scope = useScopeStore();
  const realSignals = scope.channels.filter((c) => c.math === undefined).map((c) => c.id);

  const exportCsv = (): void => {
    const { axis, signals } = scopePipeline.exportData();
    downloadText(csvString(axis, signals, "s"), "scope-run.csv");
  };

  const exportPng = (): void => {
    // uPlot's main canvas is the first (class-less) canvas under .uplot.
    const canvas = document.querySelector<HTMLCanvasElement>('[data-panel="scope"] .uplot canvas');
    if (canvas !== null) {
      downloadPng(canvas, plotPalette().bg, "scope.png");
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5"
      role="toolbar"
      aria-label="Oscilloscope controls"
    >
      {/* Experiments ▸ */}
      <Menu
        trigger={
          <button
            type="button"
            className="flex h-[var(--ctl-h)] items-center gap-1.5 rounded-md px-2 text-sm text-fg hover:bg-elevated"
            data-testid="experiments-menu"
          >
            <FlaskConical size={14} />
            Experiments
          </button>
        }
      >
        <MenuLabel>Capacitor / inductor lab</MenuLabel>
        {RECIPES.map((r) => (
          <MenuItem key={r.id} onSelect={() => void runRecipe(r)}>
            {r.title}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => scope.setExperiment(null)}>Clear experiment</MenuItem>
      </Menu>

      <ToolbarSep />

      {/* Timebase */}
      <Timer size={14} className="text-faint" aria-hidden />
      <Select
        label="Timebase (seconds per division)"
        options={TIMEBASE_STEPS.map((v) => ({ value: String(v), label: divLabel(v) }))}
        value={String(scope.secPerDiv)}
        onChange={(e) => scope.setSecPerDiv(Number(e.target.value))}
        className="h-7 font-mono text-xs"
      />
      <IconButton label="Auto-fit window to data" onClick={autoFit} className="h-7 w-7">
        <Scan size={14} />
      </IconButton>

      <ToolbarSep />

      {/* Trigger */}
      <Activity size={14} className="text-faint" aria-hidden />
      <Select
        label="Trigger source"
        options={[
          { value: "", label: "first ch" },
          ...realSignals.map((s) => ({ value: s, label: s })),
        ]}
        value={scope.trigger.source ?? ""}
        onChange={(e) =>
          scope.updateTrigger({ source: e.target.value === "" ? null : e.target.value })
        }
        className="h-7 max-w-32 font-mono text-xs"
      />
      <NumberInput
        label="Trigger level"
        value={scope.trigger.level}
        onChange={(level) => scope.updateTrigger({ level })}
        className="h-7 w-20 text-xs"
        step={0.1}
      />
      <Select
        label="Trigger edge"
        options={[
          { value: "rise", label: "↗ rise" },
          { value: "fall", label: "↘ fall" },
          { value: "either", label: "↕ either" },
        ]}
        value={scope.trigger.edge}
        onChange={(e) => scope.updateTrigger({ edge: e.target.value as TriggerEdge })}
        className="h-7 text-xs"
      />
      <fieldset
        className="flex min-w-0 items-center gap-0 rounded-md border border-line p-0.5"
        aria-label="Trigger mode"
      >
        {(["auto", "normal", "single"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={scope.trigger.mode === m}
            onClick={() => {
              scope.updateTrigger({ mode: m });
              if (m === "single") {
                scope.rearm();
              }
            }}
            data-testid={`trig-${m}`}
            className={`rounded px-1.5 py-0.5 text-2xs uppercase ${
              scope.trigger.mode === m ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"
            }`}
          >
            {m}
          </button>
        ))}
      </fieldset>
      {scope.trigger.mode === "single" && (
        <button
          type="button"
          onClick={scope.rearm}
          className="h-7 rounded-md border border-line px-2 text-2xs uppercase text-warning hover:bg-warning-soft"
        >
          Re-arm
        </button>
      )}

      <ToolbarSep />

      {/* Y scale */}
      <button
        type="button"
        aria-pressed={scope.yAuto}
        onClick={() => scope.setYAuto(!scope.yAuto)}
        className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-2xs text-muted hover:text-fg"
        aria-label="Toggle automatic vertical scaling"
      >
        <Gauge size={13} />
        {scope.yAuto ? "Y auto" : "Y fixed"}
      </button>
      {!scope.yAuto && (
        <NumberInput
          label="Volts per division"
          value={scope.voltsPerDiv}
          onChange={scope.setVoltsPerDiv}
          unit="V"
          className="h-7 w-20 text-xs"
          scrub="log"
          min={1e-12}
        />
      )}
      <IconButton
        label="Roll mode (scrolling window)"
        onClick={() => scope.setRoll(!scope.roll)}
        active={scope.roll}
        className="h-7 w-7"
      >
        <MoveHorizontal size={14} />
      </IconButton>

      <ToolbarSep />

      {/* Cursors / measurements / history */}
      <IconButton
        label="Toggle cursors X1/X2"
        onClick={() => scope.updateCursors({ x1: scope.cursors.x1 === null ? 0 : null, x2: null })}
        active={scope.cursors.x1 !== null}
        className="h-7 w-7"
      >
        <span className="font-mono text-2xs">X1X2</span>
      </IconButton>
      <IconButton
        label="Toggle automatic measurements"
        onClick={() => scope.setShowMeasurements(!scope.showMeasurements)}
        active={scope.showMeasurements}
        className="h-7 w-7"
      >
        <Waves size={14} />
      </IconButton>
      <IconButton
        label="Overlay last 5 runs"
        onClick={() => scope.setShowHistory(!scope.showHistory)}
        active={scope.showHistory}
        className="h-7 w-7"
      >
        <History size={14} />
      </IconButton>

      {/* Export */}
      <Menu
        align="end"
        trigger={
          <IconButton label="Export plot" className="h-7 w-7">
            <Download size={14} />
          </IconButton>
        }
      >
        <MenuItem onSelect={exportPng}>PNG image</MenuItem>
        <MenuItem onSelect={exportCsv}>CSV data (full run)</MenuItem>
      </Menu>
    </div>
  );
}

function ToolbarSep(): ReactNode {
  return <div className="mx-0.5 h-5 w-px bg-line" aria-hidden />;
}
