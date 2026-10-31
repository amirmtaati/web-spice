# ADR 010 — Waveform rendering: uPlot for scope and plot panels

**Date:** 2026-10-31 · **Status:** accepted (UX3-T1) · **Deciders:** UI track

## Context

UX3 introduces the oscilloscope and the plot family (Bode, DC sweep, X-Y,
spectrum). The perf budget (§10) is explicit: **≥ 60 fps with 4 channels ×
100k visible points**, near-zero allocation in the draw loop, with min-max
decimation feeding the renderer. The canvas renderer already in the repo
(`src/canvas`) serves the schematic, not time-series charts; hand-rolling a
plot engine would repeat a well-solved problem (axes, ticks, zoom, DPI,
hover) at high risk.

## Decision

Adopt **uPlot** (`uplot`, ~48 kB min / ≈ 12 kB gzip, MIT, zero deps) as the
series renderer for the scope and all plot panels. Thin adapter owned by us:

- `src/instruments/scope/uplot-theme.ts` — factory builds uPlot options from
  Studio DS CSS variables per theme (dark/light/paper); no hardcoded hex.
- Data path stays ours: ring buffers → min-max pair decimation → typed
  arrays handed to `u.setData()` inside the rAF frame loop (React never
  re-renders per chunk — §7).
- uPlot's built-in cursor/drag-zoom is disabled where the custom cursor
  overlay (`CursorOverlay.tsx`) owns the pointer; its legend is disabled in
  favor of the Studio legend/measurement column.

## Alternatives considered

| Option | Verdict |
|---|---|
| Chart.js / Chartist | Canvas but slow > 10k points; re-renders via config objects — wrong shape for a scope. |
| ECharts | Full-featured but ~1 MB; canvas renderer allocates per frame; overkill for series-only panels. |
| Plotly | Scientific features (Bode margins) but huge, SVG/DOM-heavy, no fit for 60 fps scopes. |
| Hand-rolled canvas plots | Full control but axes/ticks/hover/DPI/zoom are exactly the long tail; weeks of work for worse results. |
| GPU path now (Pixi) | The scope's high-point-count path "uses the GPU renderer" in the spec — deferred: min-max pairs cap visible points at ~4–8k, so Canvas2D holds 60 fps comfortably (perf test). Revisit at UX5 live soak. |

## Consequences

- One new dependency (~12 kB gzip) — the only UX3 addition; plotted data
  flows through our pipeline unchanged (testable without a browser).
- uPlot requires aligned, x-ascending arrays — the decimator's min/max
  pair emission stamps strictly increasing x by construction (unit-tested).
- uPlot is canvas-only: PNG export comes free (`toBlob` on its canvas);
  theme switches rebuild options (cheap, on user action, not per frame).
