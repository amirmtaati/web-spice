# circuit-studio

Browser app (SPEC §8–11): KiCad-accurate, Figma-smooth schematic editor,
instruments (scope, function generator, multimeter, Bode/spectrum, curve
tracer), dockable dashboard. Vite + React 19 + Tailwind 4 + Zustand, executed
by Bun.

**Architecture rule:** only `src/sim/` imports `@spicekit/client` (enforced by
dependency-cruiser). The engine runs in a Web Worker by default; UI code never
touches transports.

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
