/**
 * uPlot theme adapter (UX3-T1, ADR-010): builds uPlot options from Studio DS
 * CSS variables (§4.1 — no hardcoded hex in components). Called on mount and
 * on theme change (a user action, never per frame). Falls back to a neutral
 * palette when computed styles are unavailable (tests/SSR).
 */
import type { Options, Series } from "uplot";

export interface PlotPalette {
  bg: string;
  grid: string;
  axis: string;
  text: string;
  muted: string;
  accent: string;
  warning: string;
  signals: string[];
}

/** Read the current theme's plot palette from the document root. */
export function plotPalette(): PlotPalette {
  const styles =
    typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const v = (name: string, fallback: string): string => {
    const raw = styles?.getPropertyValue(name).trim();
    return raw !== undefined && raw.length > 0 ? raw : fallback;
  };
  const signals = [1, 2, 3, 4, 5, 6, 7, 8].map((k) =>
    v(`--sig-${k}`, FALLBACK_SIGNALS[k - 1] ?? "#4f8ef7"),
  );
  return {
    bg: v("--canvas-bg", "#0b0e13"),
    grid: v("--grid-dot", "#232b36"),
    axis: v("--border", "#30363d"),
    text: v("--fg", "#e6edf3"),
    muted: v("--fg-muted", "#8b949e"),
    accent: v("--accent", "#4f8ef7"),
    warning: v("--warning", "#f7b34f"),
    signals,
  };
}

const FALLBACK_SIGNALS = [
  "#4f8ef7",
  "#f7b34f",
  "#3fd68f",
  "#f76f8e",
  "#b58ef7",
  "#41c8f4",
  "#d3f34f",
  "#f49f41",
];

/** Base options shared by the scope and the plot panels (§6.7.0). */
export function basePlotOptions(width: number, height: number, palette: PlotPalette): Options {
  return {
    width,
    height,
    series: [{}],
    padding: [12, 8, 4, 8],
    cursor: {
      x: false,
      y: false,
      points: { show: false },
      drag: { setScale: false, x: false, y: false },
    },
    legend: { show: false },
    axes: [
      {
        stroke: palette.muted,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.axis, width: 1 },
        font: "11px 'JetBrains Mono Variable', monospace",
      },
      {
        stroke: palette.muted,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.axis, width: 1 },
        font: "11px 'JetBrains Mono Variable', monospace",
      },
    ],
  };
}

/** Series stub for one channel (color/label filled per channel; colorIndex 1–8). */
export function channelSeries(
  palette: PlotPalette,
  colorIndex: number,
  label: string,
): Partial<Series> {
  const idx = Math.max(0, (colorIndex - 1) % Math.max(1, palette.signals.length));
  return {
    stroke: palette.signals[idx] ?? palette.accent,
    width: 1.5,
    label,
    points: { show: false },
  };
}
