/**
 * Scope panel body (UX3-T1, UI-UX-SPEC §6.7.1): uPlot surface + cursor
 * overlay + experiment callout + toolbar + legend/measurement column.
 * The uPlot instance is rebuilt only on theme/Y-mode changes (user actions);
 * every data update flows through the pipeline inside the rAF frame loop —
 * React never re-renders per data chunk (§7, UX2-T4).
 */

import { ChartLine } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import uPlot from "uplot";
import { useInstrumentFrame } from "../../sim/useInstrumentFrame.ts";
import { resultStore } from "../../stores/result-store.ts";
import { useUiStore } from "../../stores/ui-store.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { formatEng } from "../../ui/format.ts";
import { CalloutCard } from "./CalloutCard.tsx";
import { CursorOverlay } from "./CursorOverlay.tsx";
import { ScopeLegend } from "./ScopeLegend.tsx";
import { ScopeToolbar } from "./ScopeToolbar.tsx";
import { GHOST_SLOTS, scopePipeline } from "./scope-data.ts";
import { MAX_CHANNELS, type ScopeChannel, useScopeStore } from "./scope-store.ts";
import { basePlotOptions, channelSeries, type PlotPalette, plotPalette } from "./uplot-theme.ts";

function buildOptions(
  width: number,
  height: number,
  palette: PlotPalette,
  yAuto: boolean,
  voltsPerDiv: number,
  visible: readonly ScopeChannel[],
  showHistory: boolean,
): uPlot.Options {
  const opts = basePlotOptions(width, height, palette);
  const channelSeriesList: uPlot.Series[] = visible.map(
    (ch): uPlot.Series => ({
      ...(channelSeries(palette, ch.colorIndex, ch.label) as uPlot.Series),
      show: true,
    }),
  );
  // Pad unused channel slots so the pipeline's fixed 14-slot data layout
  // always has a matching series entry.
  const pad = Array.from(
    { length: Math.max(0, MAX_CHANNELS - visible.length) },
    (): uPlot.Series => ({ show: false }),
  );
  const ghosts = Array.from(
    { length: GHOST_SLOTS },
    (): uPlot.Series => ({
      show: showHistory,
      stroke: palette.muted,
      width: 1,
      spanGaps: false,
    }),
  );
  return {
    ...opts,
    series: [{}, ...channelSeriesList, ...pad, ...ghosts],
    scales: {
      x: { time: false },
      y: yAuto
        ? { auto: true }
        : {
            auto: false,
            range: (): [number, number] => [-5 * voltsPerDiv, 5 * voltsPerDiv],
          },
    },
    axes: [
      {
        ...(opts.axes?.[0] ?? {}),
        values: (_u: uPlot, ticks: number[]): string[] => ticks.map((v) => formatEng(v, "s")),
      },
      {
        ...(opts.axes?.[1] ?? {}),
        values: (_u: uPlot, ticks: number[]): string[] => ticks.map((v) => formatEng(v, "")),
      },
    ],
  };
}

export function ScopePanel(): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, setPlot] = useState<uPlot | null>(null);
  const theme = useUiStore((s) => s.theme);
  const yAuto = useScopeStore((s) => s.yAuto);
  const voltsPerDiv = useScopeStore((s) => s.voltsPerDiv);
  const channels = useScopeStore((s) => s.channels);
  const showHistory = useScopeStore((s) => s.showHistory);
  const resultsVersion = useSyncExternalStore(
    (cb) => resultStore.subscribe(cb),
    () => resultStore.getSnapshot().version,
  );
  const signalCount = useSyncExternalStore(
    (cb) => resultStore.subscribe(cb),
    () => resultStore.getSnapshot().signalNames.length,
  );
  const nonTran =
    signalCount > 0 &&
    resultStore.currentAnalysis !== null &&
    resultStore.currentAnalysis.kind !== "tran";

  const addChannel = useScopeStore((s) => s.addChannel);
  const selectSignals = useScopeStore((s) => s.selectSignals);
  // Auto-wire: a finished run's signals become scope channels (up to 8) —
  // probes appear as traces automatically (UX2-T6 → UX3-T1). When the scope
  // already has channels, only top up signals the engine newly streams.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resultsVersion is an explicit re-trigger (store version gate)
  useEffect(() => {
    if (signalCount === 0 || resultStore.isRunning) {
      return;
    }
    const scope = useScopeStore.getState();
    const names = resultStore.signalNames;
    if (scope.channels.length === 0) {
      selectSignals(names.slice(0, MAX_CHANNELS));
    } else {
      for (const name of names.slice(0, MAX_CHANNELS)) {
        addChannel(name);
      }
    }
  }, [resultsVersion, signalCount, addChannel, selectSignals]);

  // Series configuration signature: uPlot normalizes series.stroke into a
  // function at construction, so post-init mutation is forbidden — the
  // instance is rebuilt whenever the visible-series set changes instead
  // (user-action paced: add/remove/show/hide, color, math label).
  const seriesSig = useMemo(
    () =>
      channels
        .filter((c) => c.visible)
        .map((c) => `${c.id}:${c.colorIndex}:${c.label}`)
        .join("|") + (showHistory ? "+ghosts" : ""),
    [channels, showHistory],
  );

  // ── uPlot instance (rebuild on theme / Y mode / series set) ──────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: seriesSig is the explicit rebuild trigger for the visible-series set
  useEffect(() => {
    void theme; // rebuild when the theme changes (palette reads CSS vars)
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    const palette = plotPalette();
    const scope = useScopeStore.getState();
    const visible = scope.channels.filter((c) => c.visible);
    const u = new uPlot(
      buildOptions(
        el.clientWidth || 640,
        el.clientHeight || 360,
        palette,
        yAuto,
        voltsPerDiv,
        visible,
        showHistory,
      ),
      [],
      el,
    );
    scopePipeline.attach(u);
    scopePipeline.resize(el.clientWidth);
    setPlot(u);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      u.setSize({ width: w, height: h });
      scopePipeline.resize(w);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      scopePipeline.detach();
      u.destroy();
      setPlot(null);
    };
  }, [theme, yAuto, voltsPerDiv, seriesSig, showHistory]);

  // ── frame loop ────────────────────────────────────────────────────────────
  useInstrumentFrame((now) => {
    scopePipeline.frame(now);
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-panel="scope">
      <ScopeToolbar />
      <div
        className="relative min-h-40 flex-1 overflow-hidden"
        ref={containerRef}
        data-testid="scope-plot"
      >
        {channels.length === 0 && (
          <div className="absolute inset-0 z-[6]">
            <EmptyState
              icon={<ChartLine size={22} strokeWidth={1.5} />}
              title="No scope channels"
              hint="Run an Experiment, add probes with the probe tool (P), or pick signals after a run — the legend table lists everything the engine streams."
            />
          </div>
        )}
        {nonTran && channels.length > 0 && (
          <div className="absolute inset-0 z-[6] flex items-center justify-center bg-panel/80">
            <p className="max-w-64 text-center text-xs text-muted">
              This run is not time-domain — open the <strong>Plots</strong> panel for Bode / DC
              sweep / spectrum views. The scope shows transient and live runs.
            </p>
          </div>
        )}
        <CursorOverlay />
        <CalloutCard />
      </div>
      <ScopeLegend />
    </div>
  );
}
