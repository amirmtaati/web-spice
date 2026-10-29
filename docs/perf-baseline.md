# Performance baselines

Recorded **before** heavy editor work (SPEC §24 task 5). This file holds the
numbers each budget check compares against; regressions > 10% fail CI, > 5%
warn. Budgets themselves live in SPEC §17.

| Date | Metric | Environment | Value | Notes |
|---|---|---|---|---|
| 2026-10-29 | (baseline table empty) | — | — | First measurements land with the U1 performance test page |

Baseline workflow:

1. Build the performance test page (drag, pan/zoom, hit-test, 100-node live
   transient).
2. Measure in headless Chromium with the mid-range CPU-throttling profile.
3. Write numbers here with commit hash; CI compares mitata/browser runs to
   `bench/baseline.json` exports of these values.
