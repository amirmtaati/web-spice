# ADR 009 — Schematic spatial index: `rbush`

**Date:** 2026-10-31 · **Status:** accepted (UX1-T3) · **Deciders:** UI track

## Context

The editor needs an R-tree over symbols, wire segments, labels, and pins for
hit-testing, rubber-band selection, snapping candidates, and viewport culling
(master §9.1). Budget: hit-test < 0.5 ms at 5,000 objects, and "never iterate
all objects on pointer move".

## Decision

Use `rbush` (v4, ~4 KB, zero dependencies, MIT) as the spatial index. It is
the de-facto standard browser R-tree with bulk loading, well-tested, and
runtime-agnostic (plain JS, no DOM/node APIs).

rbush v4 ships no TypeScript declarations; we provide a minimal ambient
declaration (`src/types/rbush.d.ts`) instead of adding `@types/rbush` (which
targets v3 API differences) — the declared surface is exactly what we use.

## Consequences

- All spatial queries go through `src/canvas/spatial.ts`, which adapts the
  document model to rbush items and owns the item↔target mapping.
- Bulk `load()` on document changes (rebuild is cheap at schematic scale:
  ~10k items load in a few ms); incremental inserts are not needed.
- If budgets are ever missed, the `SpatialIndex` interface isolates a swap to
  a custom tree without touching call sites.
