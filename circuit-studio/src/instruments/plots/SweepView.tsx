/**
 * DC sweep / curve tracer (UX3-T6, UI-UX-SPEC §6.7.3): swept source on X,
 * any measured signals on Y (multi-trace). Diode IV, BJT output families,
 * MOSFET Id-Vds all land here. The Results table (UX4) shows the sweep
 * numerically; CSV export covers the tabular form.
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { csvString, downloadPng, downloadText } from "../scope/export.ts";
import { basePlotOptions, plotPalette } from "../scope/uplot-theme.ts";
import { readSignalValues, useRunData } from "./plot-data.ts";

export function SweepView(): ReactNode {
  const run = useRunData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const effective = useMemo(() => {
    if (run === null) {
      return [];
    }
    if (picked.length > 0) {
      return picked.filter((p) => run.names.includes(p)).slice(0, 4);
    }
    return run.names.slice(0, 2);
  }, [run, picked]);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null || run === null || run.kind !== "dc" || effective.length === 0) {
      return;
    }
    const palette = plotPalette();
    const series: uPlot.Series[] = [
      {},
      ...effective.map(
        (name, k): uPlot.Series => ({
          label: name,
          stroke: palette.signals[k % palette.signals.length] ?? palette.accent,
          width: 1.5,
        }),
      ),
    ];
    const opts: uPlot.Options = {
      ...basePlotOptions(el.clientWidth || 640, el.clientHeight || 320, palette),
      series,
      scales: { x: { time: false }, y: { auto: true } },
      cursor: { x: true, y: true, points: { show: false }, drag: { setScale: false } },
    };
    const data: uPlot.AlignedData = [run.axis, ...effective.map((name) => readSignalValues(name))];
    const u = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth || 640, height: el.clientHeight || 320 });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [run, effective]);

  if (run === null || run.kind !== "dc") {
    return (
      <Empty>
        Run a <strong>DC sweep</strong> to trace I–V curves (diode IV, BJT output families, MOSFET
        Id-Vds).
      </Empty>
    );
  }

  const exportCsv = (): void => {
    downloadText(
      csvString(
        run.axis,
        effective.map((name) => ({ name, unit: "", values: readSignalValues(name) })),
        "V",
      ),
      "dc-sweep.csv",
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
        {run.names.slice(0, 6).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={effective.includes(name)}
            onClick={() =>
              setPicked((prev) =>
                (prev.length > 0 ? prev : [...effective]).includes(name)
                  ? (prev.length > 0 ? prev : [...effective]).filter((p) => p !== name)
                  : [...(prev.length > 0 ? prev : [...effective]), name].slice(0, 4),
              )
            }
            className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${
              effective.includes(name)
                ? "border-accent text-accent"
                : "border-line text-muted hover:text-fg"
            }`}
          >
            {name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
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
                downloadPng(canvas, plotPalette().bg, "dc-sweep.png");
              }
            }}
          >
            PNG
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1" ref={containerRef} data-testid="sweep-plot" />
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
