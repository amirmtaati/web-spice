# Fixtures

Netlists and golden outputs for engine verification (SPEC §13.2). Text only.

- `*.cir` / `*.sp` — input netlists (analytical + reference + regression)
- `golden/` — ngspice-generated outputs, produced by `scripts/gen-golden.ts`
  (ngspice version recorded in the header; CI never needs ngspice installed)
- `regressions/` — one minimal netlist per fixed bug, named after the issue
- Gallery circuits (SPEC §19, all 26) land here with U4 as e2e fixtures too
