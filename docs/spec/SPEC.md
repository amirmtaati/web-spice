# Web Circuit Simulator: Master Specification (v1.0)

**Two projects, one product, built in TypeScript on Bun:**

1. **`spicekit`**: a SPICE-class circuit simulation engine, typed protocol, client library, server, and CLI. No UI.
2. **`circuit-studio`**: a browser app with a KiCad-accurate, Figma-smooth drag-and-drop schematic editor, instruments (oscilloscope, function generator, multimeter, Bode/spectrum plotters, curve tracer) and a beautiful dockable dashboard.

They are separate repositories connected only through a versioned contract (`@spicekit/protocol`) and a transport-agnostic client (`@spicekit/client`).

**Audience:** an autonomous coding agent and the human reviewing it. This document is self-contained and is the single source of truth. It is accompanied by `AGENT.md` (how the agent works day to day). Where this spec says "must", it is enforced by CI or review.

**Final target:** production-ready, excellent, extensively tested software that is ready to be used by a GUI: the bundled web app, or any other GUI that embeds the engine as an npm library, a remote WebSocket service, or a CLI.

---

## Table of contents

1. Vision, goals, principles
2. System architecture
3. Toolchain (Bun) and repositories
4. Protocol (`@spicekit/protocol`)
5. Engine (`@spicekit/core`)
6. Client library (`@spicekit/client`)
7. Server and CLI
8. UI architecture and state
9. Schematic editor (rendering, camera, selection, drag and drop, wiring, symbols, commands, visuals)
10. Instruments and dashboard
11. Persistence, import and export
12. Code standards
13. Testing strategy
14. Cross-engine numerical correctness
15. CI/CD and releases
16. Security and robustness
17. Performance and reliability budgets
18. Accessibility, i18n, documentation, observability
19. Example circuit gallery
20. Production readiness checklist (release gate)
21. "Looks right" checklist for schematics
22. Milestones
23. Risk register
24. First tasks for the agent
25. Future extensions

---

## 1. Vision, goals, principles

### 1.1 Goals
- Runs entirely in the browser by default (no backend required), with an optional remote-engine mode.
- **Interactive feel:** change a knob, toggle a switch, or retune the function generator while the simulation runs and see the waveform react within ~100 ms.
- Correct for typical analog and hobbyist/educational circuits: RC/RLC, filters, op-amps, diode/BJT/MOSFET stages, oscillators, switching converters.
- A **beautiful, modern dashboard** (dark, light, and print-style "Paper" themes).
- Schematics that are **accurate, standard, and nice to look at**, with drag and drop that feels as fluid as a design tool and behaves as predictably as KiCad.
- Import/export of standard SPICE netlists.
- Production-grade engineering: clean manageable code, extensive tests, security, documentation, and a rehearsed release process.

### 1.2 Non-goals (v1)
Full BSIM-class MOSFET models, RF/S-parameters, PCB layout, event-driven mixed-signal digital simulation, Monte Carlo/optimizer, native desktop packaging (see section 25).

### 1.3 Engineering principles
1. **Correctness before cleverness.** Simple, well-understood numerical methods first; optimize only with a benchmark showing a need.
2. **Small, boring, readable.** A new contributor understands any file in five minutes.
3. **Make illegal states unrepresentable** (discriminated unions, branded types, exhaustive `switch`).
4. **Pure core, thin shell.** Numerical and geometric logic is pure and deterministic; I/O, DOM, workers, and storage sit at the edges.
5. **Direct manipulation.** The thing under the cursor moves with the cursor. No modal dialogs for geometry.
6. **Never lose electrical intent.** Moving, rotating, or dragging never silently creates or breaks connections.
7. **Always tidy.** Output is orthogonal, grid-aligned, consistently styled.
8. **Fail loudly and helpfully.** Errors carry a stable code, a human message, and a location (element name, node, line, UI component id).
9. **Everything reproducible.** Seeds are explicit, builds deterministic, lockfiles committed.
10. **Browsers are the product runtime.** Bun is the toolchain and server runtime; correctness is proven in browsers too (section 14).

---

## 2. System architecture

```
┌────────────────────────── circuit-studio (browser) ──────────────────────────┐
│  Schematic editor ─► Netlist extractor ─► SimulatorClient ──┐                │
│  Instruments / Dashboard ◄── ResultStore ◄── data stream ◄──┤                │
└─────────────────────────────────────────────────────────────┼────────────────┘
                                                              │ @spicekit/protocol
                          ┌───────────────────────────────────┴───────────────┐
                          │  Transport (pluggable)                            │
                          │   • WorkerTransport    (default, Web Worker)      │
                          │   • WebSocketTransport (remote Bun engine server) │
                          │   • InProcessTransport (tests, Bun, Node)         │
                          └───────────────────────────────────┬───────────────┘
                                                              │
┌────────────────────────────── spicekit (engine) ────────────┴────────────────┐
│  Parser ─► Circuit IR ─► Compiler (MNA stamps) ─► Solver ─► Analyses ─► Data  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 How the two projects connect
- **Contract:** `@spicekit/protocol` defines every message, the Circuit IR, result formats, error codes, and `PROTOCOL_VERSION` (semver). Handshake on connect; incompatible majors are refused with a clear error.
- **Default transport:** the engine runs in a **Web Worker** created by `@spicekit/client`. The UI never touches the worker directly.
- **Remote mode:** `@spicekit/server` (Bun) exposes the same protocol over WebSocket. The UI picks a transport via settings. All transports pass one shared conformance suite.
- **Bulk data** (waveforms) moves as typed arrays via `Transferable` ArrayBuffers (worker) or binary frames (WebSocket). Control messages are JSON validated with `zod`.
- **Engine adapter seam:** an `EngineAdapter` interface lets a future ngspice-WASM backend replace the core without UI changes. Exercised in v1 by a stub adapter.

### 2.2 Runtime-agnostic rule (critical)
- `protocol`, `core`, `client`, and all UI code **must not** import `bun:*`, use the `Bun` global, `node:*` built-ins, or `process`. Enforced by lint (`no-restricted-globals`/`no-restricted-imports`), scoped TypeScript types, and a CI job that **bundles these packages for the browser target** and fails if Bun/Node-specific code is pulled in.
- Bun-specific code lives only in `server`, `cli`, `scripts/`, and test setup. Environment-specific behavior is injected through interfaces (`Clock`, `Rng`, `Logger`, `IncludeResolver`, `Transport`).

---

## 3. Toolchain (Bun) and repositories

### 3.1 Decisions

| Concern | Choice |
|---|---|
| Runtime, package manager, workspaces, scripts | **Bun** (pinned exact version) |
| Tests (unit, property, integration, UI component) | **`bun test`** + fast-check; happy-dom + Testing Library for UI components |
| E2E, visual regression, accessibility | **Playwright** (+ axe-core) against the production build |
| Library bundling | **`bun build`** (JS) + **`tsc`** (`.d.ts`) |
| UI bundler and dev server | **Vite, executed by Bun** (`bun --bun run vite`) |
| Server | **`Bun.serve`** with native WebSocket |
| CLI | **Bun**, optionally single-file executables via `bun build --compile` |
| Format and general lint | **Biome** |
| Type-aware lint | **ESLint** with only type-aware rules (no overlap with Biome) |
| Benchmarks | **mitata** under Bun + browser benchmarks via Playwright traces |
| Lockfile | `bun.lock` (text, committed, never hand-edited) |
| Versioning and changelogs | **changesets** |
| Publishing | `npm publish --provenance` in CI (verify; switch to `bun publish` only if provenance is supported, via ADR) |
| Plotting | **uPlot** for standard series; custom **WebGL/OffscreenCanvas** for the scope at high point counts |
| UI stack | React 19, Zustand + Immer, Tailwind CSS (+ CSS variables), Radix UI, `dockview` or `flexlayout-react`, `zod` |
| Renderer | GPU-accelerated 2D (PixiJS v8 or custom WebGL2) behind a `Renderer` interface; SVG export from the scene graph |

**ADR-001** (`docs/decisions/001-bun-toolchain.md`) records: Bun is toolchain/server runtime; browsers are the product runtime; Vite stays for the UI (revisit if Bun's HTML bundler reaches parity); Biome + minimal ESLint split; pinned Bun version with deliberate upgrades.

### 3.2 Repository layout

**`spicekit`** (Bun workspaces)
```
spicekit/
  package.json  bun.lock  bunfig.toml  .bun-version
  tsconfig.base.json  tsconfig.json (project references)
  biome.json  eslint.config.js  .dependency-cruiser.cjs
  packages/
    protocol/   # @spicekit/protocol: types, zod schemas, PROTOCOL_VERSION   (runtime-agnostic)
    core/       # @spicekit/core: parser, IR, compiler, solvers, analyses     (runtime-agnostic, ZERO runtime deps)
    client/     # @spicekit/client: SimulatorClient + transports              (runtime-agnostic)
    server/     # @spicekit/server: Bun.serve WebSocket host                  (Bun-only)
    cli/        # @spicekit/cli: `spicekit` command                           (Bun-only)
    testing/    # private: builders, fixture loaders, tolerances, reference comparer
  fixtures/     # netlists + golden outputs (text only); fixtures/regressions/
  scripts/      # gen-golden.ts, check-size.ts, check-limits.ts, browser-suite.ts, bench.ts, doctor.ts
  docs/         # spec/SPEC.md, decisions/, progress.md, embedding.md, ...
```

**`circuit-studio`**
```
circuit-studio/
  package.json  bun.lock  bunfig.toml  .bun-version
  tsconfig*.json  biome.json  eslint.config.js  vite.config.ts
  src/
    app/          # shell, routing, theming, docking
    editor/       # canvas, tools (state machines), selection, wiring, undo/redo, renderer
    library/      # component/symbol definitions (JSON) + validator
    netlist/      # schematic graph -> Circuit IR extraction, ERC
    sim/          # ONLY module importing @spicekit/client; run controller, result store
    instruments/  # scope, function generator, multimeter, spectrum, bode, curve tracer...
    dashboard/    # layouts, widgets, cursors, measurements
    persistence/  # project save/load, IndexedDB, import/export
    ui/           # design-system components
  e2e/            # Playwright
  scripts/  docs/
```

### 3.3 Bun project configuration
`package.json` (root, illustrative; the agent must verify and simplify at scaffold time):
```jsonc
{
  "name": "spicekit", "private": true, "type": "module",
  "packageManager": "bun@<pinned>", "engines": { "bun": ">=<pinned>" },
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "bun run --filter '*' build",
    "typecheck": "tsc -b",
    "lint": "biome check . && eslint .",
    "format": "biome format --write .",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "test:reference": "bun test packages/core/test/reference",
    "test:conformance": "bun test packages/client/test/conformance",
    "test:browser": "bun run scripts/browser-suite.ts",
    "bench": "bun run scripts/bench.ts",
    "check:deps": "depcruise packages --config .dependency-cruiser.cjs",
    "check:size": "bun run scripts/check-size.ts",
    "check": "bun run lint && bun run typecheck && bun run check:deps && bun run test:coverage && bun run check:size",
    "doctor": "bun run scripts/doctor.ts"
  }
}
```
`bunfig.toml` (illustrative):
```toml
[install]
exact = true
[test]
coverage = true
coverageReporter = ["text", "lcov"]
coverageThreshold = { line = 0.9, function = 0.9, statement = 0.9 }  # per-package overrides
coverageSkipTestFiles = true
# UI packages add: preload = ["./test-setup.ts"] (happy-dom). Engine packages never load a DOM.
```
If Bun cannot enforce **branch** coverage thresholds, a small script parses the lcov output and enforces them.

### 3.4 Version and install hygiene
- Pin Bun exactly (`.bun-version` and `packageManager`); CI reads it via `oven-sh/setup-bun`. Bun upgrades are separate PRs with the full suite green.
- `bun install --frozen-lockfile` in CI and Docker. Workspace **catalogs** for shared versions (typescript, zod, fast-check, react).
- Lifecycle scripts of dependencies are blocked by default; `trustedDependencies` stays empty unless an ADR justifies an entry. No `postinstall` scripts in our own packages.
- `bun audit`, license allow-list (MIT, Apache-2.0, BSD, ISC), CodeQL, and secret scanning in CI. Renovate/Dependabot grouped weekly.

### 3.5 TypeScript configuration
- Bun runs TypeScript but **does not type-check**; `tsc -b` is mandatory in CI and pre-push.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `module: "Preserve"` (or `ESNext`), `moduleResolution: "bundler"`, `target: "ES2022"`, `composite: true` with project references.
- `@types/bun` only in `server`, `cli`, `scripts`, and test setup. `core`, `protocol`, `client`, and UI use `"types": []` plus explicit DOM/WebWorker libs only where needed.
- Named exports only. One import-extension policy and no path aliases unless Bun, Vite, and `tsc` are verified to agree (ADR).

### 3.6 Build and packaging
- **Libraries:** `bun build ./src/index.ts --outdir dist --target browser --format esm --sourcemap=external --minify-syntax` (no identifier minification for readable stack traces) + `tsc --emitDeclarationOnly`. `package.json`: `"type": "module"`, `"sideEffects": false`, explicit `"exports"` (types first), `"files": ["dist"]`. Optional `"source"` condition for fast in-monorepo dev; published builds never depend on it.
- **Public API snapshot** via `@microsoft/api-extractor`; `publint` and `@arethetypeswrong/cli` against the packed tarball; install the tarball in a scratch project and run the embedding example under Bun, Node, and a browser bundle.
- **UI:** `bun --bun run vite build`; static output, hashed assets, service worker with safe-update flow, CSP-compatible. Engine worker bundled via Vite worker support.
- **Server/CLI:** see section 7. **Docker** and executables built in CI.

---

## 4. Protocol (`@spicekit/protocol`)

### 4.1 Circuit IR (canonical JSON; single source of truth between UI and engine)
SPICE text parses into the IR; the IR serializes back to SPICE.

```ts
export type NodeId = string; // "0" is ground; names case-insensitive on SPICE import

export interface Circuit {
  title: string;
  elements: Element[];
  models: Record<string, ModelCard>;
  subcircuits: Record<string, Subcircuit>;
  params: Record<string, number | string>;
  options: SimOptions;
  analyses: AnalysisRequest[];
  probes: ProbeSpec[];
  sourceMap?: Record<string, string>; // element/node name -> UI component id (for error pinning)
}

export type Element =
  | { type: 'R'; name: string; n: [NodeId, NodeId]; value: Expr; tc1?: number; tc2?: number }
  | { type: 'C'; name: string; n: [NodeId, NodeId]; value: Expr; ic?: number }
  | { type: 'L'; name: string; n: [NodeId, NodeId]; value: Expr; ic?: number }
  | { type: 'K'; name: string; inductors: [string, string]; coupling: Expr }
  | { type: 'V'; name: string; n: [NodeId, NodeId]; dc?: Expr; ac?: { mag: number; phase?: number }; wave?: Waveform }
  | { type: 'I'; name: string; n: [NodeId, NodeId]; dc?: Expr; ac?: { mag: number; phase?: number }; wave?: Waveform }
  | { type: 'E' | 'G' | 'F' | 'H'; name: string; [k: string]: unknown }          // dependent sources
  | { type: 'B'; name: string; n: [NodeId, NodeId]; kind: 'V' | 'I'; expr: string } // behavioral
  | { type: 'D'; name: string; n: [NodeId, NodeId]; model: string; area?: number }
  | { type: 'Q'; name: string; n: [NodeId, NodeId, NodeId]; model: string; area?: number }
  | { type: 'M'; name: string; n: [NodeId, NodeId, NodeId, NodeId]; model: string; w?: Expr; l?: Expr }
  | { type: 'J'; name: string; n: [NodeId, NodeId, NodeId]; model: string; area?: number }
  | { type: 'S'; name: string; n: [NodeId, NodeId]; ctrl: [NodeId, NodeId] | { element: string }; model: string }
  | { type: 'X'; name: string; n: NodeId[]; subckt: string; params?: Record<string, Expr> };

export type Waveform =
  | { kind: 'SIN'; offset: Expr; amp: Expr; freq: Expr; delay?: Expr; damping?: Expr; phase?: Expr }
  | { kind: 'PULSE'; v1: Expr; v2: Expr; delay: Expr; rise: Expr; fall: Expr; width: Expr; period: Expr }
  | { kind: 'PWL'; points: [number, number][]; repeat?: boolean }
  | { kind: 'EXP' | 'SFFM' | 'AM'; [k: string]: unknown }
  | { kind: 'TRIANGLE' | 'SAWTOOTH' | 'SQUARE'; [k: string]: unknown } // compiled to PWL/PULSE
  | { kind: 'NOISE'; rms: Expr; bandwidth?: Expr; seed?: number }
  | { kind: 'EXTERNAL'; channel: string };                           // live values from the host (4.4)
```
`Expr` is a number or a string expression (`"{Rload*2}"`) evaluated by the engine.

### 4.2 Analyses
```ts
export type AnalysisRequest =
  | { kind: 'op' }
  | { kind: 'dc'; source: string; start: number; stop: number; step: number; second?: DcSweep }
  | { kind: 'ac'; sweep: 'dec' | 'oct' | 'lin'; points: number; fstart: number; fstop: number }
  | { kind: 'tran'; tstep: number; tstop: number; tstart?: number; tmax?: number; uic?: boolean }
  | { kind: 'noise'; output: string; source: string; sweep: 'dec' | 'oct' | 'lin'; points: number; fstart: number; fstop: number }
  | { kind: 'tf'; output: string; source: string };
```

### 4.3 Messages (client ⇄ engine)
Every request carries an `id`; every response references it.

| Direction | Message | Purpose |
|---|---|---|
| C→E | `hello {protocol}` / E→C `ready {engineVersion, capabilities, limits}` | handshake and capability negotiation |
| C→E | `loadCircuit {circuit}` / `loadSpice {text}` | validate and compile; returns node/branch tables and warnings |
| C→E | `run {analysis, stream?}` | start analysis; returns `runId` |
| C→E | `control {runId, op: 'pause'\|'resume'\|'stop'\|'step'}` | run control |
| C→E | `setParam {runId, target, value}` | live parameter change (4.4) |
| C→E | `setExternal {runId, channel, samples\|value}` | feed EXTERNAL waveform values |
| C→E | `evaluate {expr, context}` | expression evaluation (math channels) |
| E→C | `progress {runId, fraction, simTime}` | |
| E→C | `data {runId, signals, tStart, chunk}` | chunked results (transferable typed arrays) |
| E→C | `done {runId, stats}` / `error {code, message, location?}` | |
| C→E | `exportSpice {}` / E→C `spice {text}` | IR → netlist text |

Stable error codes: `E_PARSE`, `E_SINGULAR_MATRIX`, `E_NO_CONVERGENCE`, `E_FLOATING_NODE`, `E_VSOURCE_LOOP`, `E_UNKNOWN_MODEL`, `E_TIMESTEP_TOO_SMALL`, `E_LIMIT_EXCEEDED`, `E_PROTOCOL_VERSION`, ... Each includes `elementName`/`node`/`line` so the UI can highlight the culprit on the schematic.

### 4.4 Interactive (live) transient mode
- `run` with `{ kind: 'tran', tstop: Infinity }` and `stream: { mode: 'live', realtimeFactor: 1 }` runs continuously in chunks (≈ 16–33 ms of wall time each).
- Full circuit state persists between chunks. `setParam` (R/C/L value, potentiometer wiper, switch state, source amplitude/frequency/offset) takes effect at the next accepted timestep; the integrator restarts safely (order reset, breakpoint inserted).
- **Phase continuity:** changing a source frequency accumulates phase instead of recomputing `sin(2πf·t)`.
- **Backpressure:** if the UI lags, the engine lowers streaming decimation; memory never grows unbounded.

### 4.5 Protocol quality
- Versioned with semver; a public API snapshot test guards accidental breaks. Protocol reference docs are generated from the zod schemas.
- Unknown fields in the IR are preserved (extensibility). Capabilities and limits are advertised in `ready` so any GUI can adapt.

---

## 5. Engine (`@spicekit/core`)

### 5.1 Parser
- SPICE3-style netlists: element cards, continuation lines (`+`), comments (`*`, `;`), engineering suffixes (`f p n u m k meg g t`, case-insensitive, `mil`), `.param`, `.model`, `.subckt/.ends`, `.include` (via host-provided `IncludeResolver`; no filesystem in the browser), `.options`, analysis cards, `.print/.probe/.meas` (basic).
- Precise diagnostics (line, column, message). Round trip: `parse(serialize(ir))` equals the IR (property tested).

### 5.2 Compiler
- Flatten subcircuits (hierarchical names `X1.R3`), resolve params, assign node indices, allocate branch-current unknowns (V, L, E, H, K as needed).
- Pre-flight checks with typed, located errors: no ground, floating nodes, voltage-source/inductor loops, current-source cut-sets, unknown models.
- Output: compiled device arrays with node indices and resolved model parameters, plus a **sparsity pattern** computed once.

### 5.3 Modified Nodal Analysis
Unknowns = node voltages + branch currents. Uniform device interface:
```ts
interface Device {
  stampDC(ctx: StampContext): void;                  // linear + Newton-linearized stamps
  stampTran?(ctx: StampContext, h: number, method: IntegrationMethod): void;
  stampAC?(ctx: ACStampContext, omega: number): void;
  limit?(vNew: Float64Array, vOld: Float64Array): boolean; // junction limiting (pnjlim/fetlim)
  acceptStep?(ctx: StateContext): void;              // commit charge/flux state
  truncationError?(ctx: StateContext): number;       // adaptive stepping
}
```

### 5.4 Linear solver
- Stage 1: dense LU with partial pivoting (≲ 200 unknowns), thoroughly tested.
- Stage 2: sparse LU (Markowitz or AMD ordering, Gilbert-Peierls style) with **symbolic factorization reused** across Newton iterations and timesteps; numeric refactor only.
- Complex variant for AC (separate real/imag `Float64Array`s, no object-per-complex).
- Singular-matrix detection naming the likely offending node/element.
- Hot loops use preallocated typed arrays; **no allocation** in the Newton or timestep loops.

### 5.5 Analyses
- **OP:** Newton-Raphson (`reltol`, `vntol`, `abstol`), junction limiting, then the fallback ladder **gmin stepping → source stepping → pseudo-transient**. Report which method succeeded.
- **DC sweep:** up to two nested sweeps; previous solution as initial guess; continuation on failure.
- **AC:** linearize at OP, complex solve per frequency; magnitude/phase/real/imag. `.tf` gives small-signal gain, input and output resistance.
- **Transient:** backward Euler (startup, after breakpoints), trapezoidal (default), Gear-2 (selectable); **adaptive timestep** from local truncation error (`trtol`) with growth/shrink limits and `tmax`; **breakpoints** at source discontinuities, switch events, and UI parameter changes; mitigation of trapezoidal ringing on switching circuits (damped trapezoidal or BE fallback after events); initial conditions via `uic`, `.ic`, and element `ic`.
- **Noise:** thermal, shot, flicker for R/D/Q/M; output spectral density and integrated RMS.

### 5.6 Expression evaluator
- Used by `.param`, `{}` expressions, and behavioral sources (B), and exposed through the `evaluate` message for math channels.
- Operators `+ - * / ^ **`, comparisons, ternary; functions `sin cos tan asin acos atan atan2 sinh cosh tanh exp ln log log10 sqrt abs min max pow floor ceil int sgn limit u() uramp() table() if()`; constants `pi e q k T`; `time`, `v(n)`, `i(name)`.
- B-source derivatives by **forward-mode automatic differentiation** (dual numbers). Expressions compile to closures; **never** `eval` or `new Function`.

### 5.7 Device library (v1)
| Device | Model detail |
|---|---|
| R, C, L, K | Linear; temperature coefficients on R; mutual coupling |
| V, I | DC/AC + waveforms (5.8) + `EXTERNAL` live channel |
| E, G, F, H | Linear dependent sources |
| B | Behavioral V/I sources |
| D | Shockley, series R, junction/diffusion capacitance, breakdown (Zener), limiting; Schottky preset |
| Q (BJT) | Gummel-Poon (Ebers-Moll as simplification), NPN/PNP, junction caps, Early effect |
| M (MOSFET) | Level 1 (Shichman-Hodges) with Meyer capacitances, optional body diode, NMOS/PMOS |
| J (JFET) | Level 1 |
| S / W | Voltage/current-controlled switches with hysteresis, smooth-transition option |
| Op-amp | Subcircuit macromodels: ideal, single-pole (GBW, slew, rails, Rout), generic presets |
| Misc | Transformer (via K), potentiometer (two Rs with wiper param), lossless transmission line (later) |

Ship `@spicekit/models` (or `packages/core/models`): 1N4148, 1N4007, BAT54, 2N2222, 2N3904, 2N3906, BC547, IRF540-like, 2N7000, ideal/generic op-amps, LEDs (red/green/blue), Zener series, 555-timer and regulator macromodels.

### 5.8 Waveform sources
SIN, PULSE, PWL, EXP, SFFM, AM, NOISE, EXTERNAL; TRIANGLE/SAWTOOTH/SQUARE compile to PWL/PULSE with correct breakpoints. Evaluation is allocation-free and phase-continuous when parameters change live.

### 5.9 Numerical options (`SimOptions`)
`reltol=1e-3, abstol=1e-12, vntol=1e-6, gmin=1e-12, itl1=100, itl4=10, trtol=7, method='trap', temp=27, tnom=27, maxStepRatio, seed`. Overridable per run. Changing defaults requires an ADR plus reference-suite results.

### 5.10 `core/math`
All transcendental functions used by devices and the evaluator go through one `core/math/` module (see section 14). Device code never calls `Math.exp` etc. directly.

### 5.11 Engine quality bar
- Analytical, ngspice-reference, conservation, convergence, determinism, and regression suites (section 13.2).
- **Performance targets** (enforced in a browser): ≥ 200k timesteps/s for a 100-node linear/mildly nonlinear circuit; no GC pause > 8 ms in live mode.
- Resource limits with typed `E_LIMIT_EXCEEDED` errors (section 16).

---

## 6. Client library (`@spicekit/client`)

```ts
export interface SimulatorClient {
  connect(): Promise<EngineInfo>;
  loadCircuit(c: Circuit): Promise<LoadResult>;       // node/branch tables, warnings
  loadSpice(text: string): Promise<LoadResult>;
  run(req: RunRequest): RunHandle;
  dispose(): void;
}
export interface RunHandle {
  readonly id: string;
  readonly signals: SignalInfo[];                      // name, unit, kind (v/i/p)
  onData(cb: (chunk: DataChunk) => void): Unsubscribe;
  onProgress(cb: (p: Progress) => void): Unsubscribe;
  pause(): void; resume(): void; stop(): void; step(): void;
  setParam(target: ParamTarget, value: number): void;
  setExternal(channel: string, v: number | Float64Array): void;
  done: Promise<RunStats>;                             // rejects with typed EngineError
}
```
- `createWorkerClient()`, `createWebSocketClient(url)`, `createInProcessClient()` all return `SimulatorClient`.
- Request/response correlation, timeouts, cancellation, structured errors, automatic WebSocket reconnect, and worker-crash detection (< 1 s) with restart are the client's job, not the UI's.
- Exports `runClientConformance(factory)` so every transport is tested identically.
- **Embedding guide** (`docs/embedding.md`): a 20-line example in plain JS, React, and Vue, plus the protocol reference for non-JS GUIs speaking WebSocket.
- **Compatibility policy:** minors add; majors may break with a migration guide; deprecations last at least two minors with runtime warnings.

---

## 7. Server and CLI (Bun-only packages)

### 7.1 `@spicekit/server`
- `Bun.serve` with native WebSocket: explicit `maxPayloadLength`, `backpressureLimit`, `idleTimeout`; per-connection concurrency and rate limits; origin allow-list; optional bearer token; `/healthz`, `/readyz`, and a Prometheus-format metrics endpoint (runs started/completed/failed, active connections, queue depth, timesteps/s, p95 run latency); graceful shutdown on `SIGTERM` (stop accepting, drain runs, close sockets).
- Each run executes in a **Bun `Worker`** (never on the server event loop); pool bounded by `navigator.hardwareConcurrency - 1`.
- Per-run wall-clock and sample limits; cancellation on socket close; backpressure-aware binary streaming (check send results and buffered amount; pause the run when the socket is saturated).
- Messages validated by zod; unknown or oversized messages close the connection with a defined code.
- Structured JSON logs behind `Logger` (request id, run id, no user data by default). Config from validated environment variables (zod), failing fast on invalid config. Optional OpenTelemetry hook, off by default.
- TLS terminated at a reverse proxy (sample Caddy/nginx config provided).

### 7.2 `@spicekit/cli`
- `#!/usr/bin/env bun` entry over the in-process transport: `spicekit run`, `check` (parse + pre-flight), `convert`, `serve`, and a `--json-lines` machine mode; output `csv|json|raw`.
- **Single-file executables** via `bun build --compile` for linux-x64/arm64, macOS, Windows; attached to GitHub releases with SHA-256 checksums and an SBOM; each artifact smoke-tested on its target OS in CI.

### 7.3 Docker
Multi-stage build on the official `oven/bun` image (pinned by digest); `bun install --frozen-lockfile --production` in the final stage; non-root user; read-only root filesystem; `HEALTHCHECK`; compiled-binary option for the smallest image; scanned (Trivy/Grype) in CI.

---

## 8. UI architecture and state

### 8.1 Stores (Zustand slices)
- `projectStore`: schematic document (undoable), metadata.
- `uiStore`: layout, selection, tool, theme, viewport.
- `simStore`: engine status, active run, run settings, errors.
- `resultStore`: signal registry + ring buffers per signal (Float32 for display, original Float64 retained on demand for measurements), decimation caches, run history (last N runs, default 5, for overlays/compare).

### 8.2 Data pipeline
`RunHandle.onData` → `resultStore.append` (typed-array ring buffer) → instruments subscribe via selectors throttled to animation frames. **React never re-renders per data chunk**; instruments read buffers imperatively in `requestAnimationFrame`.

### 8.3 Document, view model, commands
- The **document model** is the serializable source of truth; the **view model** and renderer derive from it.
- **Command bus:** every edit is a command with `do/undo`, grouped into transactions. Drags stream preview updates through an **interaction layer** (no document mutation) and commit **one** transaction on release.
- **Tool state machines** (XState or hand-rolled FSM): `Idle`, `Selecting`, `Dragging`, `Wiring`, `Placing`, `Panning`, `TextEditing`; each defines pointer/key handlers, overlays, and cursor; unit-testable without a DOM.
- **Incremental connectivity:** a connectivity graph updates per transaction (affected region only) and feeds ERC, net highlight, and netlist extraction.
- **Worker offload:** ERC, net extraction on large documents, and spatial-index rebuilds run in a worker when they exceed 4 ms.
- **Determinism:** snapping, routing, and auto-placement are pure functions of document + pointer state.
- **Plugin seams:** tools, symbol libraries, snap providers, and ERC rules register through typed registries.

### 8.4 Run bar and engine status
Always visible: Run / Pause / Stop / Single-step, simulated-time readout, speed control (×0.01 … ×10, "as fast as possible"), analysis selector, engine chip (worker/remote, version, load).

### 8.5 Batch and sweep runs
`runSweep(circuit, param, values[])` schedules runs sequentially or in a worker pool; each result set is tagged; plots overlay them; supports cancellation and progress.

---

## 9. Schematic editor

### 9.1 Rendering
- GPU-accelerated 2D renderer behind the `Renderer` interface; Canvas2D fallback; **SVG export** generated from the scene graph (vector, accurate), not from screen pixels.
- Layers (bottom to top): background grid, sheet frame/title block, wires, symbols, pin names/numbers, net labels, text/annotations, ERC markers, probes/live overlays, selection and tool overlays, cursor/snap indicator.
- Static layers cached as textures/batches and redrawn only when dirty; only the interaction layer redraws per frame during drags.
- Text via an MSDF atlas or cached glyph textures: crisp at any zoom. Device-pixel-ratio aware; hairline minimum 1 device pixel, user line-weight setting.
- **Spatial index:** R-tree (e.g. `rbush`) over symbols, wire segments, labels, and pins for hit-testing, rubber-band selection, snapping candidates, and viewport culling. Hit-test < 0.5 ms at 5,000 objects. Never iterate all objects on pointer move.
- **Coordinates:** integer "mils × 10" (0.1 mil resolution) to avoid float drift; display units mil/inch/mm. **Default grid 50 mil (1.27 mm)**, selectable 100/50/25/10/5 mil or off; pin connection ends are always on grid. Saved files hold integers; round trip is lossless.

### 9.2 Camera: pan and zoom
- Wheel zoom centered on the cursor; trackpad pinch; `Ctrl/Cmd +/-`; zoom-to-fit (`Home`), to selection (`Shift+2`), 100% (`Shift+1`).
- Pan: middle-drag, space+drag, two-finger scroll, edge-scroll during drags (accelerating, capped), with **inertia** (friction decay scaled by dt; stops instantly on click/key).
- Programmatic moves (zoom-to-fit, "go to ERC error", "go to net") animate with a critically damped spring or ease-out cubic, 220–320 ms, interruptible; `prefers-reduced-motion` jumps instead.
- Zoom range 5%–6400%, exponential wheel scaling.
- **Level of detail:** far = simplified shapes/labels; mid = reference/value and pin names; near = pin numbers and net names. Text never below 6 px on screen (fades out instead).
- Minimap (toggleable) with viewport rectangle. Camera persists per sheet.

### 9.3 Selection
- Click, `Shift`-click add/toggle, `Ctrl/Cmd`-click toggle, click empty clears.
- **Rubber band:** left-to-right = fully enclosed (solid blue); right-to-left = touching (dashed green); live highlight. Lasso (`L`).
- Select connected: `Alt+click` a wire selects the run; double-click selects the net.
- Selection filter popover (symbols, wires, labels, text).
- Visuals: crisp outline with subtle glow; handles only where useful; bounding box with rotate/mirror affordances for multi-selection.
- Hover highlights within one frame; hovered pin shows a pulsing connection dot and a tooltip (pin name, number, type, net). Info bar: "3 symbols, 5 wires selected — Δ x, y".

### 9.4 Drag and drop

**From library to canvas**
- A **ghost symbol** follows the cursor with ~1 frame latency, snapped to grid, semi-transparent with real pin dots; highlights any pin it would touch.
- Dropping on a wire offers **insertion** (wire split, part placed in line; for 2-pin parts with collinear pins). Setting `Auto-insert in wire: Off/Prompt/On` (default On for 2-pin parts).
- Click-to-place mode: ghost follows the cursor, click to place, stays armed, `Esc`/right-click exits; `R` rotates, `X`/`Y` mirror while armed.
- Overlapping pins of different symbols that would connect unintentionally show a warning marker.
- Dragging a SPICE model onto a transistor (or onto an inspector field) assigns it.

**Moving objects (KiCad semantics)**
- **Move (`M`)** and **Drag (`G`, or plain click-drag, configurable):** attached wires stay connected and **stretch**, re-routing orthogonally. **Detach** with `Ctrl`/`Alt`+drag: wires stay put and unconnected pins are flagged.
- Dragging a wire segment slides it perpendicular to its direction; neighbors stretch. Dragging a wire endpoint extends/re-routes; dragging a junction moves all its wire ends.
- Multi-selection moves as a rigid group including internal wires.

**Physical feel**
- Dragged objects track the cursor 1:1; the committed position snaps with a short eased transition (~60–90 ms) near grid points (setting `Smooth drag`; off = pure snap). Release settles with a subtle ≤ 90 ms pulse (none in reduced-motion).
- Auto-pan near viewport edges. `Esc` cancels with a quick ease and no undo entry.
- `requestAnimationFrame`-coalesced updates and **pointer capture** so drags never get lost over panels.

**Snapping and alignment (priority order)**
1. Pin ends (strong, radius 8 px screen-space). 2. Wire segments and junctions (6 px). 3. Alignment guides (edges/centers/pin axes; thin magenta lines with distance tags, Figma-style). 4. Grid baseline.
- `Alt` disables snapping temporarily; `Ctrl+Alt` snaps to grid only. A snap indicator ring plus a tiny tag ("pin R1.2", "grid"). Snapping is deterministic and tested.

**Copy, paste, duplicate**
- Paste preserves internal connectivity; a ghost attaches to the cursor; reference designators auto-increment (R4 → R5), values preserved. `Ctrl+D` duplicate with configurable offset; **array paste** (`Ctrl+Shift+V`). Works across sheets. Clipboard format is documented JSON (also accepts SPICE netlist text).

### 9.5 Wiring (the core of "nice schematics")

**Starting and finishing**
- Drag from a pin, or `W` tool: click to start, click for corners, double-click or click a pin/wire to finish, `Esc` cancels. Start from a pin, wire end, point on a wire (creates a junction), or empty space. Ends auto-complete on pins, wires, or labels. Live preview shows the exact path to be committed.

**Routing modes** (`Shift+Space` cycles)
- **90° orthogonal (default)**: L-shaped route; `Space` flips corner choice. **45°/135°**. **Free angle**.
- Rules (orthogonal): minimize bends; prefer straight lines; avoid symbol bodies and foreign pins (obstacles from the spatial index), detouring when a clean path exists within N segments, else draw straight and flag; never touch a foreign pin without connecting; crossing wires does **not** connect.
- Optional **auto-route assist** (`Ctrl+click` target pin): A* orthogonal route on the grid with bend and clearance penalties.

**Connectivity semantics (exact; mirrors KiCad)**
- Wires connect only at **endpoints touching** or at an explicit **junction**. A wire passing another's middle does not connect.
- A wire end landing on another wire's interior **auto-creates a junction** (target wire split logically). Four-way crossings never auto-connect.
- Junctions render as filled dots (≈ 3× line width) and are removed automatically when they no longer connect ≥ 3 wire ends.
- Overlapping collinear segments are **merged**, zero-length wires removed, redundant collinear points collapsed. This **normalization runs after every edit**, is idempotent, and is property-tested.
- **No-connect flags** (X) on deliberately open pins. **Net highlighting** (click a wire or `` ` ``) highlights the whole net across sheets.

**Wire and net visuals**
- Default line weight ~6 mil, scalable; consistent end caps; sharp or slightly rounded joins. Optional **hop-overs** (off by default). Optional per-net coloring and "color by net class" (power, ground, signal, clock).
- **Buses** (thicker wires, bus entries, named members `D[0..7]`) in the data model and rendering; expanded to individual nets at netlist extraction.
- Live-mode overlay (toggle): current-flow animation along wires and voltage-based coloring (blue→red); GPU/shader-driven, not per-wire JS.

**Labels, power, ground**
- Local, global, hierarchical labels and power ports (`VCC`, `GND`, `+5V`, `-12V`); name auto-complete from existing nets; labels snap to wires, rotate to stay readable, and slide along wires. Conflicting names on one net raise an ERC warning.

### 9.6 Symbols and component library

**Style**
- **ANSI/IEEE** (zigzag resistor) and **IEC 60617** (rectangle) sets, switchable per project; default by locale. Hand-tuned, beautiful symbols for common parts (R, C, L, D, Q, op-amp, gates); one consistent design language.
- KiCad-like geometry: bodies on the 100/50 mil grid, pins 100 mil long, pin names inside, pin numbers outside, optional fills (none/background/outline).
- Reference designator and value placed sensibly (never over the body), independently draggable, auto-flipping to stay left-to-right readable on rotation.
- Pin visuals: inverted-circle (active low), clock wedge, direction arrows; electrical types (input, output, bidirectional, power in/out, passive, open collector, no-connect) stored and used by ERC.
- Multi-unit symbols (e.g. quad op-amp: units A–D + power unit), alternate body styles, hidden power pins.

**Symbol format**
```ts
interface SymbolDef {
  id: string; name: string;
  standards: { ansi: SymbolGraphics; iec?: SymbolGraphics };   // iec falls back to ansi
  units: SymbolUnit[];                                         // >= 1
  pins: PinDef[];                                              // pos, orientation, length, name, number, electricalType, hidden?
  fields: FieldDef[];                                          // Reference, Value, Footprint?, SpiceModel, ...
  properties: PropDef[];                                       // value, model, w/l, ic, tolerance, ...
  spice: { prefix: string; pinOrder: string[]; template?: string };
  keywords: string[];
  interactive?: { kind: 'switch'|'pot'|'button'|'led'; [k: string]: unknown };
  defaultProps: Record<string, unknown>;
}
```
- A **symbol validator** runs in CI over the whole library: pins on grid, no duplicate pin numbers per unit, graphics within bounds, fields present, SPICE mapping complete.
- Library contents: R, C (polarized and not), L, potentiometer, transformer, V/I/AC sources, **function-generator source**, battery, ground, diode/LED/Zener/Schottky, NPN/PNP, NMOS/PMOS, JFET, op-amp, comparator (behavioral), switches, SPDT, fuse, relay, logic gates (behavioral analog), 555 timer, voltage regulator, subcircuit block, net label, text, probe. Target ≥ 60 symbols.
- **Library UX:** search-as-you-type (name, keywords, value), category tree, favorites and recents, preview card with pin table and SPICE mapping; drag preview is the real symbol; quick-add popup (`A`) at the cursor with fuzzy search. A visual **symbol editor** is a stretch goal.

### 9.7 Interactive components
Switches, push-buttons, potentiometers (knob/slider on canvas), jumpers, and LEDs (glow proportional to current) respond in live mode through `setParam`.

### 9.8 Netlist extraction
- Schematic graph → **union-find** nets → `Circuit` IR. Deterministic net names (`net_<n>` or user label); ground is `0`.
- Incremental: cached IR recomputed only when connectivity or properties change. Emits `sourceMap` so engine errors map back to UI ids. This is the **single source** of connectivity for ERC, net highlight, and export.

### 9.9 ERC (live and on demand)
Unconnected pins, pin-type conflicts (output-to-output, power-output-to-power-output), missing ground, floating nets, duplicate references, undriven nets, unconnected labels, label-name conflicts, dangling wires, overlapping pins without connection, voltage-source loops (also from the engine). Each result has severity, message, location, and **"Zoom to"**; non-modal panel plus canvas markers; ignorable per instance with a reason. Engine errors are mapped back via `sourceMap` and the plain-language explanation includes a suggested fix (e.g. "Node N3 has no DC path to ground — add a resistor to ground or check wiring").

### 9.10 Commands and shortcuts
A command palette (`Ctrl/Cmd+K`) lists every command with its shortcut.

| Action | Shortcut |
|---|---|
| Add symbol (quick search) | `A` |
| Wire / net label / power port | `W` / `L` / `P` |
| Junction / no-connect | `J` / `Q` |
| Text / note | `T` |
| Move / Drag | `M` / `G` |
| Rotate / Mirror X / Mirror Y | `R` / `X` / `Y` |
| Edit properties / value / reference | `E` / `V` / `U` |
| Delete | `Del` / `Backspace` |
| Duplicate | `Ctrl+D` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Zoom fit / selection / 100% | `Home` / `Shift+2` / `Shift+1` |
| Toggle grid / snap | `Ctrl+G` / `Ctrl+Shift+G` |
| Cycle routing mode | `Shift+Space` |
| Highlight net | `` ` `` |
| Run / Stop simulation | `F5` / `Shift+F5` |
| Cancel | `Esc` |

Shortcuts are remappable with conflict detection; presets: Default, KiCad, Figma-style. **Cleanup commands:** align (left/center/right/top/middle/bottom), distribute, tidy wires, auto-annotate (reading order), snap all to grid. Context menus show only relevant actions; a **mini floating toolbar** (rotate, mirror, delete, edit value) appears near the selection after a short delay and never obstructs a drag.

### 9.11 In-canvas property editing
- Double-click a value to edit in place with engineering-notation parsing (`4.7k`, `100n`, `1meg`), unit display, and an error shake on invalid input.
- Hover tooltip: reference, value, model, pin count, live OP values.
- **Value scrubbing:** hold `Alt` and drag horizontally on a numeric value to change it continuously (log scale for R/C/L), with live response in live mode; release commits one coalesced undo step.
- Inspector panel mirrors selection properties (multi-edit for same type); tolerance (display only in v1); reference designators auto-numbered with rename.
- **Live annotations:** after a run, voltage badges at pins and branch currents on symbols (toggle), with simple collision-avoiding placement, dimmed when overlapping.
- **Probes:** drag voltage/current probes onto nets/pins; each gets a color and automatically shows as a scope trace.

### 9.12 Visual design
- Modern, calm, high-contrast **dark** theme (default), **light** theme, and a **Paper** theme (white, black lines, classic colors) for export/print preview. Accent color picker; high-contrast mode.
- Canvas background near-black blue-gray with a subtle dot grid (scales/fades with zoom; major grid every 5th/10th line).
- **Color tokens:** wire, wire-selected, wire-highlighted-net, symbol-body, symbol-fill, pin, pin-hover, junction, label, power-net, ground-net, error, warning, guide, selection, ghost; all themeable and WCAG-contrast-checked.
- Typography: clean sans for UI, mono for numeric readouts, a monoline technical font for schematic text with consistent baselines.
- **Motion system:** durations 80/160/240 ms, `cubic-bezier(.2,.8,.2,1)`, springs for the camera; all disabled under `prefers-reduced-motion`.
- Context cursors (crosshair for wire tool, grab for pan, move, resize) with a small tool badge; small-cross or full-screen-cross option.
- Design tokens are CSS variables with a documented design system (spacing, radii, elevation, color scales).

### 9.13 Sheets, hierarchy, presentation
- Sheet border, title block (title, revision, date, author, company, sheet N of M), paper sizes A4–A0, Letter–E, custom, landscape/portrait, zone coordinates.
- **Hierarchical sheets:** sheet-symbol blocks with sheet pins, navigate in/out by double-click and breadcrumb; flat and hierarchical net naming identical to KiCad. Group-to-subcircuit collapses a selection to a block symbol.
- **Presentation mode:** hides chrome, large clean rendering, laser-pointer and net highlight for teaching.
- Export: PDF (vector), SVG, PNG with transparent option, Paper theme, page-fit, BOM CSV.

---

## 10. Instruments and dashboard

### 10.1 Layout system
Dockable, resizable, tabbed panels (schematic, scope, generators, meters, plots, netlist, console, library). Presets: *Build*, *Debug*, *Present*; layouts persist per project. Users can build a custom dashboard by dragging **widgets** onto a grid: big-number tile, gauge, bar, sparkline, LED indicator, each bound to any signal.

### 10.2 Oscilloscope
- Up to 8 channels from any signal (node voltage, branch current, math channel); per-channel color, V/div, offset, coupling (DC/AC/GND), invert, optional bandwidth limit, probe attenuation.
- Timebase (s/div), position, **trigger** (rising/falling/either, level, source, Auto/Normal/Single, holdoff), roll mode for live streaming.
- **Cursors** (X1/X2/Y1/Y2 with Δ), automatic measurements (Vpp, Vmax/min, Vrms, mean, freq, period, duty, rise/fall time, overshoot) in a measurement table.
- **Math channels:** A±B, A×B, FFT, integrate, differentiate, custom expression (via `evaluate`).
- X-Y (Lissajous), persistence/phosphor mode, zoom/pan with min/max decimation (envelope), export PNG/CSV.
- Performance: ≥ 60 FPS with 4 channels × 100k visible-decimated points; decimation (LTTB or min/max) in a worker.

### 10.3 Function generator (component and panel)
The panel edits the same properties as the inspector, live.
- Waveforms: sine, square, triangle, sawtooth (ramp up/down), pulse, noise (white/pink), DC, **arbitrary** (draw/CSV/formula), sweep (linear/log chirp), burst (N cycles), AM/FM modulation.
- Parameters: frequency (decade knob/stepper and typed entry), amplitude (Vpp/Vrms toggle), DC offset, duty cycle, phase, symmetry, rise/fall time, output impedance (50 Ω/Hi-Z modeled as series R), output enable.
- Engine mapping: static runs map to `SIN`/`PULSE`/`PWL`; live runs use `EXTERNAL`/`setParam`, preserving phase continuity (4.4). Multiple generators allowed; each is a named source.
- Visual: skeuomorphic-lite front panel (knobs, 7-segment-style readout, waveform preview thumbnail), fully keyboard and screen-reader accessible.

### 10.4 Other instruments
- **Multimeter:** DC V, AC V (RMS), DC/AC current, resistance (via small test current in OP), frequency; auto-ranging.
- **Power meter/energy:** instantaneous/average power for a component and cumulative energy.
- **Bode plotter:** magnitude/phase vs frequency with cursor, −3 dB marker, gain/phase margin, crossover frequencies.
- **Spectrum analyzer:** windowed FFT (Hann/Hamming/Blackman/flat-top), THD/SNR/SINAD, dBV/dBu/linear scales.
- **Curve tracer / DC sweep plotter:** diode IV, transistor families, with parameter stepping.
- **Logic analyzer view:** threshold digital traces with bus grouping.
- **Data table:** tabular view with search and CSV export. **Parameter sweep tool:** step a value over a list/range and overlay results.
- **Console:** engine log, warnings, convergence info (method used, iterations, timestep stats).

---

## 11. Persistence, import and export

- **Project file** `.cstudio.json`: versioned with migrations from every released version; holds schematic, component props, instrument layout/settings, optional cached results. Save → load → save is **byte-identical**.
- **Autosave** to IndexedDB every few seconds with versioned snapshots (last 20), recovery after a crash; unsaved-changes warning; explicit save/open via File System Access API with download fallback.
- **Import:** SPICE netlist (`.cir`, `.sp`, `.net`) → IR → **auto-generated schematic layout** (force-directed or layered; best-effort, limitations documented). **Export:** SPICE netlist, SVG/PNG/PDF schematic, CSV waveforms, BOM CSV.
- Optional shareable link: compressed project JSON in the URL hash for small circuits (safe decoding with size limits).
- Offline-capable **PWA** (service worker with safe update flow: "New version available — reload"); example gallery loads offline.

---

## 12. Code standards

### 12.1 TypeScript rules
- No `any` (lint-enforced); use `unknown` and narrow. `as` casts need a justifying comment; `@ts-expect-error` (never `@ts-ignore`) needs a reason and an issue link.
- Branded types for ids and units (`NodeIndex`, `BranchIndex`, `ElementName`, `ComponentId`, `NetId`, `Mils`, `Pixels`). Exhaustive `switch` ending in `assertNever`.
- Named exports only; no default exports; internal modules not importable from outside a package (deliberate `index.ts`).

### 12.2 Structure and size limits (enforced)
| Rule | Limit |
|---|---|
| File length | ≤ 300 lines soft, 500 hard |
| Function length | ≤ 50 lines soft, 80 hard |
| Cyclomatic complexity | ≤ 10 (hard at 15) |
| Parameters | ≤ 4 (else options object) |
| Nesting depth | ≤ 3 |
| Circular dependencies | 0 |

Exceptions use `// biome-ignore` / `eslint-disable-next-line <rule> -- <reason>` and are reviewed. Enforced by Biome rules where available, else `scripts/check-limits.ts`.

### 12.3 Naming, comments, style
Files `kebab-case.ts`; types `PascalCase`; functions/variables `camelCase`; true constants `SCREAMING_SNAKE_CASE`. Names say what, not how (`solveNewton`); booleans read as questions (`isConverged`); units in names (`timeoutMs`, `freqHz`, `widthMils`). Comments explain *why* (numerical rationale, standards, trade-offs) and cite sources for numerical routines. Biome owns formatting; ESLint owns type-aware rules only (`no-floating-promises`, `no-misused-promises`, `no-unsafe-*`, `switch-exhaustiveness-check`, `consistent-type-imports`, `restrict-template-expressions`, `react-hooks`, `jsx-a11y`). No rule is configured in both tools.

### 12.4 Architecture rules
- **Layering (dependency-cruiser):** `spicekit`: `protocol` ← `core` ← `client` ← `server`/`cli`; `core` never imports `client`; nothing imports `cli` or `server`. `circuit-studio`: `editor`, `netlist`, `instruments` may import `ui`, `library`, shared types, never each other's internals; **only `sim` imports `@spicekit/client`**.
- **Zero runtime dependencies in `@spicekit/core`**; every other new dependency needs an ADR (size, license, maintenance, alternatives).
- **No global mutable state.** Inject `Clock`, `Rng` (seeded), `Logger`, `IncludeResolver`, `Transport`.
- **Errors:** hierarchy rooted at `EngineError`/`AppError` with stable `code`; expected failures return `Result<T, E>`; throw only for programmer errors and unrecoverable conditions; no swallowed exceptions (`catch` logs with context or rethrows).
- **Immutability by default** in UI/document code (Immer); engine hot loops mutate preallocated typed arrays inside clearly marked modules (`core/linalg`, `core/stamp`, `editor/render`) with benchmarks.
- `knip` in CI keeps exports and dependencies honest.

### 12.5 Documentation in code
TSDoc on every export (what, params, returns, throws, example when non-trivial). Each package has `README.md` and `ARCHITECTURE.md` (module map, data flow, invariants). **ADRs** in `docs/decisions/NNN-title.md` for every significant decision (context, options, decision, consequences). API reference via TypeDoc; protocol reference generated from zod.

### 12.6 Version control and review
- Trunk-based, short-lived branches; `main` always releasable; protected branches with required checks, linear history.
- **Conventional Commits** (`feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`; `!` and `BREAKING CHANGE:` for breaks), enforced by commitlint. One logical change per PR (target < 400 changed lines excluding generated files/fixtures). PR template: what/why, test evidence, screenshots/GIFs for UI, perf impact, docs updated, protocol version impact.
- Hooks via `lefthook` or `husky`: pre-commit Biome on staged files, `tsc -b` for affected projects, commitlint; pre-push tests for affected packages. CI is the authority.
- **PR review checklist:** one thing, small enough? Precise types? Tests for happy/edge/failure paths that fail if the feature breaks? Typed, located, helpful errors? Allocations or O(n²) in hot paths (benchmark attached)? Boundaries respected, no unapproved dependency? Public API/protocol change with version, docs, migration, API snapshot? UI: screenshots, keyboard path, a11y, reduced motion, three themes? Docs and changeset? Any data-loss or UI-hang risk and failure behavior?

---

## 13. Testing strategy

### 13.1 Pyramid and targets
| Layer | Tool | Scope | Target |
|---|---|---|---|
| Unit | `bun test` | pure functions, devices, parser, router, snapping, ERC | **≥ 90% line / 85% branch** in `core`, `protocol`, `netlist`, geometry; ≥ 80% elsewhere |
| Property-based | fast-check | invariants (13.3) | every parser, serializer, normalizer, solver |
| Integration | `bun test` | engine via in-process transport; store + netlist + client | all analyses, all transports |
| UI component | `bun test` + happy-dom + Testing Library | panels, inspector, instruments | every instrument and dialog |
| E2E | Playwright (production build) | real browser flows | all gallery circuits + journeys |
| Visual regression | Playwright screenshots | symbols, instruments, themes, reference schematics | reviewed diffs |
| Performance | mitata + Playwright traces | budgets (section 17) | regression thresholds |
| Accessibility | axe-core + manual script | all screens | zero serious/critical |
| Security | CodeQL, `bun audit`, fuzzing | parser, protocol, import paths | zero high/critical |

Coverage thresholds are CI-enforced floors; reviewers also check test *quality*. Conventions: tests next to code (`foo.ts` + `foo.test.ts`), `test/` for integration/reference/conformance; `bun:test` imports only in test files; Arrange-Act-Assert; one behavior per test; descriptive names; shared builders (`circuit().r("R1","1","0","1k")`); randomized order in CI; no sleeps; seeded randomness; injected `Clock`; snapshots only for stable human-reviewed text artifacts (SPICE, SVG). A test that flakes twice in a week is fixed or quarantined with an issue within 48 hours. Canvas/WebGL behavior is tested through pure functions, state machines, and Playwright, not happy-dom.

### 13.2 Engine numerical verification
1. **Analytical suite:** voltage dividers, RC/RL/RLC step and sine response, LC resonance, RC Bode, diode IV vs Shockley, rectifier ripple, BJT bias, CMOS inverter VTC, op-amp ideal gain; stated, justified tolerances.
2. **ngspice reference suite:** ≥ 150 fixture netlists with golden outputs from ngspice (`scripts/gen-golden.ts`; ngspice version recorded; CI does not need ngspice). OP/DC/AC relative error ≤ 1e-3 (abs floor 1e-9); transient RMS error ≤ 0.5% of signal range on smooth circuits; event-time error ≤ 1 timestep on switching circuits.
3. **Conservation:** KCL residual < `abstol` at converged OP; energy balance on lossless LC and switched-capacitor circuits; charge conservation across switching.
4. **Convergence stress set:** Schmitt trigger, astable multivibrator, ring oscillator (must oscillate), buck/boost converters, diode bridges with large caps, high-gain op-amp circuits, latches; each documents expected behavior and which fallback succeeded.
5. **Determinism:** same seed and options give identical results **within one runtime**; across runtimes within tolerance (section 14).
6. **Regression corpus:** every bug adds a minimal netlist to `fixtures/regressions/` named after the issue.

### 13.3 Property-based invariants
- Parser/serializer round trip; stable after one normalization. Engineering-suffix format/parse round trip across 1e-15…1e12.
- Engine: random passive networks satisfy KCL/KVL; scaling resistances and sources preserves ratios; reordering elements doesn't change results beyond tolerance.
- Editor: any sequence of move/rotate/mirror/drag/undo/redo preserves connectivity unless a connection-changing command ran; wire normalization idempotent; save→load→save byte-identical; spatial index equals brute force; snapping and routing are pure.
- Protocol: random valid messages round-trip through zod and every transport; random invalid messages are rejected with typed errors and never crash the engine.

### 13.4 Fuzzing and robustness
Fuzz the SPICE parser, project loader, and protocol decoder (fixed budget in CI, longer nightly). Resource-limit tests (huge node counts, absurd timesteps, pathological expressions) produce clean errors, never hangs. **Chaos tests** for transports: dropped worker, killed server, slow consumer, out-of-order messages, duplicate ids.

### 13.5 E2E golden journeys (must stay green, in Chromium, Firefox, WebKit)
1. Build an RC low-pass from the palette, run transient, assert the capacitor voltage reaches 63.2% at τ (±2%).
2. Place and bias a BJT amplifier, run AC, assert midband gain within tolerance.
3. Function generator live: change frequency mid-run, assert phase continuity (no discontinuity above threshold) in scope data.
4. Toggle a switch and turn a potentiometer live; waveform responds within 200 ms.
5. Import a SPICE netlist; verify schematic and a successful run.
6. Save, reload, verify identical state; recover from autosave after a simulated crash.
7. Trigger and fix an ERC error; an engine error highlights the right component.
8. Export SPICE, SVG, PDF, CSV; validate each artifact.
9. Keyboard-only construction of a circuit.
10. Offline mode: load, build, simulate with the network disabled.

Interaction e2e also covers: palette drag, drop onto wire (auto-insert), move with stretching wires, `Ctrl`-drag detach, rubber-band directions, wire tool with `Space` corner flip, 45° mode, net highlight, value scrubbing in live mode, paste with auto-increment, hierarchical navigation. All 26 gallery circuits run in CI with at least one numeric assertion each.

### 13.6 Visual regression and UX testing
Screenshots of every symbol (ANSI and IEC; light/dark/Paper; 100% and 400% zoom), instruments, and 20 reference schematics (PNG/SVG diffs). `docs/ux-test-script.md`: five timed tasks (build an RC low-pass, place and wire a BJT stage, tidy a messy schematic, find and fix an ERC error, export PDF); a first-time user completes task 1 in < 3 minutes without help.

### 13.7 Mutation testing and benchmarks
- **Mutation testing** nightly on `core/parser`, `core/linalg`, `netlist`, `editor/geometry` (target ≥ 70% score); Stryker via its command runner invoking `bun test` if no direct integration exists.
- **Benchmarks:** `mitata` for `linalg`, stamping, Newton step, evaluator, parser, spatial index, snapping, router, normalization; baselines in `bench/baseline.json`; CI fails at > 10% regression (warns at 5%). **Allocation guard:** steady-state heap growth ≈ 0 across N iterations in hot loops. Browser benchmarks (worker timesteps/s, UI frame times) run in headless Chromium with CPU-throttling profiles; these are the numbers compared to budgets.

### 13.8 Where each engine suite runs
| Suite | `bun test` (JSC) | Real browsers (V8/Gecko/WebKit) | Node (smoke) |
|---|---|---|---|
| Unit + property | yes | subset via browser harness | no |
| Analytical | yes | **yes** | smoke |
| ngspice reference | yes | **yes** | no |
| Client conformance | in-process + WebSocket against real `Bun.serve` | **worker transport in browsers** | no |
| Embedding example (packed tarball) | yes | yes | yes |

The browser harness (`scripts/browser-suite.ts`) bundles test entry points with `bun build`, serves them with a Bun static server, drives Playwright, and aggregates results in the same report format as `bun test`.

---

## 14. Cross-engine numerical correctness

Bun runs on JavaScriptCore; Chrome/Edge on V8; Firefox on SpiderMonkey; Safari on JavaScriptCore. Transcendental functions (`exp`, `sin`, `pow`, `log`, …) can differ in the last bits.
1. **No claim of bit-identical results across runtimes.** Required: bit-identical within one runtime for the same seed/options; within stated tolerance across runtimes.
2. **Run the engine's analytical, reference, and conformance suites in real browsers** (section 13.8). A failure in any engine fails the build.
3. **All device and evaluator math goes through `core/math/`.** If drift ever breaks a tolerance, that module can swap in a deterministic implementation (ADR required).
4. Never depend on engine-specific behavior (non-integer-key iteration order, NaN canonicalization in typed arrays, error message text).
5. Bun benchmarks are indicative only; budgets are enforced in a browser.

---

## 15. CI/CD and releases

### 15.1 Every PR (all must pass; target pipeline < 12 minutes)
1. Setup: checkout, `oven-sh/setup-bun` from `.bun-version`, cache, `bun install --frozen-lockfile`.
2. Static: `biome check`, ESLint (zero warnings), `tsc -b`, dependency-cruiser (boundaries and cycles), knip, browser-target bundle check of runtime-agnostic packages.
3. Tests: `bun test --coverage` per workspace with thresholds, conformance (in-process + WebSocket vs real `Bun.serve`), reference suite.
4. Browser: engine suites in Chromium/Firefox/WebKit; Playwright component/e2e on the production build (Chromium required on PRs; all three on `main` and nightly); visual regression; axe.
5. Performance: mitata vs baseline; browser benchmarks vs budgets.
6. Build and package: libraries, UI, server, CLI executables (OS matrix), Docker image; `publint`, `attw`, `api-extractor` snapshot, packed-tarball embedding test, bundle-size budgets.
7. Security: `bun audit`, CodeQL, license allow-list, secret scanning, container scan, SBOM (CycloneDX).
8. Docs build (TypeDoc, link check).

**Bundle budgets:** UI initial JS ≤ 350 kB gzip (excluding lazy instruments); each lazy instrument chunk ≤ 120 kB gzip; `@spicekit/core` ≤ 120 kB gzip.

### 15.2 Nightly
Full cross-browser e2e, long fuzzing, mutation testing, extended ngspice comparison, 30-minute soak test (memory growth < 5%, no dropped-frame regression).

### 15.3 Release
- SemVer per package; `@spicekit/protocol` has its own major gating compatibility. Release candidates go to the `next` dist-tag; the UI repo runs the contract e2e smoke suite against the engine RC, and the engine repo runs the UI smoke suite against the UI RC before promotion.
- Tag → build → test → `npm publish --provenance` (OIDC, `id-token: write`) → push Docker image → deploy UI → upload executables + checksums + SBOM → GitHub release with changelog.
- **Rollback rehearsed:** previous UI build retained and re-deployable in minutes; npm deprecation rather than unpublish.

---

## 16. Security and robustness

- **Input is hostile:** SPICE text, JSON projects, clipboard, URL hash, and WebSocket frames pass through validated, size-limited parsers; zod validates every protocol message. No `eval`, `new Function`, dynamic `import()` of user data, or `innerHTML` with untrusted strings. SVG import is sanitized.
- **Resource limits** (configurable defaults): max elements (≈ 50k), nodes, timesteps per run, output samples, netlist size, subcircuit nesting, include depth, and server-mode wall-clock per run. Violations raise `E_LIMIT_EXCEEDED` with the offending value and limit.
- **Worker isolation:** the engine never touches DOM or storage; messages are structured-clone-safe only.
- **Server hardening:** origin allow-list, optional bearer token, per-connection rate/concurrency limits, message size caps, backpressure handling, no filesystem access, non-root read-only container, TLS at the proxy.
- **Web security:** strict CSP (`script-src 'self'`, no inline scripts; WASM only if used), `Referrer-Policy`, `X-Content-Type-Options`, SRI for any third-party asset (avoid third-party runtime assets entirely), Trusted Types where feasible, safe URL-hash decoding.
- **Supply chain:** pinned lockfile, blocked lifecycle scripts, provenance-signed publishes, minimal dependencies with ADRs, audit/CodeQL gates.
- **Privacy:** no data leaves the browser in worker mode (`docs/privacy.md`). Telemetry is off by default; optional opt-in error reporting (Sentry-compatible hook) with PII scrubbing. `SECURITY.md` defines responsible disclosure.

---

## 17. Performance and reliability budgets (CI-enforced in a real browser)

| Metric | Budget |
|---|---|
| Drag pointer-to-photon latency (symbol) | ≤ 16 ms p95, mid-range laptop |
| Pan/zoom with 1,000 symbols + 3,000 wire segments | 60 FPS steady, no frame > 25 ms |
| Dragging a 200-item selection | ≥ 50 FPS |
| Hit-test / snap lookup | < 0.5 ms at 5,000 objects |
| Document load (5,000 objects) | < 400 ms to first paint |
| Undo/redo of a 500-object operation | < 50 ms |
| Memory per 1,000 symbols | < 25 MB heap growth |
| Allocations in drag loop | zero (allocation benchmark) |
| Idle CPU | ~0% (no animation loops when nothing changes) |
| First load (cold, broadband) to interactive | ≤ 2.5 s; Lighthouse Performance ≥ 90 |
| Cached load | ≤ 800 ms |
| Engine worker ready after load | ≤ 150 ms |
| Live transient, 100-node circuit | ≥ 200k timesteps/s; UI ≥ 55 FPS with 4 scope channels |
| 30-minute live session | memory growth < 5%, no leaks |
| Main-thread long tasks (> 50 ms) in scripted journeys | 0 |
| Worker crash recovery | detected < 1 s, engine restarted, project preserved, clear notice |
| Low-end profile (4× CPU throttle) | graceful degradation (lower decimation/LOD) |

Add a performance test page and Playwright traces running scripted interactions; CI fails on regressions.

---

## 18. Accessibility, i18n, documentation, observability

### 18.1 Accessibility and input
- WCAG 2.2 AA for UI chrome; every editor action has a keyboard path; Tab through objects in reading order; arrow keys move the selection one grid step (`Shift` = 10); `Enter` edits.
- **Outline/tree view** of sheets, components, and nets synchronized with the canvas; ARIA live region for status ("R3 moved to 1200, 800", "Wire connected to net VCC").
- Touch/pen: one-finger pan in view mode, tap select, long-press drag, pinch/pan, palm rejection, pen hover = mouse hover; a touch toolbar with ≥ 44 px targets. Phones view-only.
- High-contrast theme; color is never the only carrier of meaning (ERC uses icons + text); reduced-motion respected. Every instrument has a keyboard model and ARIA labels; readouts use throttled live regions.

### 18.2 Internationalization
All strings externalized (react-i18next); English complete at release; RTL layout verified (Persian/Arabic ready; the schematic itself does not mirror); locale-aware numeric formatting where displayed.

### 18.3 Documentation
Static versioned docs site: Getting Started (first simulation in 5 minutes), User Guide (editor, instruments, analyses, shortcuts), Cookbook (≥ 20 recipes), Engine Reference (supported devices/models), **SPICE compatibility table** (supported/unsupported cards, devices, options, known deviations from ngspice), Embedding Guide, Protocol Reference, Architecture, Contributing, Troubleshooting (non-convergence, singular matrix, floating nodes). In-app help: contextual tooltips, searchable shortcut overlay, first-run 60-second guided tour, gallery circuits with explanatory notes. Docs links are checked in CI.

### 18.4 Observability and UX of failure
- Structured logger interface throughout; a debug panel shows engine logs, convergence statistics, and timings. Every run returns stats (iterations, rejected steps, timestep histogram, fallback methods used).
- Error boundary per panel (a broken instrument never takes down the editor); friendly error screens with **"copy diagnostics"** (versions, browser, last 200 log lines, project hash).
- Browser support: Chrome/Edge (latest 2), Firefox (latest 2), Safari (latest 2), tablet usable; graceful message on missing Worker/WebGL2 with Canvas2D fallback where feasible.
- `bun run doctor` checks Bun version, Playwright browsers, optional ngspice, printing actionable fixes. `bun install && bun run dev` gives a working environment in under a minute.

---

## 19. Example circuit gallery (each is also an e2e fixture)

1. RC low-pass, step and Bode
2. RLC series resonance (Q factor)
3. Half-wave and full-bridge rectifier with filter capacitor
4. Zener regulator
5. LED + resistor, then PWM dimming
6. BJT common-emitter amplifier (bias, gain, clipping)
7. BJT differential pair
8. MOSFET common-source amplifier
9. CMOS inverter VTC and transient
10. Inverting, non-inverting, summing op-amp amplifiers
11. Op-amp integrator and differentiator
12. Sallen-Key low-pass, 2nd order
13. Wien-bridge oscillator
14. Schmitt trigger (comparator)
15. 555 astable and monostable
16. Astable BJT multivibrator
17. Buck converter (switch + diode + LC)
18. Boost converter
19. Voltage doubler
20. Transformer with rectifier
21. Phase-shift oscillator
22. Ring oscillator (5-stage)
23. Class-B push-pull output stage (crossover distortion)
24. Voltage-divider potentiometer (interactive)
25. Function generator into RC network (sweep/chirp)
26. Diode clamper and RC level-shifter circuits

---

## 20. Production readiness checklist (release gate)

A release candidate ships only when **every** item is checked. The agent produces `docs/release-checklist.md` with evidence links per item.

**Correctness**
- [ ] Analytical, ngspice-reference, conservation, and convergence suites green **under Bun and in Chromium, Firefox, WebKit**; no skipped tests without an issue.
- [ ] All 26 gallery circuits simulate and pass numeric assertions.
- [ ] No known data-loss bug; project migrations tested from all prior versions.

**Quality**
- [ ] Coverage, Biome, ESLint, `tsc -b`, dependency boundaries, knip, size limits all green; mutation score target met on critical modules.
- [ ] Zero open P0/P1 bugs; P2s triaged with a plan.

**Performance and reliability**
- [ ] Section 17 budgets met on documented reference hardware and the low-end profile.
- [ ] 30-minute soak passes. Worker crash/restart and remote-engine disconnect/reconnect verified.

**Security**
- [ ] 24 hours of nightly fuzzing without crashes or hangs.
- [ ] CSP and security headers verified automatically; no high/critical vulnerabilities; SBOM and provenance attached; `SECURITY.md` present.

**Usability and accessibility**
- [ ] axe: zero serious/critical; manual keyboard and screen-reader pass recorded.
- [ ] UX script run with ≥ 3 people (or documented simulated runs): first-time task 1 in < 3 minutes.
- [ ] "Looks right" checklist (section 21) signed off on all reference schematics.

**Delivery**
- [ ] npm packages published with provenance; `publint`/`attw`/API snapshot pass; embedding example works under Bun, Node, and a browser bundle.
- [ ] Docker image published and scanned; CLI executables per OS smoke-tested with checksums.
- [ ] UI deployed to a static host with correct caching and a tested service-worker update flow.
- [ ] Docs site complete and link-checked; rollback rehearsed; changelog, migration guide, and release notes written.

---

## 21. "Looks right" checklist (human review gate for every schematic screenshot)

1. Everything sits on the grid; no half-pixel blur at 100% and 200%.
2. Wires are straight, orthogonal, minimal bends; no zero-length or overlapping segments.
3. Junction dots only where ≥ 3 wire ends meet; none missing.
4. No wire passes through a symbol body or an unrelated pin.
5. Reference and value text never overlap bodies, wires, or each other, and read left-to-right.
6. Signal flows left → right and power top → bottom in gallery circuits.
7. Pin names/numbers legible at normal zoom; hidden at far zoom without clutter.
8. Consistent stroke weights, corner styles, and font across all symbols.
9. Selection, hover, and ghost states are distinct and not garish.
10. SVG/PDF export in the Paper theme looks identical to the screen.

---

## 22. Milestones

Milestones are vertical and quality-gated: **no milestone is complete until its tests, docs, benchmarks, and browser-engine runs pass.** Each ends with a `docs/progress.md` entry.

**P0: Foundations (before feature work)**
Both repos as Bun workspaces; pinned Bun; `bun.lock`; `bunfig.toml`; tsconfig project references; Biome; ESLint (type-aware); dependency-cruiser; knip; commitlint; hooks; PR template; ADR template and ADR-001; `AGENT.md`; `testing` package; golden-fixture generator; CI with all stages (stubs where code doesn't exist), including the browser harness running a trivial suite in all three browsers; protocol package with IR types, zod schemas, `PROTOCOL_VERSION`, error hierarchy; in-process client with stub engine; UI shell connecting to the stub in worker mode.
*Accept:* a trivial change flows through the entire pipeline; a Bun/Node-specific import in `core` fails CI (negative test); a trivial analytical test passes under `bun test` **and** in Chromium, Firefox, WebKit; UI shell completes the handshake.

**E1: Linear DC and transient engine**
Parser (R, C, L, V, I, E, G, F, H, K; SIN/PULSE/PWL), compiler, dense LU, OP + DC sweep + transient (BE + trap, adaptive step), SPICE round-trip, CLI `run`/`check`, `core/math`.
*Accept:* analytical RC/RL/RLC tests and golden fixtures pass in all engines; property tests (round trip, KCL) green; parser fuzzer runs clean.

**E2: Nonlinear devices**
D, BJT, MOSFET L1, JFET, switches; Newton with limiting; gmin/source stepping; model library.
*Accept:* diode rectifier, CE amplifier, CMOS inverter, ring oscillator fixtures pass; the fallback ladder is exercised by a hard test; each device ships analytical + reference + property + convergence tests.

**E3: AC, noise, behavioral**
Complex solver, `.ac`, `.tf`, `.noise`, B sources with AD, `.param`, subcircuits, basic `.measure`, `evaluate` message.
*Accept:* active-filter Bode matches reference; op-amp macromodel GBW verified.

**E4: Client, transports, server, live mode**
Worker, WebSocket, in-process transports; conformance suite; streaming; live `setParam`/`setExternal`; sparse LU with symbolic reuse; `@spicekit/server` (Bun Workers, backpressure, health, metrics); chaos tests; resource limits; API snapshot; embedding examples; Docker image; CLI executables.
*Accept:* conformance green on all transports (Worker in three browsers, WebSocket against real `Bun.serve`); live frequency change shows no phase glitch; engine performance targets met in a browser; packed-tarball embedding works in Bun, Node, and a browser bundle.

**U1: Rendering, camera, selection**
GPU renderer behind `Renderer`, layer caching, spatial index, smooth camera with inertia, LOD text, DPR-crisp output, selection model, SVG export. Performance test page and baselines recorded first.
*Accept:* camera budgets met; visual regression green; SVG export matches screen.

**U2: Drag and drop and wiring**
Tool state machines, ghost placement, click-to-place, wire insertion, Move/Drag/detach, snapping and guides, settle animations, auto-pan, orthogonal/45°/free routing, A* assist, junction rules, normalization, no-connect flags, labels/power ports, net highlight, buses, command bus with undo/redo, copy/paste/array.
*Accept:* drag budgets met; connectivity property tests pass; no auto-connect on crossing; golden netlist suite exact; e2e for every drag behavior.

**U3: Symbols, library, inspector**
≥ 60 ANSI + IEC symbols, multi-unit, symbol validator, library search/preview, quick-add, field placement and auto-flip, inspector, value scrubbing, netlist extraction, ERC UI, run bar, probes.
*Accept:* visual regression for all symbols; validator green; a user builds the RC circuit from scratch by drag and drop and sees the correct step response (journey 1).

**U4: Instruments and dashboard**
Full scope (triggers, cursors, measurements, math, FFT, X-Y), function generator (component + panel), multimeter, power meter, Bode plotter, spectrum analyzer, curve tracer, logic analyzer, data table, sweep tool, widgets, dockable layouts, live annotations.
*Accept:* gallery circuits 1–12 run end-to-end through the UI; function-generator live-sweep demo works (journey 3); instrument budgets met.

**U5: Polish and product features**
Persistence, autosave and recovery, migrations, SPICE import with auto-layout, all exports, full gallery (26), themes (Dark/Light/Paper), shortcut presets and remapping, command palette, cleanup commands, hierarchical sheets and title blocks, presentation mode, i18n/RTL, accessibility pass, PWA/offline, error boundaries, diagnostics, noise UI, guided tour. Stretch (feature-flagged): symbol editor, lasso, touch toolbar, per-net colors, hop-overs.
*Accept:* all journeys green in three browsers; axe clean; Lighthouse PWA/accessibility ≥ 90; "looks right" checklist signed off.

**R1: Hardening and release**
Soak tests, crash recovery verification, security headers and CSP verification, mutation-score pass, docs site, cookbook, compatibility table, release-checklist run-through, RC cycle with cross-repo contract tests, rollback rehearsal.
*Accept:* section 20 fully checked with evidence.

---

## 23. Risk register (agent: re-verify at scaffold time and record outcomes in `docs/decisions/`)

| Risk | Mitigation |
|---|---|
| Bun is JSC, not V8; numerical drift vs browsers | Browser-run suites, tolerance-based cross-runtime checks, `core/math` wrapper |
| Bun test runner lacks a needed feature (DOM env, branch thresholds, fake timers detail) | happy-dom preload (UI only), lcov script, injected `Clock`; Playwright for browser-dependent UI |
| Playwright / Stryker / API tooling may not run perfectly under Bun | Run those via their own CLIs (Node in CI if needed); ADR for each exception |
| Provenance publishing | `npm publish --provenance` in CI until Bun support is verified |
| Bun version churn | Exact pin, deliberate upgrade PRs, full-suite gate |
| Accidental Bun/Node API use in shared code | Lint restrictions, empty `types`, browser-target bundle check |
| Vite under Bun edge cases | `bun --bun run vite`; Node exception via ADR if unstable |
| Blocked lifecycle scripts break a dependency | `trustedDependencies` entry with ADR, or replace the dependency |
| Non-convergence on hard circuits | Fallback ladder, stress set, clear diagnostics, regression fixtures |
| Renderer performance at scale | LOD, culling, layer caching, budgets with traces from milestone U1 onward |

---

## 24. First tasks for the agent (in order)

1. Complete **P0**: scaffold both repos, tooling, CI, ADR-001, `AGENT.md` in place, `docs/spec/SPEC.md` committed.
2. Implement `@spicekit/protocol` (IR, zod schemas, messages, version constant, error hierarchy).
3. Minimal engine: parser for R/C/V + `.op`, dense LU, in-process transport; make an RC divider OP test pass end-to-end **under Bun and in three browsers**.
4. Worker transport and the conformance suite; UI shell with dockable layout, theme, and run bar connected to the engine.
5. Add the UI performance test page and record baselines (`docs/perf-baseline.md`) before heavy editor work.
6. Continue with E1 → E4 and U1 → U5 (engine and UI tracks can proceed in parallel once the protocol is stable), then R1. After every milestone, write a `docs/progress.md` entry.

---

## 25. Future extensions (design for, do not build)

ngspice-WASM adapter behind `EngineAdapter`; WASM/SIMD sparse kernel; Monte Carlo and worst-case tolerance analysis; parameter optimization; event-driven digital co-simulation; collaborative editing (CRDT over the schematic document); PCB/BOM export; thermal modeling and self-heating; scripting console against the client API; plugin API for third-party components and instruments.

Design implications: keep the IR extensible (unknown fields preserved), the component library data-driven, instruments pure consumers of `resultStore`, and tools/rules registered through typed registries.
