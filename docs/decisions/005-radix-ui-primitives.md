# ADR 005 — Accessible primitives: Radix UI (partial adoption)

**Date:** 2026-10-31 · **Status:** accepted (UX0-T2) · **Deciders:** UI track

## Context

`UI-UX-SPEC.md` §4.3 prescribes "Radix UI where a behavior exists … otherwise
hand-rolled" for the `src/ui/` primitive layer. Behaviors that are genuinely
hard to get right (focus trapping, roving focus, ARIA wiring, portal layering,
collision-aware positioning) should not be reimplemented.

## Decision

Adopt the unstyled Radix primitives for: **Tooltip** (`@radix-ui/react-tooltip`),
**Popover** (`@radix-ui/react-popover`), **DropdownMenu**
(`@radix-ui/react-dropdown-menu`), **Tabs** (`@radix-ui/react-tabs`), and
**Dialog** (`@radix-ui/react-dialog`, used by the command palette and shortcut
overlay). All remaining primitives (Button, Field/NumberInput, Select, Panel,
Toast, Badge, Chip, Kbd, EmptyState, Skeleton, ProgressBar, Splitter,
ErrorState, ColorDot) are hand-rolled on plain React + CSS tokens.

## Alternatives considered

| Option | Verdict |
|---|---|
| Radix "themes" package | Ships its own design system/colors — conflicts with Studio DS tokens. |
| Headless UI / Ark UI | Smaller behavior coverage for tooltip/popover/menu on our timeline; Ark viable future alternative. |
| Hand-roll everything | Tooltip/menu focus + a11y edge cases are exactly where hand-rolled UI fails axe audits. |

## Consequences

- Radix packages are unstyled, tree-shakeable, ~35 kB gzip combined for the
  five; MIT; first-class React 19 support.
- Styling is ours: every Radix part is wrapped by a Studio primitive
  (`src/ui/Tooltip.tsx` etc.) so no component imports Radix directly except
  its own wrapper file; tokens only (no hardcoded hex).
- Keyboard/ARIA behavior is Radix's responsibility; our component tests assert
  the Studio contract (labels, focus ring tokens, theme variables).
