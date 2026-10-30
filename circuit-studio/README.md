# circuit-studio

Browser app (SPEC §8–11): KiCad-accurate, Figma-smooth schematic editor,
instruments (scope, function generator, multimeter, Bode/spectrum, curve
tracer), dockable dashboard. Vite + React 19 + Tailwind 4 + Zustand, executed
by Bun.

**Architecture rule:** only `src/sim/` imports `@spicekit/client` (enforced by
dependency-cruiser). The engine runs in a Web Worker by default; UI code never
touches transports.

**Agents start here:**
- [`UI-AGENT-PROMPT.md`](./UI-AGENT-PROMPT.md) — copy-paste kickoff prompt.
- [`UI-UX-SPEC.md`](./UI-UX-SPEC.md) — the UI/UX work order: design system,
  shell, instruments, measurement surfaces (per-node/per-element V & I),
  waveform plots (capacitor charge/discharge lab), milestones UX0–UX7 with
  task tables and acceptance gates.
- [`AGENTS.md`](./AGENTS.md) — the engine ⇄ UI wire contract (client API,
  transports, streaming, live mode, errors, IR cheat sheet). The engine
  source never has to be read.

```
src/
  app/          shell, routing, theming, docking
  editor/       canvas, tools (FSMs), selection, wiring, undo/redo, renderer
  library/      component/symbol definitions (JSON) + validator
  netlist/      schematic graph → Circuit IR extraction, ERC
  sim/          ONLY importer of @spicekit/client; run controller, result store
  instruments/  scope, generators, meters, plotters
  dashboard/    layouts, widgets, cursors, measurements
  persistence/  project save/load, IndexedDB, import/export
  ui/           design-system components
  stores/       Zustand slices (ui, project, sim, result)
```
