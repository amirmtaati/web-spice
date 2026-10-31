/**
 * Spectrum view (UX3-T6, UI-UX-SPEC §6.7.1 "spectrum"): FFT of a transient
 * signal with taper windows (rect/hann/hamming/blackman), log-frequency
 * magnitude, fundamental + THD readouts. Pure DSP in dsp/fft.ts.
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { resultStore } from "../../stores/result-store.ts";
import { formatEng } from "../../ui/format.ts";
import { Select } from "../../ui/Select.tsx";
import { peakBin, spectrum, thd, type WindowFn } from "../dsp/fft.ts";
import { csvString, downloadPng, downloadText } from "../scope/export.ts";
import { basePlotOptions, plotPalette } from "../scope/uplot-theme.ts";
import { readSignalValues, useRunData } from "./plot-data.ts";

const WINDOWS: { value: WindowFn; label: string }[] = [
  { value: "hann", label: "Hann" },
  { value: "rect", label: "Rect" },
  { value: "hamming", label: "Hamming" },
  { value: "blackman", label: "Blackman" },
];

export function SpectrumView(): ReactNode {
  const run = useRunData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [signal, setSignal] = useState<string | null>(null);
  const [win, setWin] = useState<WindowFn>("hann");

  const options = useMemo(() => run?.names ?? [], [run]);
  const effective = signal !== null && options.includes(signal) ? signal : (options[0] ?? null);

  const model = useMemo(() => {
    if (run === null || effective === null || run.kind !== "tran" || run.points < 16) {
      return null;
    }
    const analysis = resultStore.currentAnalysis;
    const dt = analysis !== null && analysis.kind === "tran" ? analysis.tstep : 0;
    if (!(dt > 0)) {
      return null;
    }
    const values = readSignalValues(effective);
    const spec = spectrum(values, dt, win);
    const fund = peakBin(spec.mag);
    const magDb = Float64Array.from(spec.mag, (m) => (m > 0 ? 20 * Math.log10(m) : Number.NaN));
    return {
      spec,
      magDb,
      fund,
      fundamentalHz: spec.freq[fund] ?? Number.NaN,
      thdPct: thd(spec.mag, fund),
      amplitude: spec.mag[fund] ?? Number.NaN,
    };
  }, [run, effective, win]);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null || model === null) {
      return;
    }
    const palette = plotPalette();
    const half = model.spec.freq.length;
    const fx = model.spec.freq.slice(1, half);
    const fy = model.magDb.slice(1, half);
    const opts: uPlot.Options = {
      ...basePlotOptions(el.clientWidth || 640, el.clientHeight || 320, palette),
      series: [
        {},
        {
          label: `${effective ?? ""} (dB)`,
          stroke: palette.signals[0] ?? palette.accent,
          width: 1.25,
        },
      ],
      scales: { x: { time: false, distr: 3 }, y: { auto: true } },
      axes: [
        {
          ...(basePlotOptions(10, 10, palette).axes?.[0] ?? {}),
          values: (_u, ticks) => ticks.map((v) => formatEng(v, "Hz")),
        },
        {
          ...(basePlotOptions(10, 10, palette).axes?.[1] ?? {}),
          values: (_u, ticks) => ticks.map((v) => `${v.toFixed(0)}`),
        },
      ],
      cursor: { x: true, y: true, points: { show: false }, drag: { setScale: false } },
    };
    const u = new uPlot(opts, [fx, fy], el);
    const ro = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth || 640, height: el.clientHeight || 320 });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [model, effective]);

  if (run === null || run.kind !== "tran") {
    return (
      <Empty>
        Run a <strong>transient</strong> analysis to compute a spectrum.
      </Empty>
    );
  }
  if (model === null) {
    return <Empty>Not enough samples for an FFT (need ≥ 16).</Empty>;
  }

  const exportCsv = (): void => {
    downloadText(
      csvString(
        model.spec.freq,
        [{ name: `${effective ?? "sig"} (dB)`, unit: "dB", values: model.magDb }],
        "Hz",
      ),
      "spectrum.csv",
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
        <Select
          label="Signal"
          className="h-7 max-w-40 font-mono text-2xs"
          options={options.map((n) => ({ value: n, label: n }))}
          value={effective ?? ""}
          onChange={(e) => setSignal(e.target.value)}
        />
        <Select
          label="FFT window"
          className="h-7 text-2xs"
          options={WINDOWS}
          value={win}
          onChange={(e) => setWin(e.target.value as WindowFn)}
        />
        <div
          className="ml-auto flex items-center gap-3 font-mono text-2xs text-muted"
          data-testid="spectrum-features"
        >
          <span>f₁ = {formatEng(model.fundamentalHz, "Hz")}</span>
          <span>A₁ = {formatEng(model.amplitude, "V")}</span>
          <span title="Total harmonic distortion">
            THD = {Number.isFinite(model.thdPct) ? `${model.thdPct.toFixed(2)} %` : "—"}
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
                downloadPng(canvas, plotPalette().bg, "spectrum.png");
              }
            }}
          >
            PNG
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1" ref={containerRef} data-testid="spectrum-plot" />
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
