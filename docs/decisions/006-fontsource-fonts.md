# ADR 006 — Bundled fonts: Fontsource (Inter, JetBrains Mono, IBM Plex Sans)

**Date:** 2026-10-31 · **Status:** accepted (UX0-T1) · **Deciders:** UI track

## Context

`UI-UX-SPEC.md` §4.1 requires three bundled font families — Inter (UI text),
JetBrains Mono (numeric readouts, tabular digits), IBM Plex Sans (schematic
text) — as woff2 subsets, self-hosted (no Google Fonts request; CSP-friendly,
offline-capable PWA later).

## Decision

Use the **Fontsource** packages `@fontsource-variable/inter`,
`@fontsource-variable/jetbrains-mono`, `@fontsource/ibm-plex-sans` (weights
400/500/600) and import their CSS from `src/index.css`. Vite fingerprints and
bundles the woff2 files; the `@font-face` rules are part of our stylesheet.

## Alternatives considered

| Option | Verdict |
|---|---|
| Google Fonts CDN | Network dependency, no offline, CSP `style-src`/font fetches from third party — rejected. |
| Manual woff2 download into repo | License files and update discipline become our problem; subsetting tooling duplicated. |
| System font stack only | Loses tabular-figure readouts (JetBrains Mono) and the consistent schematic letterform (IBM Plex Sans). |

## Consequences

- Variable Inter/JetBrains Mono: one woff2 per family (latin subset ≈ 40–90 kB
  each), preloaded via CSS `font-display: swap` (Fontsource default).
- OFL license for all three families (license files ship inside the packages).
- Font stacks are tokens: `--font-ui`, `--font-mono`, `--font-schematic` with
  system fallbacks; components never name a font directly.
