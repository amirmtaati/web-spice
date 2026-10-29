# Progress

One entry per milestone or notable change, newest first (SPEC §22).

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
