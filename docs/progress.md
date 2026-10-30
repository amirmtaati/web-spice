# Progress

One entry per milestone or notable change, newest first (SPEC §22).

## UI/UX specification and agent kickoff prompt for circuit-studio (2026-10-31)

**Status: complete.** Documentation only (no UI code yet, by design); the
UI track now has a full work order with milestones and task tables.

- **`circuit-studio/UI-UX-SPEC.md`** — the professional UI/UX
  specification (v1.0) expanding master SPEC §8–11 and the U1–U5/R1
  milestones into an agent-executable work order: Studio DS design system
  (full token set, 3 themes, trace palette, typography, motion), app shell
  and layout presets (Build/Debug/Present), command system, 8 core
  experience flows, and feature specs with special depth on the two hard
  product requirements — (1) per-node/per-element voltage & current
  visibility (Results table, voltage badges with heat map, current arrows,
  power badges, hover tooltips, cross-probing, current-flow overlay,
  multimeter/power meter, per-device measurement readouts) and (2)
  waveform graphs including capacitor charge/discharge with τ annotation
  presets ("Experiments": RC charge/discharge, RLC step, integrator, LC
  resonance, diode IV; least-squares τ estimation from cursors).
  Milestones **UX0–UX7 + UXR** with task tables (UXn-Tk), acceptance
  gates, performance budgets, a11y/keyboard contract, testing strategy,
  traceability matrix, risks, and release-gate DoD; reconciled with
  `circuit-studio/AGENTS.md` W0–W4 and master U1–U5.
- **`circuit-studio/UI-AGENT-PROMPT.md`** — the copy-paste kickoff prompt
  for the implementing agent (reading order, working rules, gates,
  start-at-UX0).
- Cross-linked: `circuit-studio/AGENTS.md` §0 now scopes itself to the
  wire contract and defers UX/sequencing to the new spec; app README
  lists both entry documents.

## UI handoff — engine-integration spec for circuit-studio (2026-10-30)

**Status: complete.** No UI code written (per plan: the U-track implements
it); the directory now carries the contract an implementing agent needs.

- **`circuit-studio/AGENTS.md`** — self-contained UI ⇄ engine spec written
  against the shipped E4 API: transport selection (worker default with the
  Vite `?worker&url` wrapper pattern, WebSocket, in-process for tests),
  session lifecycle and recovery semantics (worker crash / socket close ⇒
  fresh session, reconnect + reload), protocol message reference, the
  data pipeline (axis reconstruction per analysis kind, ring-buffer rules,
  "React never re-renders per chunk"), live interaction (`setParam`
  targets and timing, phase continuity, `setExternal` scalar/series), the
  full error-code table with location pinning via `Circuit.sourceMap`, a
  Circuit-IR cheat sheet for netlist extraction, capabilities/limits
  feature-detection, worked TypeScript examples, testing layers
  (conformance suite, e2e, manual server), and a phased plan (W0–W4) with
  acceptance criteria mapped to the U milestones.
- **Enabling change:** `@spicekit/client` now exposes its worker entry as a
  subpath export (`@spicekit/client/worker-entry`) so the documented Vite
  worker-wrapper import resolves through the package `exports` map
  (additive; runtime API surface unchanged, snapshot unaffected — verified
  resolvable from the circuit-studio workspace).
- **Known gaps documented honestly** (§13 of the spec): per-run `probes`
  accepted but engine filters via circuit probes only; no axis column in
  `data` (reconstruction formulas per analysis kind documented);
  `progress.fraction` is 0 for live runs; transport loss rejects in-flight
  requests only via the 10 s timeout — recovery is reconnect + reload.

## E4 — Client, transports, server, live mode (2026-10-30)

**Status: complete.** The engine talks to the web UI: a stateful engine
session behind the message protocol, real worker/WebSocket/in-process
transports, live interactive transients, `@spicekit/server`, sparse LU,
chaos tests, API snapshot, embedding guide, Docker (SPEC §22 E4).

### What landed

- **Engine session** (§4.3/§4.4): `EngineSession` — the stateful engine
  side of the protocol. Loading (IR + netlist), buffered runs, live
  transient runs advanced in wall-clock chunks (~16 ms) with an injected
  `SessionClock` (core stays timer-free; hosts pass `hostClock()`),
  `control` pause/resume/step/stop, `setParam` (order reset + breakpoint,
  SPEC §4.4 restart), `setExternal` via a zero-order-hold channel
  registry, `evaluate`, `exportSpice`. Every reply correlates by request
  id; async tick events flow through the stable reply sink.
- **Live engine primitives** (§4.4): `TranStepper` — resumable transient
  driver shared by batch and live paths (chunked advance is
  sample-identical to one batch run); phase-continuous SIN retuning
  (frequency changes fold ω·Δt into a frozen anchor — no phase glitch by
  construction, retry-safe between retunes); PULSE duty-cycle retune;
  device `setLiveParam` hooks (R/C/L value, source amplitude/frequency/
  offset, switch state override); `EXTERNAL(chan)` waveform parsing,
  serialization, and channel registry.
- **Transports** (§2.1/§6): in-process transport now hosts the REAL engine
  (the P0 stub is gone); worker transport with a module-worker entry,
  crash detection (<1 event-loop turn) + respawn, zero-copy transfer of
  large sample buffers; WebSocket transport with capped-backoff
  auto-reconnect and typed disconnect errors. `createInProcessClient`/
  `createWorkerClient`/`createWebSocketClient` all return
  `SimulatorClient`; `connect()` opens the transport before the handshake.
- **Conformance suite** (§6): 10 checks over every transport — handshake
  capability/limits, node/branch tables, typed errors for bad netlists,
  buffered op with exact divider value, tran streaming, live streaming
  with `setParam` ack + stop, evaluate, exportSpice, idempotent-safe
  second handshake. Green on in-process, worker, and WebSocket.
- **`@spicekit/server`** (§7.1): `Bun.serve` WebSocket host — one Bun
  `Worker` per connection (runs never on the event loop, bounded by
  `maxConnections`), zod-validated frames (unknown/invalid → close 4400),
  token-bucket rate limits (→ 4409), `maxPayloadLength` (→ 1009/1006),
  backpressure check on send, origin allow-list + optional bearer token on
  the upgrade, `/healthz`, `/readyz` (503 at capacity), Prometheus
  `/metrics` (runs started/completed/failed, connections, messages,
  timesteps, p95 run latency), graceful SIGTERM (close sockets 1001,
  terminate workers, stop accepting). Env config via zod, fail fast.
- **Chaos suite**: malformed JSON, invalid protocol messages, oversized
  frames, 400-message rate-limit bursts, abrupt client vanish mid-live-run
  (server stays healthy, connections drop to zero, a fresh connection runs
  end-to-end), auth/origin rejections.
- **Sparse LU** (§5.4 stage 2): `SymbolicLU` (Markowitz order + fill
  accounting, once per pattern) + `SparseLU` (numeric refactor in the
  reused order with threshold partial pivoting). Property-tested against
  the dense kernel on random sparse systems, reuse accounting, singular
  reporting, circuit-scale pattern.
- **Protocol 0.2.0** (additive): `ack` message for control/setParam/
  setExternal; EXTERNAL waveform parses/serializes.
- **Hygiene**: API snapshot test (§4.5) pinning protocol/core/client
  exports; `docs/embedding.md` (plain JS / React / Vue + live mode +
  WebSocket protocol guide); multi-stage Dockerfile (pinned oven/bun,
  production deps, non-root, HEALTHCHECK, SIGTERM); CLI `serve` and
  `convert` commands (both tested end-to-end).

### Verification (SPEC §22 E4 acceptance)

- **441 tests green** (13,500+ expect calls) across 37 files; `tsc -b`,
  biome, type-aware ESLint, dependency-cruiser (273 modules) all clean.
- **Conformance green on all transports**: in-process, real Bun Worker,
  and WebSocket against real `Bun.serve` (browser runs — the suite is
  transport-agnostic and wired for the Playwright browser harness; CI
  matrix for Chromium/Firefox/WebKit is the remaining CI-side step).
- **Live frequency change shows no phase glitch**: waveform-level test
  (retune 1 kHz → 500 Hz mid-run; max adjacent-sample jump stays at the
  smooth-slew bound) plus session-level continuity through `setParam`.
- **Docker image**: Dockerfile provided (build + Trivy scan job is a CI
  follow-up); packed-tarball embedding smoke for Node is a CI follow-up —
  workspace embedding is covered by the client test suite.

### Deferred / next up

- CI: browser conformance matrix (Worker in Chromium/Firefox/WebKit),
  Docker build+scan job, packed-tarball smoke (Bun/Node/browser bundle).
- Workspace switchover to the sparse solver (pattern emitted by the
  compiler, §5.2) — the standalone module is tested and exported.
- U1: rendering, camera, selection (UI track).

## E3 — AC, noise, behavioral (2026-10-30)

**Status: complete.** Complex solver, `.ac`, `.tf`, `.noise`, behavioral B
sources with AD, subcircuits, basic `.measure`, `evaluate` message
(SPEC §22 E3).

### What landed

- **Complex LU** (§13.2.1): `Complex` value type, complex LU factor/solve
  with the same zero-hot-path-allocation discipline as the real kernel;
  1/z gmin on every node for AC singularity robustness.
- **`.ac` analysis** (§5.5): dec/lin/oct sweeps with ngspice point counts,
  AC source phasors (independent V/I, B linearized), linear devices
  (R/C/L/K/E/F/G/H, switches at their OP state) stamped directly in ℂ;
  probe aliases `vm/vp/vdb/im` on AC results.
- **Nonlinear AC linearization** (§5.5): every D/Q/M/J/S/W is linearized
  about its DC operating point (transconductance + junction/parasitic
  capacitance stamps) so real circuits — diode mixers, CE stages, CMOS
  inverters — get correct small-signal responses.
- **Behavioral B sources** (§5.7): arbitrary expressions of node
  voltages/branch currents/time with exact derivatives via dual-number
  automatic differentiation (no hand-coded Jacobians); DC, transient and
  AC (operand-linearization) support; tables, `pwrs`, tempco math.
- **Subcircuits** (§5.2/§5.7): `.subckt/.ends` flattening with classic
  SPICE hierarchy — positional port mapping, path-prefixed names
  (`x1.x2.r3`), ngspice parameter order (instance overrides → subckt
  defaults → global `.param`), model hoisting with instance-frozen
  expression models, nesting to depth 64 / 50k element caps. Built-in
  op-amp macromodels `OPAMP_IDEAL` and `OPAMP1P` (A0/GBW/ROUT/RIN).
- **`.tf`** (§5.5): transfer function V(n_out)/V(n_in) or I(n_in) with
  input and output resistance, via one complex solve per driven port.
- **`.noise`** (§5.5): input- and output-referred noise spectra via the
  adjoint method; thermal (R), shot + flicker (D/Q/M/J) noise models;
  `inoise`/`onoise` spectra and integrated values.
- **`.measure`** (§5.5 "basic"): FIND AT, FIND WHEN [RISE|FALL|CROSS[=n]],
  MAX/MIN/AVG/RMS/PP/INTEG with FROM/TO windows, interpolated crossings,
  AC probe-alias lookup, `found=false` + NaN for unmatched conditions.
- **`evaluate` message** (§4.3/§5.6): engine-side expression evaluation
  through the same expression compiler used by `.param`/B sources;
  case-insensitive `v()`/`i()` context lookups, parameter table, `time`;
  typed `E_PARSE` errors; wired through client + stub engine with
  conformance tests.
- **Hygiene**: ESLint `switch-exhaustiveness-check` restored on
  `.measure` window modes; 9 unnecessary type assertions removed
  (eslint --fix); biome formatting normalized.

### Acceptance (SPEC §22 E3)

- **Active-filter Bode matches reference**: Sallen-Key unity-gain LPF
  (equal R/C, built-in op-amp macromodel) — nodal analysis gives exactly
  `H = 1/(1 + j·u)²`, `|H| = 1/(1+u²)`. Engine matches the hand formula
  to <1e-4 relative across a 2.3-decade sweep; |H| crossings land at
  0.5→f0 (Q signature), 1/√2→√(√2−1)·f0 (−3 dB), 1/101→10·f0 (−40 dB/dec);
  `vdb` crosses −6.0206 dB at f0.
- **Op-amp macromodel GBW verified**: OPAMP1P ×10 non-inverting stage
  matches the exact closed-loop model `|kl·A(f)|/|1 + β·kl·A(f)|` to
  <1e-4 across 1 kHz–10 MHz; DC gain ≈ 10; measured f3dB × |H_DC| =
  GBW within 1% (gain-bandwidth product constant).

### Verification

- **120 E3 tests** (complex 6, ac 13, ac-nonlinear 7, tf 7, noise 7,
  bsource 48, subckt 13, measures 5, evaluate 6, acceptance 5, compiler
  +1, client conformance +2) — full suite **395 green** / 12,082
  expect() calls.
- Gates: biome clean, ESLint clean (type-aware), `tsc -b` clean,
  dependency-cruiser clean (251 modules, 576 dependencies).

### Deferred / next up

- E4: client transports (Worker/WebSocket), conformance across
  transports, streaming, live `setParam`/`setExternal`, sparse LU with
  symbolic reuse, `@spicekit/server`, chaos/resource-limit tests,
  embedding examples.
- ngspice golden-fixture pipeline (pinned ngspice) — infrastructure
  ready, fixtures pending.

## E2 — Nonlinear devices (2026-10-29)

**Status: complete.** D, BJT, MOSFET L1, JFET, switches; Newton with
junction limiting; the full OP fallback ladder; device model library
(SPEC §22 E2).

### What landed

- **Diode (D)** (§5.7): Shockley junction, series resistance (anchored
  composite stamp), ngspice reverse generation current, matched-knee
  breakdown, junction + diffusion capacitance, area scaling, temperature
  (XTI/EG), pnjlim limiting.
- **BJT (Q)** (§5.7): Ebers-Moll transport with Early factor q1, NPN/PNP
  voltage mirroring, junction/diffusion caps, parasitic RB/RC/RE via real
  internal MNA nodes (b'/c'/e' — ngspice-44 structure; replaces the
  ill-conditioned folded-composite reconstruction whose 2×2 Newton hit
  determinant cancellation → NaN from cold starts).
- **MOSFET L1 (M)**: Shichman-Hodges square law with bulk threshold,
  channel-length modulation, Meyer capacitances, bulk junction diodes.
- **JFET (J)**: square-law with gate-junction diodes, area scaling.
- **Switches (S/W)**: voltage/current controlled state machines with
  hysteresis memory, ngspice swload semantics, smooth-transition
  log-linear conductance option, state-flip-driven re-solves.
- **Newton with limiting** (§5.5): device `limit` hooks (pnjlim/fetlim/
  limvds ports of ngspice devsup.c) evaluated before every stamp; `gmin`
  on every nonlinear branch.
- **OP fallback ladder** (§5.5): direct Newton → gmin stepping
  (10 decade stages) → source stepping (10 stages) → pseudo-transient
  homotopy (per-node BE capacitor, geometric pseudo-time, reltol-steady
  stop, final plain-Newton validation). ngspice-compatible knobs:
  `.options noopiter=1`, `gminsteps=`, `srcsteps=` (0 skips a rung).
  The winning rung is reported in `stats.opMethod`.
- **Model library** (§5.2): parameter schemas with units/defaults/aliases
  for d/npn/pnp/nmos/pmos/njf/pjf/sw/csw; long-spelling canonicalization
  (`diode`→`d`, `vswitch`→`sw`, `iswitch`→`csw`); E_BAD_MODEL on
  element/type mismatch; W_MODEL_PARAM_UNKNOWN warnings for typo'd card
  parameters (previously silently ignored); BUILTIN_MODEL_CARDS
  (d_ideal, d_signal, npn/pnp/njf/pjf_generic, nmos/pmos_5v, nmos_4000,
  sw_fast, csw_fast) resolvable without a `.model` card — netlist cards
  win on name collision.

### Verification (SPEC §13)

- **276 tests green** (protocol/core/client/cli). Per-device taxonomy:
  analytical (hand-derived closed forms), reference (independent
  bisection/divider arithmetic), property (KCL residuals, monotonicity,
  polarity symmetry, area/β/Early scaling), convergence (cold starts,
  state flips, stiff diode chains, 100 V walk).
- **Acceptance fixtures**: series half-wave rectifier with RC filter,
  CE amplifier (bias + amplified sine swing), CMOS inverter VTC,
  3-stage ring oscillator in transient — all pass end-to-end through
  `simulateNetlist`.
- **Fallback-ladder hard tests**: bistable CMOS latch cross-rung
  consistency (all four rungs agree on the operating point);
  pseudo-transient end-to-end diode bias; an astable switch relaxation
  circuit with no DC fixed point that exhausts every rung into a named
  E_NO_CONVERGENCE diagnostic.
- **NaN hardening**: convergence tests reject non-finite iterates
  (NaN previously read as converged); diodeConduction caps the
  exponential argument so no un-limited path can overflow to Infinity.
- Gates: biome, type-aware ESLint, `tsc -b`, dependency-cruiser
  (232 modules) — all clean.

### Protocol additions (additive, backward-compatible)

- `SimOptions.noopiter?`, `SimOptions.gminsteps?`, `SimOptions.srcsteps?`
  (zod-validated, default 10/10 when unset); error code `E_BAD_MODEL`.

### Deferred / next up

- ngspice golden-fixture pipeline (§13.2.2) — infrastructure ready.
- E3: AC/noise/behavioral (complex solver, `.ac`/`.tf`/`.noise`, B
  sources with AD, subcircuits, `.measure`).


## 2026-10-29 — P0: Foundations scaffold (partial — files in place)

**Done**

- Monorepo `web-spice` scaffolded as a single Bun workspace containing both
  projects (deviation from the two-repo layout recorded in ADR-002).
- Toolchain pinned: Bun **1.3.14** (`.bun-version`, `packageManager`).
- Configs: `tsconfig.base.json` (strict per SPEC §3.5) with project references;
  Biome; type-aware ESLint (no overlap with Biome); dependency-cruiser
  architecture rules; knip config; commitlint + lefthook; `.editorconfig`.
- CI (`.github/workflows/ci.yml`): static (biome/eslint/tsc -b/depcruise),
  `bun test`, UI production build, browser-target bundle check of
  runtime-agnostic packages, non-blocking `bun audit`.
- `@spicekit/protocol`: `PROTOCOL_VERSION` (0.1.0), Circuit IR types, zod
  message schemas, stable error codes + `EngineError`, capabilities/limits,
  round-trip test.
- `@spicekit/core`: package skeleton (parser/compiler/solver/analyses/devices/
  math), **working engineering-suffix parser + dense LU with partial pivoting**
  (tested), analysis/device interfaces stubbed.
- `@spicekit/client`: `SimulatorClient`/`RunHandle` API, Transport interface,
  in-process transport + **stub engine**, worker/websocket transport stubs,
  `runClientConformance` suite (passing against the in-process stub).
- `@spicekit/server`: `Bun.serve` skeleton with `/healthz`.
- `@spicekit/cli`: entry with `run|check|serve|convert` subcommand surface
  (stubs).
- `@spicekit/testing`: circuit builder + tolerances.
- `circuit-studio`: Vite + React 19 + Tailwind 4 shell — header with engine
  status chip (performs a real in-process handshake on mount), run bar
  placeholder, canvas placeholder, theme scaffold (dark/light/paper tokens),
  `sim/` as the only `@spicekit/client` importer, module READMEs, Playwright
  smoke test (browsers not installed yet).
- Docs: SPEC committed at `docs/spec/SPEC.md`; ADR-000 template, ADR-001
  (Bun toolchain), ADR-002 (scaffold decisions); `AGENT.md`; PR template;
  `SECURITY.md`; `README.md`.

**Deferred / stubbed (next up)**

- Golden-fixture generator + ngspice reference pipeline (E1).
- Coverage threshold enforcement script (E1) — reporting already configured.
- Worker transport end-to-end + UI dockable layout (`dockview`) + themes UI
  (next on P0 completion list, SPEC §22 P0 acceptance).
- Playwright browser installs + the three-browser engine suite harness.
- knip/audit as blocking gates once the stub surface shrinks.

**Acceptance status (P0)**: trivial change flows through the full pipeline ✔
(CI stages defined); negative Bun/Node-import test ✔ (ESLint + CI bundle
check); trivial analytical test under `bun test` ✔ — in three browsers ⏳
(harness pending); UI shell handshake ✔ (in-process; worker mode pending).

---

## E1 — Linear DC and transient engine (2026-10-29)

**Status: complete.** The engine section (SPEC §5) now implements the full
E1 milestone: parse → compile → solve, with an analytical + property + fuzz
verification suite.

### What landed

- **Expression evaluator** (§5.6): tokenizer + recursive-descent compiler to
  closures (never `eval`/`new Function`). Operators, comparisons, ternary,
  the §5.6 function set (`sin`…`uramp`, `if`, `table`), constants (`pi e q k
  T`), `time`, `v()`/`i()` accessors, `.param` scopes with lazy resolution
  and cycle detection. Strict expression numbers (`2pi` is an error).
- **Netlist parser** (§5.1): card lexer with 1-based line/column diagnostics,
  continuation lines, `*`/`;` comments, element cards R/C/L/K/V/I/E/G/F/H
  (+ D/Q/M/J parse for E2), SIN/PULSE/PWL waveforms (paren and bare forms,
  continuation-spanning, PWL `REPEAT`), directives `.param .model .subckt/
  .ends .options .op .dc .tran .ac .ic .print/.probe .end`, optional host
  `IncludeResolver` for `.include`. Serializer with bit-exact number
  formatting (`formatExact`) → round-trip `parse(serialize(ir)) === ir`.
- **Compiler** (§5.2): param/`{expr}` resolution, case-insensitive node
  indexing ("0" = ground), branch-unknown allocation (V/L/E/H) with
  allocation-index → MNA-offset shift, pre-flight checks with typed located
  errors: duplicate names, `E_NO_GROUND`, `E_FLOATING_NODE` (no DC path via
  R/L/V/E/H), `E_VSOURCE_LOOP` (union-find over V/E/H-bridged nodes),
  `E_UNKNOWN_MODEL`, F/H control resolution, K coupling sanity,
  `E_LIMIT_EXCEEDED` (50k elements/nodes), explicit `E_NOT_IMPLEMENTED` for
  B/S (E2) and X (E3).
- **Device library** (§5.3/§5.7): uniform `Device` stamping contract
  (`devices/base.ts`, hub-cycle-free). R (temperature coefficients), C and
  L (BE/trap/Gear-2 companion models + trapezoidal LTE estimates), K
  (mutual coupling cross-terms on partner branch rows, all three methods),
  V/I (DC + waveform evaluation + breakpoint enumeration), E/G/F/H (SPICE
  sign conventions verified against hand-worked circuits).
- **Analyses** (§5.5): OP (Newton loop structure, E2 fallback-ladder seam),
  DC sweep (single + nested, per-point restamp), transient with adaptive
  LTE stepping (`trtol`), growth limits, `tmax`, exact landing on output
  grid + source breakpoints, BE-for-2-steps after events (trapezoidal
  ringing mitigation), `uic` via BE micro-step initial solve, samples and
  snapshots as `Float64Array`s.
- **Engine facade + CLI** (§7.2): `loadCircuit`/`simulateCircuit`/
  `simulateNetlist`/`describeError`; `spicekit check` (tables + warnings,
  exit codes) and `spicekit run` (table/`--csv`/`--json`).

### Verification (SPEC §13)

- **169 tests green** across protocol/core/client/cli: analytical suite
  (dividers, bridge, dependent-source sign conventions, RC/RL/RLC closed
  forms, 63.2% at τ, LC energy conservation against the exact `e^{−Rt/L}`
  envelope), integration-method ordering (trap ≪ BE error), breakpoint
  landing, determinism (bit-identical reruns), device stamp algebra vs
  hand-derived MNA entries, waveform shapes/breakpoints, mutual
  aiding/opposing `(L1+L2±2M)·dI/dt`.
- **Property tests** (§13.3, seeded PRNG — zero-dep decision, ADR-003):
  KCL residual < milliamp-scale on 50 random passive networks, element
  reordering invariance, impedance-scaling invariance, `formatExact`
  bit-exact round trip (2000 values across 1e-15…1e12).
- **Parser fuzzer** (§13.4): 6000 random/mutated inputs — every failure is
  a typed `E_PARSE`, never a crash or hang.
- Gates: biome clean, ESLint clean (type-aware), `tsc -b` clean,
  dependency-cruiser clean (205 modules — device/compiler cycles removed
  via `devices/base.ts` + `compiler/types.ts`), UI production build green.

### Protocol additions (additive, backward-compatible)

- `ErrorLocation.column?`, error codes `E_NO_GROUND`; `Circuit.ic?` for
  `.ic v(n)=value`.

### Deferred / next up

- ngspice golden-fixture pipeline (150+ netlists) — infrastructure ready,
  fixtures to be generated with a pinned ngspice (§13.2.2).
- Coverage thresholds enforcement (tooling configured).
- E2: nonlinear devices (D/BJT/MOS/JFET/switches), junction limiting,
  gmin/source stepping fallback ladder, model library.
- knip config refinement (remaining flags are intentional public-API
  re-exports), fast-check adoption decision (ADR), browser-suite harness.
