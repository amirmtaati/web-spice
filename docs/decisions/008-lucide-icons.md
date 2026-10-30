# ADR 008 — Lucide icons for chrome and tool rail

- **Status:** accepted (UX0-T2/T4)
- **Deciders:** UI track agent
- **Date:** 2026-10-31

## Context

UI-UX-SPEC §4.4 mandates a single icon set — "Lucide, tree-shaken, 16 px
stroke 1.5 in chrome, 20 px on tool rail" — across tool rail, title bar,
menus, empty states, and instrument chrome. Hand-drawn inline SVGs would
diverge from the spec and drift as panels multiply; another set would violate
the "no mixed sets" rule.

## Decision

Adopt `lucide-react` as the only icon source. Import per-icon
(`import { Play } from "lucide-react"`) so ESM tree-shaking keeps only used
glyphs in the bundle. Icons render at 16 px (`size={16}`, `strokeWidth={1.5}`)
in chrome and 20 px on the tool rail; color comes from currentColor so tokens
(`text-muted`, `text-accent`, `text-faint`) govern all icon color.

## Consequences

- New runtime dependency in `circuit-studio` (~30 kB min, smaller gzip, only
  for glyphs actually imported; verified in `docs/perf-baseline.md`).
- Icon usage stays inside `src/ui/` and `src/shell/`/panels; canvases draw
  their own markers (ERC triangles, probe dots) per §4.4 — Lucide is chrome
  only.
- If bundle budget §10 (initial JS ≤ 350 kB gzip) is ever threatened, swap to
  a build-time SVG subset — the per-icon import pattern keeps this mechanical.
