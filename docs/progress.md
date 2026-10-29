# Progress

One entry per milestone or notable change, newest first (SPEC §22).

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
