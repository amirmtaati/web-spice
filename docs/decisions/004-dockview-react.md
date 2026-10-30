# ADR 004 — Dock layout: `dockview-react`

**Date:** 2026-10-31 · **Status:** accepted (UX0-T4) · **Deciders:** UI track

## Context

`UI-UX-SPEC.md` §3.1/§3.2 requires a dockable app shell: title bar, tool rail,
center canvas, right inspector dock, bottom instrument dock, run bar, status
bar, with Build/Debug/Present layout presets, draggable/floatable/resizable
panels, and persisted layouts. Master §3.1 names dockview with
`flexlayout-react` as the fallback via a `PanelHost` seam.

## Decision

Adopt **`dockview-react` 8.x** (with `dockview` core) as the panel host.
Panels are declared as React components; presets are applied through
`DockviewApi` (`clear()` + `addPanel` with positions); layout state is
serialized via `api.toJSON()` / `fromJSON()` for persistence.

## Alternatives considered

| Option | Verdict |
|---|---|
| `flexlayout-react` | Fallback per master §3.1; API is imperative-model, theming harder to map to CSS-variable tokens. |
| `react-mosaic` | Binary splits only — no tabs/floats; would need heavy custom work for the instrument dock. |
| Hand-rolled | Weeks of work for drag/dock/float/serialize; not core product value. |

## Consequences

- Size: `dockview-react` + `dockview` ≈ 260 kB min / ~78 kB gzip (measured in
  the UX0 bundle budget); acceptable inside the 350 kB initial-JS budget
  because the canvas renderer and instruments stay separate lazy chunks.
- License MIT; active maintenance (v8 line, 2026); React 19 compatible.
- Theming via the documented `.dockview-theme-*` overrides remapped to
  Studio tokens (`--dv-*` variables mapped to `--bg-panel`/`--border`/…).
- Risk (spec §15): React 19 integration surprises — mitigated by the
  `PanelHost` seam: all dockview usage lives in `src/app/dock/`; swapping the
  library touches that folder only.
