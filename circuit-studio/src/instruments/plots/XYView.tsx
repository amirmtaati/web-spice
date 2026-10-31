/**
 * X–Y view (UX3-T6): plots one signal against another from the current run
 * (Lissajous figures, load lines, I-V from tran data). Same-length buffers
 * are guaranteed by the resultStore contract (AGENTS.md §5.1).
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import { Select } from "../../ui/Select.tsx";
import { downloadPng } from "../scope/export.ts";
import { basePlotOptions, plotPalette } from "../scope/uplot-theme.ts";
import { readSignalValues, useRunData } from "./plot-data.ts";

export function XYView(): ReactNode {
  const run = useRunData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [xName, setXName] = useState<string | null>(null);
  const [yName, setYName] = useState<string | null>(null);

  const options = run?.names ?? [];
  const effectiveX = xName !== null && options.includes(xName) ? xName : (options[0] ?? null);
  const effectiveY =
    yName !== null && options.includes(yName) ? yName : (options[1] ?? options[0] ?? null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null || run === null || effectiveX === null || effectiveY === null) {
      return;
    }
    const palette = plotPalette();
    const xv = readSignalValues(effectiveX);
    const yv = readSignalValues(effectiveY);
    const opts: uPlot.Options = {
      ...basePlotOptions(el.clientWidth || 480, el.clientHeight || 360, palette),
      series: [
        {},
        {
          label: `${effectiveY} vs ${effectiveX}`,
          stroke: palette.signals[0] ?? palette.accent,
          width: 1.5,
        },
      ],
      scales: { x: { time: false, auto: true }, y: { auto: true } },
      cursor: { x: false, y: false, points: { show: false }, drag: { setScale: false } },
    };
    const u = new uPlot(opts, [xv, yv], el);
    const ro = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth || 480, height: el.clientHeight || 360 });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [run, effectiveX, effectiveY]);

  if (run === null) {
    return <Empty>Run a simulation to plot signal against signal.</Empty>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
        <Select
          label="X signal"
          className="h-7 max-w-40 font-mono text-2xs"
          options={options.map((n) => ({ value: n, label: n }))}
          value={effectiveX ?? ""}
          onChange={(e) => setXName(e.target.value)}
        />
        <span className="text-muted">vs</span>
        <Select
          label="Y signal"
          className="h-7 max-w-40 font-mono text-2xs"
          options={options.map((n) => ({ value: n, label: n }))}
          value={effectiveY ?? ""}
          onChange={(e) => setYName(e.target.value)}
        />
        <button
          type="button"
          className="ml-auto rounded border border-line px-1.5 py-0.5 hover:bg-elevated"
          onClick={() => {
            const canvas = containerRef.current?.querySelector("canvas");
            if (canvas instanceof HTMLCanvasElement) {
              downloadPng(canvas, plotPalette().bg, "xy.png");
            }
          }}
        >
          PNG
        </button>
      </div>
      <div className="min-h-0 flex-1" ref={containerRef} data-testid="xy-plot" />
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
