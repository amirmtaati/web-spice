/**
 * Bode plotter (UX3-T6, UI-UX-SPEC §6.7.2): magnitude (dB) + phase (deg) vs
 * log frequency from an `ac` run; draggable crosshair readouts at the exact
 * interpolated frequency; automatic −3 dB marker, 0 dB crossover, gain/phase
 * margins (bode.ts). Export CSV/PNG via the shared plot menu.
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { formatEng } from "../../ui/format.ts";
import { Select } from "../../ui/Select.tsx";
import { csvString, downloadPng, downloadText } from "../scope/export.ts";
import { basePlotOptions, plotPalette } from "../scope/uplot-theme.ts";
import { bodeFeatures, magDbFrom, phaseFrom, valueAt } from "./bode.ts";
import { findSignal, readSignalValues, useRunData } from "./plot-data.ts";

function freqLabel(v: number): string {
  return formatEng(v, "Hz");
}

export function BodeView(): ReactNode {
  const run = useRunData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [magName, setMagName] = useState<string | null>(null);
  const [phaseName, setPhaseName] = useState<string | null>(null);

  const magCandidates = useMemo(
    () => (run === null ? [] : run.names.filter((n) => /^(vm|vdb|im|idb)\(/.test(n))),
    [run],
  );
  const phaseCandidates = useMemo(
    () => (run === null ? [] : run.names.filter((n) => /^(vp|ip)\(/.test(n))),
    [run],
  );

  const effectiveMag = magName ?? findSignal(magCandidates, "vm(") ?? magCandidates[0] ?? null;
  const effectivePhase =
    phaseName ??
    findSignal(phaseCandidates, `vp(${effectiveMag?.slice(3) ?? ""}`) ??
    phaseCandidates[0] ??
    null;

  // ── compute series + features ────────────────────────────────────────────
  const model = useMemo(() => {
    if (run === null || effectiveMag === null || run.points < 2) {
      return null;
    }
    const values = readSignalValues(effectiveMag);
    const magDb = magDbFrom(effectiveMag, values);
    if (magDb === null) {
      return null;
    }
    const phase =
      effectivePhase !== null ? phaseFrom(effectivePhase, readSignalValues(effectivePhase)) : null;
    const features = bodeFeatures(run.axis, magDb, phase ?? undefined);
    return { magDb, phase, features };
  }, [run, effectiveMag, effectivePhase]);

  // ── uPlot mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || run === null || model === null) {
      return;
    }
    const palette = plotPalette();
    const series: uPlot.Series[] = [
      {},
      { label: `${effectiveMag} (dB)`, stroke: palette.signals[0] ?? palette.accent, width: 1.5 },
      ...(model.phase !== null
        ? [
            {
              label: `${effectivePhase} (deg)`,
              stroke: palette.signals[1] ?? palette.accent,
              width: 1.25,
              scale: "y2",
            } as uPlot.Series,
          ]
        : []),
      { label: "−3 dB", stroke: palette.warning, width: 1, dash: [4, 3] },
    ];
    const opts: uPlot.Options = {
      ...basePlotOptions(el.clientWidth || 640, el.clientHeight || 320, palette),
      series,
      scales: {
        x: { time: false, distr: 3 }, // log frequency
        y: { auto: true },
        ...(model.phase !== null ? { y2: { auto: true } } : {}),
      },
      axes: [
        {
          ...(basePlotOptions(10, 10, palette).axes?.[0] ?? {}),
          values: (_u, ticks) => ticks.map(freqLabel),
        },
        {
          ...(basePlotOptions(10, 10, palette).axes?.[1] ?? {}),
          values: (_u, ticks) => ticks.map((v) => `${v.toFixed(0)}`),
        },
        ...(model.phase !== null
          ? [
              {
                ...(basePlotOptions(10, 10, palette).axes?.[1] ?? {}),
                scale: "y2",
                values: (_u, ticks) => ticks.map((v) => `${v.toFixed(0)}°`),
              } as uPlot.Axis,
            ]
          : []),
      ],
      cursor: { x: true, y: true, points: { show: false }, drag: { setScale: false } },
    };
    const minus3 = model.features.peakDb - 3;
    const data: uPlot.AlignedData = [
      run.axis,
      model.magDb,
      ...(model.phase !== null ? [model.phase] : []),
      Float64Array.from([run.axis[0] ?? 0, run.axis[run.axis.length - 1] ?? 0]).map(() => minus3),
    ];
    const u = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth || 640, height: el.clientHeight || 320 });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [run, model, effectiveMag, effectivePhase]);

  if (run === null || run.kind !== "ac") {
    return (
      <Empty>
        Run an <strong>AC analysis</strong> to see the Bode plot.
      </Empty>
    );
  }
  if (model === null) {
    return <Empty>No magnitude signal (vm/vdb) in this run — probe a node voltage.</Empty>;
  }

  const f = model.features;

  const exportCsv = (): void => {
    const signals = [
      { name: effectiveMag ?? "mag", unit: "dB", values: model.magDb },
      ...(model.phase !== null && effectivePhase !== null
        ? [{ name: effectivePhase, unit: "deg", values: model.phase }]
        : []),
    ];
    downloadText(csvString(run.axis, signals, "Hz"), "bode.csv");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
        <Select
          label="Magnitude signal"
          className="h-7 max-w-40 font-mono text-2xs"
          options={magCandidates.map((n) => ({ value: n, label: n }))}
          value={effectiveMag ?? ""}
          onChange={(e) => setMagName(e.target.value)}
        />
        {phaseCandidates.length > 0 && (
          <Select
            label="Phase signal"
            className="h-7 max-w-40 font-mono text-2xs"
            options={phaseCandidates.map((n) => ({ value: n, label: n }))}
            value={effectivePhase ?? ""}
            onChange={(e) => setPhaseName(e.target.value)}
          />
        )}
        <div
          className="ml-auto flex items-center gap-3 font-mono text-2xs text-muted"
          data-testid="bode-features"
        >
          <span title="−3 dB corner">
            f₋₃ᵈᵇ = {f.minus3dB !== null ? freqLabel(f.minus3dB) : "—"}
          </span>
          <span title="0 dB crossover">
            f₀dB = {f.crossover !== null ? freqLabel(f.crossover) : "—"}
          </span>
          <span title="Phase margin">
            PM = {f.phaseMargin !== null ? `${f.phaseMargin.toFixed(1)}°` : "—"}
          </span>
          <span title="Gain margin">
            GM = {f.gainMargin !== null ? `${f.gainMargin.toFixed(1)} dB` : "∞"}
          </span>
          <button
            type="button"
            className="rounded border border-line px-1.5 py-0.5 hover:bg-elevated"
            onClick={exportCsv}
          >
            CSV
          </button>
          <button
            type="button"
            className="rounded border border-line px-1.5 py-0.5 hover:bg-elevated"
            onClick={() => {
              const canvas = containerRef.current?.querySelector("canvas");
              if (canvas instanceof HTMLCanvasElement) {
                downloadPng(canvas, plotPalette().bg, "bode.png");
              }
            }}
          >
            PNG
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1" ref={containerRef} data-testid="bode-plot" />
    </div>
  );
}

function Empty({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
      {children}
    </div>
  );
}

/** Cursor readout helper used by the crosshair (exported for tests). */
export function readoutAt(axis: ArrayLike<number>, values: ArrayLike<number>, f: number): number {
  return valueAt(axis, values, f);
}
