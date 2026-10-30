# Circuit Studio — UI/UX Specification (v1.0)

**Status:** work order for the UI track (milestones UX0–UX7 + UXR).
**Scope:** the complete user experience of `circuit-studio` — design system,
app shell, editor, instruments, dashboard, measurement surfaces, motion,
accessibility, performance, and the task breakdown that implements them.
**Companion documents (read in this order):**

| Doc | Role |
|---|---|
| `circuit-studio/UI-UX-SPEC.md` (this file) | **Your work order.** What to build, to what quality, in what order. |
| `circuit-studio/AGENTS.md` | The engine contract: `@spicekit/client` API, transports, streaming, live mode, errors, IR cheat sheet. You never need to read engine source. |
| `docs/spec/SPEC.md` | Master specification. §8–11 (UI chapters), §13.5 (e2e journeys), §17 (budgets), §21 ("looks right"), §22 (U-milestones) are the long-form originals this spec expands. |
| `docs/perf-baseline.md` | Recorded performance baselines to protect. |

**Last updated:** 2026-10-31. Engine state: E1–E4 complete (real worker /
WebSocket / in-process transports, live mode, streaming, server).

---

## 0. How to use this document (agent contract)

**Precedence.** If sources disagree, in order: (1) the TypeScript types of
`@spicekit/protocol` and `@spicekit/client`; (2) this document for UX matters
and `AGENTS.md` for engine-wire matters; (3) `docs/spec/SPEC.md`. Where this
spec says **must**, it is enforced by CI, a test, or review.

**Working loop.** Implement milestones **UX0 → UX7 → UXR** in order (§13).
Within a milestone, finish every task, then run the full gate:

```
bun run check          # biome + eslint + tsc -b + bun test spicekit + dep-cruiser
bun test circuit-studio   # UI unit/component tests (as they are added)
bun run build:studio   # production build must succeed with budgets
bun run e2e            # Playwright (in circuit-studio/)
```

**Definition of done for every milestone:** all tasks checked; acceptance
gates (§13) demonstrably met; tests added and green; `docs/progress.md` entry
written (newest first); Conventional Commits; push at green milestones. A
milestone is **not** done while a screenshot would fail the §11 "looks right"
checklist for UI.

**Non-negotiable architecture rules (CI-enforced):**

1. Only `src/sim/` imports `@spicekit/client`. Everything else consumes
   stores and pure modules.
2. `src/**` must not import `bun:*`, `node:*`, or use `Bun`/`process`.
3. React **never** re-renders per data chunk. Instruments read typed-array
   ring buffers imperatively inside `requestAnimationFrame` (§7).
4. Every new dependency needs an ADR (size, license, maintenance,
   alternatives) recorded in `docs/decisions/`.
5. No `any`; no default exports; files ≤ 500 lines hard; functions ≤ 80 hard;
   cyclomatic complexity ≤ 15 hard (master §12.2).

---

## 1. Product definition

### 1.1 Vision

Circuit Studio is a **browser workbench for understanding circuits**: draw a
schematic that looks like a textbook figure, press Run, and *see* — on the
schematic itself and on laboratory-grade instruments — every voltage, every
current, and every waveform, updating live as you turn knobs. It must feel
like a design tool (Figma-smooth direct manipulation) and behave like a real
bench (KiCad-accurate semantics, oscilloscope-grade plots), with zero
installation and zero backend by default.

### 1.2 Experience principles

1. **The circuit is the interface.** Any result is reachable by pointing at
   the thing it belongs to: hover a node → voltage; hover a part → its V/I/P;
   click a wire → plot that net. Panels are views *of* the schematic, never
   parallel universes.
2. **One click from question to answer.** "What is the voltage across C1
   while it charges?" must never require more than: run (or live run) →
   click C1 → read the graph. Presets pre-answer the classic questions
   (§6.7.4).
3. **Direct manipulation, zero modal dialogs for geometry or values.**
   Scrub, drag, type-in-place; `Esc` always cancels; nothing destructive is
   one keystroke away.
4. **Calm, dense, precise.** Flat surfaces, hairline borders, generous
   information density with two density modes; motion is short, purposeful,
   and disabled under `prefers-reduced-motion`. No decoration that does not
   inform.
5. **Numbers are first-class.** Engineering notation everywhere (`4.7 kΩ`,
   `63.2 %`, `1.2 ms`), monospaced tabular digits, units on every readout,
   precision that adapts to magnitude (§4.1 typography rules).
6. **Fail loudly, locally, and helpfully.** Every error names the culprit
   (element, node, netlist line), shows a suggested fix, and offers "Zoom to"
   — the schematic highlights, the panel never blocks the canvas.
7. **Keyboard complete.** Every action has a shortcut; the command palette
   (`Ctrl/Cmd+K`) lists them all; the app is fully operable without a mouse
   (§9).
8. **Never lose state, never block.** Autosave beats crashes; a broken
   instrument is an error boundary, not a white screen; the engine crashing
   restarts it in < 1 s with the project intact.
9. **60 fps or degrade gracefully.** Decimate, cache, and move work off the
   main thread before dropping frames (§10).
10. **Teaching built in.** Empty states, the gallery, and the capacitor-lab
    presets explain the physics (τ, 63.2 %, −3 dB) while you use the tool.

### 1.3 Users and top jobs

| User | Top jobs (v1) |
|---|---|
| Student / learner | Build RC/RLC/op-amp circuits; watch capacitor charge/discharge; measure v(t), i(t); understand τ, cutoff, gain. |
| Hobbyist / maker | Try a 555 or buck converter; tune values live; check LED current; export a netlist. |
| Engineer (quick check) | Import a SPICE netlist; run AC/tran; read Bode margins, RMS/mean; export CSV/PDF for a report. |
| Educator / presenter | Present-mode clean schematic; live knob demos; Paper-theme PDF export. |

### 1.4 Non-goals (v1)

PCB layout; BSIM-class models; mixed-signal event simulation; Monte Carlo;
collaborative editing (design seams per master §25 only). Phones are
view-only (§9.4).

---

## 2. Where we are today (current-state audit)

### 2.1 Already built (do not rebuild; extend)

| Artifact | State | Keep / change |
|---|---|---|
| `circuit-studio/src/app/App.tsx` | P0 shell: header with brand, engine chip (connecting/ok/error), theme `<select>`, placeholder canvas, footer. Performs real `connect()` handshake (StrictMode-safe pattern). | **Replace** by the §3 shell (dockview) — port the EngineStatus chip and handshake effect into `app/Shell.tsx`. |
| `circuit-studio/src/app/theme.ts` | `ThemeId = dark \| light \| paper`, `applyTheme()` via `data-theme`. | **Keep**; becomes part of `app/theming.ts` with system-theme detection. |
| `circuit-studio/src/index.css` | Tailwind 4 import + 7 CSS variables per theme (dark/light/paper) + reduced-motion kill switch. | **Keep and extend** into the full token set (§4.1) — same file, same mechanism. |
| `circuit-studio/src/stores/ui-store.ts` | Zustand: `theme`, `tool`. | **Keep**; grows `selection`, `viewport`, `density`, `layoutPreset` (§3). |
| `circuit-studio/src/sim/client.ts` | `getSimulatorClient()` singleton; currently `createInProcessClient()` with a `TODO(E4)` to switch to worker. | **Change** to `createWorkerClient()` per `AGENTS.md` §12 W0. |
| `circuit-studio/e2e/smoke.spec.ts` | Journey 0: shell loads, engine chip appears. | **Keep**; journeys 1–10 append per milestone. |
| `circuit-studio/AGENTS.md` | Engine contract + plan W0–W4. | **Keep** as the wire-level authority; this spec supersedes its §12 ordering for UX sequencing. |
| Engine side (E1–E4) | Real engine session, worker/WebSocket/in-process transports, streaming, live `setParam`/`setExternal`, `evaluate`, `exportSpice`, typed errors with locations, capabilities/limits. | Consume via `AGENTS.md`. Feature-detect; never hardcode. |

### 2.2 Gap analysis vs v1 target

Missing entirely (the work of UX0–UX7): docking layout and layout presets;
command palette and complete shortcut system; the design-system component
layer; the schematic canvas and editor tools; library palette and inspector;
run bar and sim/result stores; every instrument (scope, plots, generator,
meters); per-node/per-element measurement surfaces (OP table, badges,
cross-probing, overlays); dashboard widgets; console; persistence UX;
onboarding, gallery, a11y pass, i18n scaffolding, PWA.

### 2.3 Plan reconciliation (important)

`AGENTS.md` §12 defines W0–W4 (engine-facing integration steps). The master
spec defines U1–U5 + R1. **This spec reorders that work into UX0–UX7 + UXR**
(§13) so each milestone ships a coherent user-visible increment; the mapping
table in §14 shows exactly which U/W items each UX milestone absorbs. If a
conflict remains, §13 of this document governs sequencing, and the engine
contract remains `AGENTS.md`.

---

## 3. App shell and information architecture

### 3.1 Screen anatomy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ A Title bar: logo · project name (editable) · dirty state · undo/redo ·      │
│   command palette (⌘K) · layout-preset menu · theme menu · export menu       │
├───┬───────────────────────────────────────────────────────────┬──────────────┤
│ B │ C Schematic canvas (center, always visible)               │ D Inspector  │
│ T │   grid · symbols · wires · probes · badges · overlays     │   (right     │
│ o │   run overlays: voltage heat, current flow                │   dock,      │
│ o │                                                           │   tabbed)    │
│ l │                                                           │              │
│   ├───────────────────────────────────────────────────────────┴──────────────┤
│ E Instrument dock (bottom, dockable): Scope │ Plots │ Generator │ Meters │   │
│   Console │ Data table │ OP table          (tabbed, resizable, floatable)   │
├──────────────────────────────────────────────────────────────────────────────┤
│ F Run bar: ▶ Run ▮ Pause ■ Stop ⇥ Step · analysis selector · time readout ·  │
│   speed · progress · engine chip (transport, version, load) · ERC count      │
├──────────────────────────────────────────────────────────────────────────────┤
│ G Status bar: selection info · cursor position · snap · grid · zoom · hints  │
└──────────────────────────────────────────────────────────────────────────────┘
   Library palette (H) is a left dock over/beside B, toggleable.
```

- **A Title bar (36 px):** project name inline-editable; dot marks unsaved
  changes; global menus are commands (palette-first, no classic menu bar).
- **B Tool rail (44 px, icon buttons with tooltips + shortcut labels):**
  select `V`, wire `W`, place `A`, text `T`, probe `P`, pan `Space`-hold,
  zoom-to-fit `Home`. Active tool is accent-highlighted; keyboard hint badge.
- **C Canvas** — see §6.2.
- **D Inspector dock (300 px default, resizable, collapsible):** context
  panel — selection properties, or document settings when nothing is
  selected. Tabbed when multiple contexts (Properties / Measurements / Model).
- **E Instrument dock (min 220 px, default 34 % height):** dockview tabs;
  any panel can be dragged to float or to a side dock. Canvas keeps ≥ 50 %
  of window width at all times (layout guard).
- **F Run bar (44 px)** — see §6.1. Always visible in every preset.
- **G Status bar (24 px):** left — selection summary ("2 symbols, 3 wires ·
  Δ 150, 0 mil"); middle — contextual hint for the active tool ("Click to
  place · R rotate · Esc done"); right — snap indicator, grid size, zoom %.

### 3.2 Layout presets (dockview)

| Preset | Arrangement | Purpose |
|---|---|---|
| **Build** | Library left, inspector right, canvas maximized, instrument dock collapsed. | Drawing and editing. |
| **Debug** | Library collapsed, inspector right, instrument dock 40 % height with Scope + Console + OP table tabbed. | Running and measuring. |
| **Present** | All chrome hidden except canvas and scope; toolbar auto-hides; large fonts toggle. | Teaching/demos. |
| Custom | Any arrangement the user builds. | Persisted per project. |

Preset switching animates docks with the standard 160 ms ease (§8); layouts
persist to the project file and to localStorage for new projects.

### 3.3 Command system

- **Command palette** (`Ctrl/Cmd+K`): fuzzy search over every command, with
  shortcut, category, and "recent" weighting. Palette items are the *only*
  registration point for commands (typed `CommandRegistry`: `id`, `title`,
  `category`, `shortcut`, `run`, `isEnabled`, `icon`).
- **Shortcut table:** the full table lives in §9.2; it is generated *from*
  the registry (single source of truth), rendered in-app as a searchable
  overlay (`?`), and is remappable with conflict detection. Presets: Default,
  KiCad, Figma-style.
- Every command is available on: palette, shortcut (if bound), context menu
  (if contextual), and toolbar (if frequent).

---

## 4. Studio design system ("Studio DS")

### 4.1 Design tokens

Tokens are CSS variables on `:root[data-theme=…]` (extend
`src/index.css`), consumed by Tailwind theme mapping and components. **Never
hardcode a hex in a component.**

**Color — semantic core** (dark values shown; light/paper mapped in §4.2):

| Token | Dark | Role |
|---|---|---|
| `--bg` | `#0d1117` | App background |
| `--bg-panel` | `#161b22` | Panels, docks, bars |
| `--bg-elevated` | `#1c2128` | Popovers, menus, tooltips (elevated) |
| `--canvas-bg` | `#0b0e13` | Schematic canvas |
| `--fg` | `#e6edf3` | Primary text |
| `--fg-muted` | `#8b949e` | Secondary text, labels |
| `--fg-faint` | `#6e7681` | Disabled, watermark |
| `--border` | `#30363d` | Hairline borders (1 px) |
| `--border-strong` | `#484f58` | Hovered/resizable borders |
| `--accent` | `#4f8ef7` | Primary actions, selection, active tab |
| `--accent-soft` | `#4f8ef722` | Accent washes (10–15 % alpha fills) |

**Color — signal palette** (scope traces, probe colors, badge encoding;
ordered, assigned by index; WCAG AA on `--canvas-bg`):

| # | Dark | Name |
|---|---|---|
| 1 | `#4f8ef7` | blue |
| 2 | `#f7b34f` | amber |
| 3 | `#3fd68f` | green |
| 4 | `#f76f8e` | rose |
| 5 | `#b58ef7` | violet |
| 6 | `#41c8f4` | cyan |
| 7 | `#d3f34f` | lime |
| 8 | `#f49f41` | orange |

**Color — state:** `--ok #3fd68f`, `--warning #f7b34f`, `--error #f76f6f`,
`--info #41c8f4` (+ `*-soft` 15 % alpha variants for washes). ERC severities,
convergence status, and engine chip use these — color is always paired with
an icon and text (§9.1).

**Color — canvas semantic** (master §9.12 token list, made concrete):
`--wire`, `--wire-selected` (accent), `--net-highlight` (accent pulse),
`--symbol-body`, `--symbol-fill` (transparent), `--pin`, `--pin-hover`,
`--junction`, `--label`, `--power-net` (`#f76f6f` family), `--ground-net`
(`#8b949e`), `--error-marker`, `--warning-marker`, `--ghost` (60 % alpha),
`--guide` (magenta `#f74fd3`). **Voltage heat map** for badges/overlays:
5-stop `#41c8f4 → #3fd68f → #d3f34f → #f49f41 → #f76f6f` normalized to the
run's min/max node voltage; a colorblind-safe alternative (viridis) is a
setting. **Current flow:** direction by sign, magnitude → dash speed and
arrow density, single hue (`--accent`) to avoid rainbow noise.

**Typography**

| Use | Font | Notes |
|---|---|---|
| UI text | **Inter** (bundled woff2, subset, OFL) | 12/13 px base 13; weights 400/500/600; `font-feature-settings: "cv11"` |
| Numeric readouts | **JetBrains Mono** (bundled) | Tabular figures everywhere numbers update; 12/13 px |
| Schematic text | **IBM Plex Sans** (bundled) | Reference/value/labels; consistent monoline feel at all zooms |

Numbers: engineering notation with SI prefix (`4.7 k`, `100 n`, `1.2 M`),
unit rendered smaller/muted after the value (`4.7 kΩ`, `12.0 V`, `3.2 mA`);
precision rule — 3 significant digits above 1, else 2 decimals in exponent
form; never reflow on digit change (tabular, fixed box, `min-width` chip).
All formatting goes through one `src/ui/format.ts` (`formatEng`, `formatSI`,
`formatUnit`, `formatTime`) — unit-tested exhaustively.

**Spacing / radius / elevation:** 4 px base grid (4/8/12/16/24); radius
`--r-sm 6`, `--r-md 10`, `--r-lg 14`, full for pills; elevation is
discipline-level: panel = flat + 1 px `--border`, popover =
`--bg-elevated` + `0 8px 24px rgba(0,0,0,.4)`, floating panel =
`0 12px 32px rgba(0,0,0,.5)`; no gradients, no glass blur (Paper theme uses
pure white/black).

**Density:** `comfortable` (default; 32 px control height) and `compact`
(26 px; scope/table rows 24 px) — a `data-density` attribute on root,
tokenized (`--ctl-h`, `--row-h`).

### 4.2 Themes

`dark` (default), `light`, `paper` via `data-theme` (existing mechanism).
Rules: every token is defined in all three themes; contrast ≥ 4.5:1 for
text, ≥ 3:1 for wires/symbols vs canvas; trace palette has per-theme
variants (paper theme uses darker, print-friendly hues); canvas dot grid
scales and fades with zoom (major every 5th line); theme switch is instant
(no transition on background). First run follows `prefers-color-scheme`.

### 4.3 Component inventory (`src/ui/`)

Primitives (Radix UI where a behavior exists — dialog, popover, tooltip,
select, tabs, switch, slider, toggle-group, dropdown-menu, toast; otherwise
hand-rolled): `Button` (primary/ghost/danger, icon-only + tooltip), `IconButton`,
`Field` (label + unit + engineering-notation input with validation shake),
`NumberInput` (scrubbable, §6.4), `Select`, `Tabs`, `Panel` (dock panel
chrome: title, actions, overflow menu), `Toolbar`, `Tooltip`, `Popover`,
`Menu`, `Toast` (bottom-right stack, 4 s, actions allowed), `Badge`,
`Chip` (engine/status), `Table` (virtualized), `Kbd`, `EmptyState` (icon +
one-liner + primary action), `Skeleton`, `ProgressBar`, `Splitter`,
`ColorDot`, `Sparkline`, `Knob` (§6.8), `ErrorState`.

Composites live beside their feature (instruments, inspector) — `src/ui/`
holds only reusable primitives. Each primitive: keyboard-operable, focus
ring `2 px accent` at 2 px offset, ARIA-complete, works in all three themes,
snapshot-tested.

### 4.4 Iconography and illustration

One icon set (Lucide, tree-shaken, 16 px stroke 1.5 in chrome, 20 px on
tool rail), no mixed sets; tools and instruments each have a distinct,
consistent glyph; empty states use a single-line art style (1.5 px stroke,
`--fg-faint`), never screenshots; ERC/error markers are canvas-drawn
triangle/dot glyphs with theme state colors.

---

## 5. Core experience flows (the UX scripts every feature must serve)

These are the scripts e2e journeys assert (master §13.5). Each step lists
the surface that must exist when its milestone ships.

**F1 — First run (journey 0+).** Load → shell appears with Build preset →
gallery card grid (empty project): "Start from a template" (RC low-pass,
rectifier, 555 astable…) or "Blank sheet". Choosing a template loads a
working circuit with probes pre-placed and a hint toast: "Press F5 to run".
First-ever visit offers the 60-second guided tour (skippable, §6.12).

**F2 — Place and wire.** `A` → library quick-add popup at cursor (fuzzy
search) → ghost symbol follows cursor, snapped, live pin dots → click to
place (stays armed) → `W` → wire tool: click pin, corners auto-route
orthogonally, `Space` flips corner, click pin to finish → junction dots
appear where ≥ 3 ends meet → `Esc`. Labels auto-place; `V` edits value
in-place with engineering parsing. Netlist extraction keeps the IR in sync
invisibly; ERC markers appear immediately for floating pins.

**F3 — Configure and run (buffered).** Set generator/source values in
inspector or generator panel → analysis selector in run bar (default
`tran` with a sane auto window ≈ 5·τ or 5·period, editable) → `F5` →
progress ring on Run button, time readout ticks, **scope auto-opens** with
probed signals colored by probe palette → on `done`, stats toast (method
used, iterations, wall time) and results stay available for cursors/zoom.

**F4 — Read results: every node and element (UX4).** After any run (or
during live): toggle **"Show voltages"** (`Ctrl+Shift+V`) → voltage badge on
every pin, color-mapped; **"Show currents"** (`Ctrl+Shift+I`) → current
arrows with values on every element lead; power on 2-pin parts with
`Ctrl+Shift+P`. The **OP / Results table** (§6.5.1) lists every node voltage
and every element's V/I/P sortable and searchable; clicking a row highlights
the object on canvas; `Alt+click` any wire/part during a run → "Plot
v(net)" / "Plot i(elem)" buttons. Hover shows a live tooltip with V/I/P.

**F5 — Waveforms: capacitor charge/discharge, v(t)/i(t) (UX3).** Run a
transient with a capacitor → scope shows `v(c1:1)`, `i(c1)` traces →
**Experiments ▸ "RC charging"** reconfigures the circuit (PULSE source,
tran window 5τ, probes) and annotates the plot: dashed τ line at 63.2 % of
final value, marker at 5τ ("steady state"), computed R_thevenin·C readout
in the measurement bar; "RC discharging" does the 36.8 % mirror. Cursors
X1/X2 read Δt, ΔV and give 1-τ estimates. Every trace is exportable CSV/PNG.
This is the flagship teaching flow — it must work in ≤ 3 clicks from a
template (§6.7.4).

**F6 — Live interactive (UX5).** Run bar ▸ "Live" toggle (tran with
`stream:{mode:'live'}`) → scope switches to roll mode → turn a
potentiometer knob on canvas or the generator panel's frequency knob →
waveform responds within 200 ms, no phase jump → flip a switch → current
re-routes visibly (flow overlay) → `Space` pauses; `⇥` single-steps.

**F7 — Find and fix errors.** ERC panel (right dock tab) lists issues with
severity icons; click → canvas pans to and pulses the culprit; engine
errors map via `sourceMap` to the element with a badge and a suggested fix
("Node n3 has no DC path to ground — add a resistor to ground"); one
"Apply suggestion" action where mechanical (e.g., add pull-down, add
ground). Nothing modal, ever.

**F8 — Save, import, export.** `Ctrl+S` → project file; autosave to
IndexedDB every few seconds with crash recovery banner on next load
("Restore autosave from 2 min ago?"); Import SPICE → schematic auto-layout
(best effort, banner states limitations); Export menu: SPICE netlist, SVG,
PNG, PDF (Paper theme), CSV (current plot), BOM.

---

## 6. Feature specifications

### 6.1 Run bar and engine status

- **Controls:** `Run ▶` (primary button; becomes progress ring while
  running), `Pause ⏸/Resume ▶`, `Stop ■`, `Step ⇥` (live mode), `Live`
  toggle. Analysis selector (segmented): OP · DC · AC · Tran · Noise · TF
  → per-analysis options inline (tran: tstep/tstop presets + custom; ac:
  decade/lin + fstart/fstop; dc: source + range). Sweep button (`Ctrl+Alt+R`)
  opens the parameter-sweep builder (§6.7.5).
- **Readouts:** simulated time (mono, tabular), speed (×0.01…×10 +
  "as fast as possible"), progress %, run chip showing method used
  (OP fallback ladder outcome per `RunStats.method`).
- **Engine chip (status bar + run bar):** transport (worker/WebSocket),
  engine version, protocol version, caps icon if `limits` near (queue/load
  when available). States: connecting (pulsed dot) → ready (ok) → error
  (state red + "Reconnect" action). Worker crash: auto-reconnect < 1 s,
  toast "Engine restarted — reload circuit", project preserved.
- Keyboard: `F5` run/stop-toggle, `Shift+F5` stop, `F6` pause/resume,
  `F7` step (master §9.10).

### 6.2 Schematic canvas and editor (UX layer)

The full editor behavior (camera, selection, drag & drop, wiring semantics,
symbol library, ERC) is specified by master §9 — the following adds the
UX-critical rules this spec enforces:

1. **Always-on canvas ergonomics:** 50 mil default grid with dot rendering;
   zoom 5–6400 % centered on cursor; pan with space-drag/middle-drag;
   zoom-to-fit `Home`; minimap toggle; `prefers-reduced-motion` disables
   camera springs.
2. **Tool state machines** (`Idle/Selecting/Dragging/Wiring/Placing/…`)
   are pure and unit-tested; cursor + status-bar hint + tool-rail highlight
   change per state.
3. **Result overlays on canvas** (all toggleable, all theme-aware):
   voltage badges at pins, current arrows on leads, power badges,
   current-flow animation, net-highlight on hover (Alt-free subtle) and on
   click (strong, persistent), ERC markers, probe flags with channel
   numbers, measurement callouts (§6.7.4).
4. **In-canvas editing:** double-click value → inline edit (engineering
   parse, error shake); `Alt+drag` on a value scrubs it (log for R/C/L)
   with live response in live mode; mini floating toolbar near selection
   (rotate/mirror/delete/edit) after 300 ms hover, never during drag.
5. **Interactive components** (switch, button, potentiometer, LED) render
   affordances on canvas in live mode: clickable toggle targets ≥ 24 px,
   knob drag with radial pointer capture, LED glow ∝ current.

### 6.3 Library palette

- Left dock: search-as-you-type (name/keywords/value), category tree
  (Passive, Sources, Diodes, Transistors, Op-amps, Switches, Power, Blocks),
  favorites + recents rows, preview card with pin table and SPICE mapping.
- Drag = real ghost symbol; `A` opens the quick-add popup at cursor;
  Enter places and re-arms. Target ≥ 60 symbols (master §9.6) with the
  validator green in CI.

### 6.4 Inspector

- **Context switching:** selection → properties; empty → document settings
  (title, sheet, analysis defaults, theme overrides). Multi-selection →
  common properties (multi-edit same-type).
- **Fields:** label + value + unit + engineering parser; `NumberInput`
  supports: type (`4.7k`), arrows, `Alt+drag` scrub, wheel (with `Shift`
  = finer), invalid shake with message. Every field change routes through
  the command bus (one coalesced undo step per gesture).
- **Model tab:** model card fields when applicable (diode/BJT/MOS/op-amp
  presets), "assign from library" drop target.
- **Measurements section (per element, post-run):** type-specific live
  readouts — R: V/I/P; C: V, I, dV/dt, stored energy E=½CV², **τ estimate
  (R_th·C)**; L: I, V, stored energy; D: Id, Vd, P; BJT: Ic, Ib, Vbe, Vce;
  MOS: Id, Vgs, Vds, region; sources: amplitude/freq/offset live. Values
  update per frame in live mode (rAF, §7).

### 6.5 Results and measurement surfaces (the "see everything" requirement)

**Goal (hard requirement):** after any analysis — and continuously in live
mode — the user can read the voltage and current of **every node and every
element** without leaving the canvas, and push any of them onto any plot,
meter, or widget in ≤ 2 interactions.

#### 6.5.1 Results table (OP/DC point; the numeric home)

- Panel (instrument dock tab, `Ctrl+Shift+T`): three groups — **Nodes**
  (`v(node)` for every node incl. ground 0 V), **Elements** (per element:
  current `i(name)`, terminal voltages, power, and device-op fields the
  engine exposes), **Sources** (set vs actual). Columns: Signal · Value ·
  Unit · mini-sparkline (last run history) · actions (Plot, Meter, Pin to
  dashboard).
- Sortable, filterable, `Copy CSV`, click row ⇄ canvas highlight
  (bidirectional), `Alt+click` = cross-probe onto the active scope.
- Populated from: OP → final solution; DC sweep → last point + sweep table
  (§6.7.3); tran/live → values at cursor X (table becomes "at cursor"
  mode with time stamp).

#### 6.5.2 Schematic badges and overlays

- **Voltage badges** (`Ctrl+Shift+V`): one pill per net junction, showing
  `v(net)` with 3-sig-fig engineering notation, background = voltage heat
  map (§4.1), value = high-contrast mono; placement is collision-avoiding
  (offset outward, dimmed at 60 % opacity when overlapping a body; never
  covering a wire).
- **Current arrows** (`Ctrl+Shift+I`): on each element lead, a small
  direction arrow + `i(elem)`; arrow flips with sign; thickness/brightness
  scales with |I| relative to run max. Power badge (`Ctrl+Shift+P`) on
  2-pin elements (`P = V·I`, dissipating → +, generating → −).
- All badge layers render in the GPU overlay pass (no React per value);
  toggles persist per project. In live mode badges update per animation
  frame from the ring buffers.

#### 6.5.3 Hover tooltips and cross-probing

- Hover node/wire: tooltip `v(out) = 3.42 V` (+ heat chip). Hover element:
  tooltip card — reference, value/model, V across, I through, P, device-op
  fields; live-updating in live mode; pinned with `Ctrl+hover` click.
- **Cross-probe:** click wire → net highlighted + floating chip
  `net out ▸ Plot ▸ Meter ▸ Widget`; `Alt+click` = instant plot. Click
  element → chip offers `i(r1)`, `v(r1:1)−v(r1:2)`, `p(r1)`. Selection
  syncs both ways with Results table rows, scope legend items, and
  inspector.

#### 6.5.4 Current-flow overlay

Toggle "Show current flow": animated dashes along wires; speed ∝ |I|
(log-compressed), direction = conventional current; junction dots pulse on
net highlight; GPU shader pass, not per-wire JS. Off by default in Build
preset, on in Debug/Present presets for the relevant demos.

#### 6.5.5 Multimeter and power meter

- Multimeter panel: mode chips (DC V · AC V rms · DC I · AC I · R · f),
  a large mono readout with auto-range, MIN/MAX/HOLD, and a probe target:
  either "follow selection" or pinned measurements list (up to 6 pinned
  readouts shown as tiles). Resistance mode uses a small test current at
  OP (engine-supported); frequency mode derives from zero crossings with
  hysteresis.
- Power meter: pick an element → instantaneous P, average P (over cursor
  window or full run), cumulative energy (W·s → mWh formatting), plus a
  rolling sparkline.

### 6.6 Data table, console, diagnostics

- **Data table:** the current run's samples as a virtualized grid
  (time + visible signals), search, CSV export — the "show me the numbers"
  view of any plot.
- **Console (`Ctrl+\``):** engine log, warnings, load warnings from
  `LoadResult`, run stats (iterations, rejected steps, method used,
  timestep histogram as a mini-chart), transport events (reconnects).
  Filter chips: error/warn/info/engine. Every line has a "copy" affordance.
- **Diagnostics drawer ("copy diagnostics"):** versions, transport, last
  200 console lines, project hash — for bug reports.

### 6.7 Plots and waveform instruments

#### 6.7.0 Scope vs plots — division of labor

One **Oscilloscope** (time-domain workhorse, trigger, roll mode, live) plus
purpose-built **plot panels** (Bode, DC sweep, spectrum, X-Y, curve tracer).
uPlot renders standard series; the scope's high-point-count path uses the
GPU renderer; both consume ring buffers identically (§7).

#### 6.7.1 Oscilloscope (the default answer to "graph v(t)/i(t)")

- **Channels:** up to 8; add via probe, cross-probe (`Alt+click`), legend
  `+`, or Results table. Per channel: color (palette §4.1), label (signal
  name), V/div or I/div, vertical offset, invert, visibility, remove.
  Channel legend doubles as the measurement column (see below).
- **Timebase:** s/div (1-2-5 decades + fine), horizontal position, "auto"
  button fits window to data; live mode adds **roll mode** (scrolling) and
  pause-on-investigation (pause run ⇒ scope keeps history).
- **Trigger:** source channel, edge (rise/fall/either), level (draggable
  line on canvas), Auto/Normal/Single, holdoff. Trigger indicator glyph on
  the left edge; in Auto mode the free-run trace dims behind triggered
  trace.
- **Cursors:** X1/X2 (Δt, 1/Δt), Y1/Y2 per channel (ΔV, ΔI), track mode;
  draggable handles + numeric entry; cursor values appear in the legend
  table; snap-to-data option.
- **Automatic measurements** (per channel, toggle from a measurement
  table): Vpp, Vmax, Vmin, Vavg, Vrms, frequency, period, duty, rise time
  (10–90 %), fall time, overshoot. Computed over the visible window;
  refresh per frame in live mode but throttled to 4 Hz for readability.
- **Math channels:** A±B, A×B, FFT (opens spectrum), integral, derivative,
  custom expression via `evaluate` (context from cursor or last sample).
- **View niceties:** zoom box, pan, reset; min/max decimation envelope at
  low zoom; per-channel highlight (others dim) on legend hover; PNG/CSV
  export; dark/light/paper plot backgrounds follow theme with per-theme
  grid colors.
- **Performance budget:** ≥ 60 fps with 4 channels × 100k visible points
  (decimation in a worker); allocations in the draw loop ≈ 0 (§10).

#### 6.7.2 Bode plotter

Magnitude (dB) + phase (deg) vs frequency (log), from any `ac` run;
draggable cursor with crosshair readouts at the exact interpolated
frequency; automatic **−3 dB marker**, gain/phase **margins** (for circuits
with feedback), and crossover detection; overlay multiple runs (compare
different C values, see §6.7.5 sweeps); export CSV/PNG.

#### 6.7.3 DC sweep / curve tracer

X = swept source/parameter, Y = any measured signal (multi-trace when a
secondary step is present); classic presets: diode IV, BJT output
families (Ic vs Vce @ Ib steps), MOSFET Id vs Vds; the **Results table**
shows the sweep in tabular form; export CSV.

#### 6.7.4 Experiments — the capacitor/inductor lab presets (flagship)

An **Experiments ▸** menu (in the scope toolbar and the command palette)
that configures circuit + analysis + probes + annotations in one action.
Each experiment is a declarative recipe (JSON in
`src/instruments/experiments/`) — data-driven, tested, extensible:

| Experiment | Configures | Annotates |
|---|---|---|
| **RC charging** | PULSE source 0→V1 (long high), tran `5τ`, probes `v(cap)`, `i(cap)` | dashed line at 63.2 %·V1, marker at t=τ (label `τ = R_th·C = …`), steady-state band ±1 % from 3τ |
| **RC discharging** | source steps V1→0, tran `5τ` | dashed 36.8 % line, τ marker, energy decay trace `½CV²` |
| **RLC step** | PULSE, tran ~5·(2π/ω₀) | overshoot %, settling time (±2 % band), ζ/ω₀ readout |
| **Integrator ramp** | square + op-amp integrator | slope readout (V/s = V_in/RC) |
| **LC resonance** | AC sweep across fo | fo, Q markers |
| **Diode IV** | DC sweep | forward-voltage at 1 mA/10 mA markers |

The RC experiments **compute R_thevenin at the capacitor terminals** (from
the OP solve with the cap open / via `evaluate`) and display τ with the
value; if the circuit is not first-order, the preset says so and skips τ
annotations (honesty rule). The scope measurement bar gains
**"Estimate τ from cursor"**: with X1/X2 spanning 0→63.2 % crossing, it
reports the fitted τ (exp fit, least squares) — works on measured data of
any first-order response.

Every experiment renders a **callout card** on the plot (title, one-line
physics explanation, "what to look for") that can be dismissed or pinned —
teaching without leaving the tool.

#### 6.7.5 Parameter sweep tool

Builder dialog: parameter (any element value via `setParam`-style target or
source), type (list / linear / decade), values or range+count; runs
sequentially (worker pool when remote); progress + cancel; results overlay
on the active plot with a **trace legend colored by parameter value** and a
slider to scrub between sweeps; export a matrix CSV.

### 6.8 Function generator (panel + component)

- Panel = the inspector of source components (same state): waveform picker
  with drawn thumbnails (sine, square, triangle, sawtooth, pulse, noise,
  DC, arbitrary, sweep/chirp, burst, AM/FM), frequency (decade knob +
  stepper + typed), amplitude (Vpp/Vrms), offset, duty, phase, rise/fall,
  output impedance (50 Ω / Hi-Z toggle → series R), output enable.
- **Skeuomorphic-lite front panel:** rotary knobs (drag vertical/radial,
  wheel = fine step, double-click = type), 7-segment-style mono readouts,
  live waveform thumbnail; every control keyboard-reachable and
  screen-reader-labeled (knob = `role=slider` with aria-valuetext in
  engineering units).
- **Live mapping:** buffered runs compile to SIN/PULSE/PWL; live runs
  retune via `setParam` (amplitude/frequency/offset, phase-continuous) and
  `setExternal` for arbitrary/sweep channels (AGENTS.md §6). Multiple
  generators allowed; each is a named source with its own panel tab.

### 6.9 Dashboard grid and widgets

- **Edit mode** (toggle): drag widgets on a 12-col grid, resize, bind each
  widget to any signal (picker = Results table). **Run mode:** widgets
  update per frame.
- Widget set (v1): big-number tile (engineering units, delta since last
  run, sparkline background), gauge (radial, min/max/zone colors),
  horizontal bar, sparkline, LED indicator (threshold + color), status
  chip (convergence/method). Each widget: `aria-label`, keyboard-focusable
  binding picker, theme-aware.
- Dashboards persist per project; preset dashboards ship with gallery
  circuits.

### 6.10 Persistence, autosave, recovery UX

- Save (`Ctrl+S`) / Save As via File System Access API with download
  fallback; title bar dirty dot; unsaved-changes guard on close.
- Autosave: IndexedDB snapshot every 5 s (debounced), last 20 versions;
  crash recovery banner on next open with "Restore / Discard"; version
  history browser (list + preview + restore).
- Import/export per F8; every export shows a pre-flight summary (what will
  be written); PDF export uses the Paper theme and offers sheet fit.

---

## 7. Data and state contracts (UI side)

Follows master §8 and `AGENTS.md` §5 exactly; restated as UI law:

1. **Stores (Zustand slices, `src/stores/`):**
   - `projectStore` — document model (undoable via command bus), metadata,
     dirty state.
   - `uiStore` — theme, density, tool, selection, viewport, layout preset,
     overlay toggles (badges/flow/probes).
   - `simStore` — engine status chip, session state machine
     (`idle → connecting → ready → loaded → running(pause/live) → error`),
     active run metadata, analysis settings, last `RunStats`, error state.
   - `resultStore` — signal registry (`SignalInfo[]`), **ring buffers per
     signal** (Float32 display copy; Float64 retained on demand for
     measurements), decimation caches, run history (last 5 for overlay).
2. **The pipeline:** `RunHandle.onData` → `resultStore.append` → rAF
   consumers. **React never re-renders per chunk** — instruments subscribe
   with `useInstrumentFrame(handle)` (a helper that registers an rAF
   callback reading buffers imperatively). Store subscriptions that do
   trigger React (status chips, tables) are throttled (≥ 100 ms) selectors.
3. **Axis reconstruction** per analysis kind is a pure util
   (`src/sim/axis.ts`) with unit tests (AGENTS.md §5.2 — the axis is not
   transmitted; tran uses `tStart` + sample spacing rules documented there).
4. **Signal naming:** lowercase `v(out)`, `i(v1)`, `v(0)`; aliases for AC
   (`vm/vp/vdb/im` per master §4); UI display formatting maps these to
   pretty labels (`V(out)`, `I(V1)`) while keeping raw names as keys.
5. **Errors:** `EngineError {code, message, location{elementName?, node?,
   line?}}` → `simStore.error` → surfaces (§6.1 chip, F7 flows); never
   string-match messages; map via `Circuit.sourceMap`.
6. **Capability gating:** read `EngineInfo.capabilities/limits` once;
   hide/disable features not offered (feature-detect, never version-sniff).

---

## 8. Motion and interaction spec

- **Durations:** 80 ms (control feedback), 160 ms (panels, popovers,
  preset switches), 240 ms (large surfaces, dialogs); easing
  `cubic-bezier(.2,.8,.2,1)`; camera springs (critically damped, 220–320
  ms, interruptible); drag settle pulse ≤ 90 ms; **all disabled under
  `prefers-reduced-motion`** (global kill switch already in
  `index.css` — extend, keep).
- **Micro-interactions (the "chic" layer, used sparingly):** button press
  scale 0.98; value-change tick (2 px translate + fade); run-button
  progress ring; scope trigger flash; net-highlight pulse (2 iterations,
  then steady); badge value changes never animate (readability).
- **Sound:** none in v1.
- Focus states are always visible (2 px accent ring); no motion conveys
  information that is not also static (color + icon + text).

---

## 9. Accessibility and input

### 9.1 Rules

- WCAG 2.2 AA for all UI chrome (axe in CI, zero serious/critical).
- Color never the sole carrier: ERC severity = icon + text; traces = color
  + dash-pattern option + legend order; heat map has a numeric value in
  every badge.
- Canvas: full keyboard model — Tab cycles objects in reading order;
  arrows move selection by grid (Shift ×10); `Enter` edits; `Space+arrows`
  pan; `Home` fit; a virtual cursor follows keyboard selection.
- **Outline/tree view** (left dock tab): sheets → components → nets, in
  sync with canvas (bidirectional selection); doubles as the
  screen-reader map. ARIA live region announces run state and selection
  changes (throttled).
- Instruments: every control labeled; readouts are `aria-live=off` with a
  "read now" keystroke (`Ctrl+Alt+R` announces active measurement —
  renamed from sweep conflict to `Ctrl+Alt+S` if taken).
- Touch/pen: pan one-finger, tap select, long-press drag, pinch zoom;
  touch toolbar ≥ 44 px targets; phones are read-only viewers (banner
  offers "open on desktop for editing").

### 9.2 Default shortcut table (registry-generated; KiCad/Figma presets too)

| Action | Shortcut | Action | Shortcut |
|---|---|---|---|
| Command palette | `Ctrl/Cmd+K` | Run / Stop | `F5` / `Shift+F5` |
| Library quick-add | `A` | Pause/Resume · Step | `F6` · `F7` |
| Wire / Label / Text | `W` / `L` / `T` | Live toggle | `Ctrl+L` |
| Probe | `P` | Show voltages / currents / power | `Ctrl+Shift+V` / `+I` / `+P` |
| Move / Drag | `M` / `G` | Results table | `Ctrl+Shift+T` |
| Edit value / properties | `V` / `E` | Console | `Ctrl+\`` |
| Rotate / Mirror X/Y | `R` / `X` / `Y` | Zoom fit / 100 % | `Home` / `Shift+1` |
| Delete / Duplicate | `Del` / `Ctrl+D` | Toggle grid / snap | `Ctrl+G` / `Ctrl+Shift+G` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Highlight net | `` ` `` |
| Copy / Paste | `Ctrl+C/V` | Experiments menu | `Ctrl+E` |
| Export menu | `Ctrl+Alt+E` | Help / shortcuts | `?` |

Conflict rule: new features must adopt an unused chord or remap via the
registry; CI test asserts uniqueness of every binding.

---

## 10. Performance budgets (UI; CI-enforced where measurable)

From master §17, the UI-owned subset — budgets are gates, not aspirations:

| Metric | Budget |
|---|---|
| Initial JS (gzip, excluding lazy instruments) | ≤ 350 kB |
| Each lazy instrument chunk | ≤ 120 kB |
| Cold load → interactive | ≤ 2.5 s; cached ≤ 800 ms; Lighthouse Perf ≥ 90 |
| Drag pointer-to-photon (symbol) | ≤ 16 ms p95 |
| Pan/zoom 1,000 symbols + 3,000 wires | 60 FPS steady, no frame > 25 ms |
| Hit-test / snap lookup | < 0.5 ms @ 5,000 objects |
| Document load (5,000 objects) → first paint | < 400 ms |
| Undo/redo of a 500-object op | < 50 ms |
| Scope draw | ≥ 60 FPS @ 4 ch × 100k decimated points |
| Live mode UI | ≥ 55 FPS with 4 channels; knobs respond < 200 ms |
| Cross-probe click → trace visible | ≤ 1 frame + data lookup (no re-run) |
| Main-thread long tasks (> 50 ms) in journeys | 0 |
| 30-min live session | memory growth < 5 % |
| Worker crash recovery | detected < 1 s, restarted, project preserved |

Instruments load lazily (dynamic import per panel); the scope and renderer
never allocate in the frame loop (allocation benchmark); decimation runs
in a worker; all budgets verified with Playwright traces on the production
build (`e2e/perf.spec.ts`).

---

## 11. Visual QA — "looks right" for the UI (release gate per milestone)

Human-review checklist (extends master §21 from schematics to the whole
app). A milestone ships only when its surfaces pass:

1. Alignment: all panels/docks snap to the 4 px grid; no half-pixel edges
   at 100 %/200 % DPR; canvas hairlines are 1 device px.
2. Hierarchy: one primary action per region; accent used only for
   selection/primary/run; no competing glows or gradients.
3. Density: comfortable mode shows a full tran run's controls without
   scroll at 1366×768; compact mode ≥ 30 % denser.
4. Typography: mono for every changing number; no text truncation without
   tooltip; no orphaned labels.
5. States: hover/active/disabled/focus/loading/error are designed (not
   defaulted) for every interactive element.
6. Themes: dark/light/paper screenshots reviewed for every new surface;
   traces and heat map legible on all three.
7. Motion: nothing bounces twice; reduced-motion build shows zero
   animation (toggle in dev tools).
8. Empty → loading → error → populated: every panel has all four states
   designed and screenshot-tested.
9. Export (SVG/PDF/PNG in Paper theme) looks identical to the canvas.
10. Screenshot diffs reviewed for every PR that touches visuals (§12).

---

## 12. Testing strategy (UI)

| Layer | Tool | What |
|---|---|---|
| Unit | `bun test circuit-studio` | stores, formatters, axis reconstruction, measurement math (rms/rise/τ fit), snap/geometry, FSMs, command bus |
| Component | `bun test` + happy-dom + Testing Library | every `src/ui/` primitive and panel: render, keyboard, ARIA, theme class |
| Canvas/GPU logic | pure-function tests + Playwright | renderer behind `Renderer` interface; golden-image smoke in e2e |
| E2E | Playwright, production build | journeys 0–10 (master §13.5) + interaction specs (F1–F8) + perf traces |
| Visual regression | Playwright screenshots | symbols × themes × zoom; instruments; badges/overlays; layout presets |
| Accessibility | axe-core in Playwright | every route/panel; zero serious/critical |
| Performance | Playwright traces + allocation benchmark | §10 budgets; CI fails on regression |

Rules: tests colocated (`*.test.ts`); no sleeps (wait on signals);
injected `Clock` for time-dependent UI; deterministic seeds; a flake fixed
or quarantined within 48 h; every bugfix adds a failing-test-first case.

---

## 13. Milestones and task breakdown (the work order)

Conventions: task IDs are cited in commits (`feat(studio): UX3-T2 scope
cursors…`). Estimates: S ≤ 1 session, M ≈ 2–3, L ≈ 4+. **DoD per
milestone** = all tasks + acceptance gates + §11 checklist for touched
surfaces + `docs/progress.md` entry + push.

### UX0 — Design system, shell, and command foundation *(maps U1 pre-work, W0)*

**Goal:** the professional app frame everything else lands into.
**Tasks:**

| ID | Task | Done when |
|---|---|---|
| UX0-T1 | Full token set in `src/index.css` (§4.1) for dark/light/paper; `data-density`; fonts bundled (Inter, JetBrains Mono, IBM Plex Sans woff2 subsets) | tokens only, no hardcoded hex in components; contrast script green |
| UX0-T2 | `src/ui/` primitives (§4.3): Button, IconButton, Field/NumberInput, Select, Tabs, Panel, Tooltip, Popover, Menu, Toast, Badge, Chip, Kbd, EmptyState, Skeleton, ProgressBar, Splitter, ErrorState | component tests + snapshots per primitive |
| UX0-T3 | `format.ts` engineering/SI/unit/time formatters + parsers | exhaustive unit tests (1e-15…1e12 round trip) |
| UX0-T4 | Shell: dockview integration; regions A/B/D/E/F/G of §3.1; Build/Debug/Present presets; layout persistence | preset switch < 160 ms animation; canvas ≥ 50 % width guard |
| UX0-T5 | Command registry + palette (`Ctrl/Cmd+K`) + shortcut overlay (`?`); uniqueness CI test | every §9.2 binding registered; remap works |
| UX0-T6 | Engine chip + status bar (port from App.tsx); `sim/client.ts` switches to **worker transport** (W0 of AGENTS.md) with in-process override for tests | handshake via worker; e2e smoke green on prod build |
| UX0-T7 | Toast/error-boundary scaffolding (per-panel boundaries; diagnostics "copy" action) | a thrown instrument shows ErrorState, rest of app alive |
| UX0-T8 | Perf harness page + baselines recorded (`docs/perf-baseline.md` UI section) | §10 cold-load + shell budgets measured |

**Accept:** journeys 0 green on production build in Chromium; Lighthouse
Perf ≥ 90 on shell; three themes screenshot-reviewed.

### UX1 — Schematic editor experience *(maps U1+U2+U3)*

**Goal:** the Figma-smooth, KiCad-accurate editor (master §9 is the
behavioral source of truth; §6.2/6.3/6.4 the UX layer).
**Tasks (grouped; each with its unit/property tests):**

| ID | Task group |
|---|---|
| UX1-T1 | Renderer interface + GPU (Pixi v8/WebGL2) + Canvas2D fallback; layer stack; LOD text; DPR crispness; SVG export from scene graph |
| UX1-T2 | Camera (pan/zoom/inertia/springs/minimap) + performance test page |
| UX1-T3 | Spatial index (rbush), hit-testing, rubber band (both directions), lasso, selection filter |
| UX1-T4 | Tool FSMs; move/drag/detach; snapping + guides + indicators; auto-pan; settle animations |
| UX1-T5 | Wiring: routing modes (90/45/free), A* assist, junction semantics + normalization, no-connects, net highlight |
| UX1-T6 | Symbols: ≥ 60 ANSI+IEC defs + validator; multi-unit; field placement/auto-flip |
| UX1-T7 | Library palette UX (§6.3) + quick-add + favorites/recents |
| UX1-T8 | Inspector + in-canvas editing + scrubbing; command bus with transactions, undo/redo, copy/paste/array |
| UX1-T9 | Netlist extraction + incremental connectivity + `sourceMap`; ERC engine + panel + canvas markers + suggestions |
| UX1-T10 | Interactive component affordances (switch/pot/button/LED visuals) |

**Accept:** master U1–U3 gates (camera/drag budgets; connectivity property
tests; golden netlists; symbol visual regression) + journey 1 (build RC
from scratch, correct 63.2 % @ τ) + keyboard-only construction journey.

### UX2 — Simulation control and results plumbing *(maps W1–W3)*

**Goal:** press Run, get correct streamed results into stores; every
failure surfaces typed and located.
**Tasks:**

| ID | Task | Done when |
|---|---|---|
| UX2-T1 | `simStore` session FSM + `sim/controller.ts` (load/loadSpice/run/control; AGENTS.md §3 lifecycle, crash recovery, fresh-session rule) | state chart unit-tested; forced worker crash auto-recovers < 1 s with project intact |
| UX2-T2 | `resultStore` ring buffers + decimation caches + run history; `sim/axis.ts` reconstruction (tran/dc/ac) | axis unit tests match AGENTS.md §5.2 formulas; memory flat over 30-min sim soak |
| UX2-T3 | Run bar (§6.1): analysis selector with per-kind options, readouts, progress, method chip; keyboard F5/F6/F7 | buffered tran of RC template renders correct curve through resultStore; stop resolves `done` |
| UX2-T4 | `useInstrumentFrame` rAF helper + throttle utilities; "React never re-renders per chunk" proven by profiler test | profiler assertion in e2e |
| UX2-T5 | Error surfaces: EngineError → banner + ERC-style pinning via `sourceMap`; LoadResult warnings list; console panel (§6.6) | bad netlist shows line-pinned banner; no string-matching (type test) |
| UX2-T6 | Probes: place from tool rail, per-probe color/channel assignment, probes → `Circuit.probes` reload | probe appears as scope trace automatically (F3) |
| UX2-T7 | Experiments data layer (`experiments/` schema + registry) | schema validated; registry tested |

**Accept:** W1–W3 acceptance of AGENTS.md; journeys 1–2 assert numeric
values (63.2 % @ τ ±2 %; midband gain).

### UX3 — Oscilloscope and plots *(maps U4 part 1)*

**Goal:** laboratory-grade waveform viewing incl. the capacitor
charge/discharge flagship flows (§6.7).
**Tasks:**

| ID | Task | Done when |
|---|---|---|
| UX3-T1 | Scope core: uPlot integration, 8 channels, per-channel style/offset/invert, legend + measurement column | 60 fps @ 4×100k (trace test); theme variants |
| UX3-T2 | Timebase/position/auto; zoom box/pan; min-max envelope decimation (worker) | decimation unit + perf tests |
| UX3-T3 | Trigger engine (edge/level/Auto/Normal/Single/holdoff) + trigger glyph + flash | deterministic against recorded streams |
| UX3-T4 | Cursors X1/X2/Y1/Y2 + Δ readouts + snap + numeric entry; measurement suite (Vpp/Vmax/Vmin/Vavg/Vrms/f/duty/rise/fall/overshoot) with unit tests against synthetic waveforms | values exact on fixtures (e.g., known sine/step) |
| UX3-T5 | Math channels (A±B, A×B, ∫, d/dt, custom via `evaluate`) | context wiring tested |
| UX3-T6 | Bode plotter (§6.7.2) with −3 dB/margins/crossover; DC sweep plotter (§6.7.3); X-Y view; spectrum (FFT w/ windows, THD) | Sallen-Key Bode matches reference within tolerance in e2e |
| UX3-T7 | **Experiments (§6.7.4):** RC charge, RC discharge, RLC step, integrator, LC resonance, diode IV — recipes + annotations + callout cards; "Estimate τ from cursor" least-squares fit | RC journey: 63.2 % marker at τ within 2 %; τ fit within 5 % of R·C on fixture |
| UX3-T8 | PNG/CSV export from every plot; plot run-history overlay (last 5) | export bytes validated |

**Accept:** gallery circuits 1–12 end-to-end through the UI; journey 3
(live frequency change, no phase jump) green; U4 instrument budgets met.

### UX4 — Measurement surfaces: every node, every element *(maps U4 part 2 + §9.11)*

**Goal:** the hard requirement — V/I/P of everything, everywhere, ≤ 2
interactions (§6.5).
**Tasks:**

| ID | Task | Done when |
|---|---|---|
| UX4-T1 | Results table (§6.5.1): nodes/elements/sources groups, sparklines, plot/meter/pin actions, CSV, bidirectional selection sync | populated for OP and at-cursor for tran/live; cross-probe ≤ 2 clicks |
| UX4-T2 | Voltage badges + heat map layer (collision-avoiding placement) | visual regression; heat legend shown; toggles persist |
| UX4-T3 | Current arrows + power badges; live updates per frame | correct signs on fixture (charging cap: +I direction flips at peak) |
| UX4-T4 | Hover tooltips (node/element cards) + pinning; cross-probe chips on click | tooltip content matches Results table |
| UX4-T5 | Current-flow overlay (GPU, speed ∝ log|I|) | visual + perf test; off in Build, on in Debug/Present |
| UX4-T6 | Multimeter + power meter panels (§6.5.5) incl. AC rms, R @ OP, frequency; pinned readouts | values match scope math on fixtures |
| UX4-T7 | Inspector Measurements section per device family (§6.4) incl. C: τ estimate, E=½CV²; L: energy | τ shown for RC template matches experiment annotation |
| UX4-T8 | Keyboard/ARIA for all measurement surfaces; `Ctrl+Shift+V/I/P` toggles | axe clean on panels |

**Accept:** F4 script e2e: run → toggle badges → click wire → Alt-plot;
OP of RC template equals hand calculation within tolerance; journey 9
(keyboard-only) still passes.

### UX5 — Live interactive mode *(maps W4 + §10.3 + §9.7)*

**Tasks:**

| ID | Task | Done when |
|---|---|---|
| UX5-T1 | Live toggle + speed control + roll mode + pause/step integration | live run visible in scope roll; step advances one chunk |
| UX5-T2 | Function generator panel (§6.8) with knobs/readouts/thumbnails; live retune via `setParam` (phase-continuous) and `setExternal` channels | journey 3: frequency change shows no discontinuity; retune latency < 200 ms |
| UX5-T3 | Canvas interactive components: switch/button/pot/LED live via `setParam`; knob drag + radial capture | toggle + pot journeys (master 13.5 #4) < 200 ms response |
| UX5-T4 | Live badges/flow overlays + inspector Measurements streaming | values update per frame; no React per chunk |
| UX5-T5 | Backpressure UX: decimation indicator; "engine busy" state; drop policy visible in console | UI never freezes under slow-consumer test |

**Accept:** W4 acceptance of AGENTS.md; 30-min live soak (memory < 5 %).

### UX6 — Dashboard, data table, sweeps polish *(maps §10.1 + §6.7.5)*

**Tasks:** widget framework + edit mode (UX6-T1); big-number/gauge/bar/
sparkline/LED/status widgets with bindings (UX6-T2); dashboard persistence
+ presets per gallery circuit (UX6-T3); parameter sweep builder + overlay
scrubbing + matrix CSV (UX6-T4); data table virtualized view (UX6-T5).
**Accept:** build a Debug dashboard from widgets for the buck-converter
gallery circuit; sweep C1 1n→100n overlays 6 Bode traces.

### UX7 — Onboarding, persistence, polish, a11y, i18n, PWA *(maps U5)*

**Tasks:** gallery landing + 26 circuits wired (UX7-T1); first-run tour +
empty states + hints (UX7-T2); project save/load/migrations/autosave/recovery
+ version history browser (UX7-T3); SPICE import auto-layout + banner
(UX7-T4); export suite (SVG/PNG/PDF/BOM) (UX7-T5); themes/accents/
high-contrast + density polish (UX7-T6); full a11y pass + touch toolbar
(UX7-T7); i18n scaffolding (react-i18next, strings externalized, RTL
ready) (UX7-T8); PWA/service-worker safe-update flow + offline gallery
(UX7-T9); error boundaries + diagnostics everywhere (UX7-T10); presentation
mode (UX7-T11).
**Accept:** master U5 gates — all journeys in 3 browsers; axe zero
serious/critical; Lighthouse PWA + a11y ≥ 90; "looks right" (§11) signed
off on all reference screenshots.

### UXR — Hardening and release (UI) *(maps R1 UI portion)*

**Tasks:** soak/crash-recovery verification (UXR-T1); §10 budget
verification + traces on reference hardware + low-end profile (UXR-T2);
security headers/CSP on the static host (UXR-T3); UX test script with 5
timed tasks run on 3 people or documented simulations (UXR-T4); docs
(user guide, cookbook ≥ 20 recipes, compatibility table) (UXR-T5);
release checklist evidence (§16) (UXR-T6).
**Accept:** master §20 "Quality / Usability / Performance" blocks fully
checked with evidence links.

---

## 14. Traceability matrix (abridged)

| Master SPEC | This spec | Milestone |
|---|---|---|
| §8.1 stores / §8.2 pipeline / §8.4 run bar | §7, §6.1 | UX2 |
| §9.1–9.5 rendering/camera/selection/DnD/wiring | §6.2, §5 F2 | UX1 |
| §9.6–9.7 symbols/interactive | §6.3, §6.2.5 | UX1 |
| §9.8–9.9 extraction/ERC | §6.2, F7 | UX1 |
| §9.10 shortcuts / §9.11 editing+annotations | §9.2, §6.4 | UX0/UX1/UX4 |
| §9.12 visual design | §4 | UX0 (tokens), all |
| §10.1 layout + widgets | §3.2, §6.9 | UX0/UX6 |
| §10.2 scope | §6.7.1 | UX3 |
| §10.3 generator | §6.8 | UX5 |
| §10.4 other instruments | §6.7.2–6.7.3, §6.5.5 | UX3/UX4 |
| §11 persistence | §6.10, F8 | UX7 |
| §13.5 journeys | §5 F1–F8 | per milestone |
| §17 budgets | §10 | UX0 baseline → UXR verify |
| §18.1 a11y / §18.2 i18n | §9 / UX7-T8 | UX7 |
| §21 looks-right | §11 | every milestone |
| AGENTS.md W0–W4 | UX0-T6, UX2, UX5 | — |

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dockview/React 19 integration surprises | spike in UX0-T4; fallback `flexlayout-react` per master §3.1 via the `PanelHost` seam |
| GPU renderer scope creep | `Renderer` interface + Canvas2D fallback from day one (UX1-T1); budgets enforced before polish |
| Badge/overlay perf at scale | GPU overlay pass + culling + decimation; budget test in UX4 |
| Scope jank with 100k points | worker decimation + LTTB/min-max; perf gate UX3-T1 |
| τ annotation wrong on non-first-order circuits | honesty rule (§6.7.4): detect and skip with explanation |
| Live retune latency | breakpoint insert already engine-side; measure in UX5; degrade knob step granularity |
| A11y of canvas-heavy UI | outline/tree view + keyboard model are UX1/UX4 deliverables, not an afterthought |

---

## 16. Definition of done (UI track release gate)

- [ ] All milestones UX0–UX7 + UXR accepted with evidence in
      `docs/progress.md` and release checklist links.
- [ ] Journeys 0–10 green in Chromium, Firefox, WebKit (production build).
- [ ] §10 budgets verified and recorded; 30-min soak green.
- [ ] axe zero serious/critical; keyboard-only pass recorded; three
      themes + reduced-motion reviewed.
- [ ] §11 "looks right" signed off for every instrument and all reference
      schematics.
- [ ] Bundle budgets green (initial ≤ 350 kB gzip; instruments ≤ 120 kB).
- [ ] Docs: user guide + cookbook + compatibility table + in-app tour.
- [ ] No P0/P1 open; every bugfix has a regression test.

---

## Appendix A — Signal naming quick reference

Raw keys (engine, lowercase): `v(<node>)`, `i(<element>)`, `v(0)` ground;
AC aliases `vm(<node>)`, `vp`, `vdb`, `im(<element>)`. Display labels:
`V(out)`, `I(R1)`, `V(C1:1)−V(C1:2)`; unit from kind (`v`→V, `i`→A, `p`→W
when derived). See AGENTS.md §5.4 for the exact names a run returns.

## Appendix B — Default measurement set

Scope auto-measurements default: Vpp, Vmax, Vmin, Vrms, frequency. Cursor
defaults: X1/X2 with Δt, 1/Δt. Results-table sparkline window: last run.
Power meter defaults: average over full run; energy cumulative since run
start.

## Appendix C — Component inventory checklist (v1 app)

Shell: title bar · tool rail · library dock · canvas · inspector dock ·
instrument dock (scope, bode, dc-sweep, spectrum, xy, generator, meters,
results table, data table, console) · run bar · status bar · command
palette · shortcut overlay · experiments menu · sweep builder · toasts ·
diagnostics drawer · tour · gallery · version-history browser · PWA
update banner. Each item: designed states (§11.5) + theme screenshots +
a11y + owner milestone.


