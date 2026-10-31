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

## UI baselines (UX0-T8, UI-UX-SPEC §10 budgets)

Environment: headless Chromium (Playwright `chrome-headless-shell` 156),
production build (`vite build` + `vite preview`), Linux x64 sandbox, 1366×768.
Harness page: `circuit-studio` with `?view=perf`. Measured 2026-10-31.

### Bundle sizes (budget: initial JS ≤ 350 kB gzip, §10)

| Asset | Min | Gzip | Budget | Status |
|---|---|---|---|---|
| Initial JS (`index-*.js`, dockview + radix + lucide included) | 916.5 kB | **260.0 kB** | ≤ 350 kB gzip | ✅ |
| React vendor chunk (`react-*.js`) | 12.0 kB | 4.3 kB | counted in initial | ✅ |
| CSS (`index-*.css`, dockview theme mapping included) | 173.9 kB | 21.1 kB | — | — |
| Engine worker (`engine.worker-*.js`, lazy — not initial) | 132.8 kB | ~36 kB | lazy chunk | — |

### Runtime probes (perf harness page, UX0)

| Metric | Value | Budget (§10) | Status |
|---|---|---|---|
| Harness mount since navigation (lower bound for cold load) | 3.0 ms | cold → interactive ≤ 2.5 s | harness-only; full shell cold-load + Lighthouse ≥ 90 verified in UXR |
| rAF median frame time (idle shell loop, 120 frames) | 16.70 ms | 60 FPS ⇒ ≤ 16.7 ms | ✅ (vsync-bound) |
| rAF p95 frame time | 16.80 ms | no frame > 25 ms | ✅ |
| Ring buffer 1 Mi writes + 65,536 reads | 3.30 ms | allocation-free reads < 8 ms | ✅ |

### Shell interaction (e2e, smoke suite timings)

| Metric | Value | Budget | Status |
|---|---|---|---|
| Preset switch Build→Debug (Playwright step, incl. assertion) | ~540 ms wall | animation 160 ms; perception instant | e2e timing is assertion-inclusive; the animation itself uses `--dur-2` (160 ms) |
| Worker handshake (engine chip ready) | < 400 ms | crash recovery < 1 s class | ✅ |

### Waveform instruments (UX3)

| Metric | Value | Budget (§10 / UX3-T1) | Status |
|---|---|---|---|
| Min-max pair decimation, 4 channels × 100 k → 2048 bins each (inline, worst case) | ~12 ms total (bun perf test) | draw loop keeps 60 fps with worker offload | ✅ decimation runs in `decimate.worker.ts`; inline is the fallback path |
| Scope render fps, 100 k-point decimated window, 1 channel + trigger + cursors (e2e, Chromium headless, 1720×1000) | ≥ 55 fps measured over 1.5 s | ≥ 60 fps budget; e2e gate ≥ 55 (CI variance margin) | ✅ `scope.e2e.ts` perf gate |
| Instrument chunks (lazy, §15.1) | `ScopePanel` 25.4 kB (9.1 gzip) + `PlotsPanel` 18.9 kB (6.3 gzip) + `uplot-theme` (uPlot) 54.5 kB (24.5 gzip) + `decimate.worker` 0.7 kB | instruments NOT in the initial chunk | ✅ loaded on first panel open |
| Initial JS after UX3 (uPlot + instrument math moved to lazy chunks) | 1,063.7 kB raw / **306.3 kB gzip** | ≤ 350 kB gzip | ✅ (+46 kB vs UX0 — experiment recipes, plot math, scope store) |
| RC experiment τ fit vs R·C (engine in-process + UI pathway) | τ ≈ 1.000 ms for R·C = 1 ms (R² = 1.000) | within 5 % | ✅ unit + e2e |
| Sallen-Key −3 dB corner through the UI (Bode features) | 1.03 kHz vs analytic 1.024 kHz | ±5 % | ✅ e2e |

Notes:

- Drag pointer-to-photon, pan/zoom with 1,000 symbols, hit-test, and 30-min
  live-session memory budgets require the canvas (UX1) and live mode (UX5);
  those rows populate here as their milestones land.
- The 16.7 ms median is the headless vsync quantum — it certifies "no long
  tasks", not wasted frames; frame-level budgets are re-measured against real
  canvas work from UX1 on.
