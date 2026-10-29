# ADR-001: Bun is the toolchain and server runtime; browsers are the product runtime

- **Status:** accepted (mandated by SPEC §3.1; recorded at scaffold time)
- **Date:** 2026-10-29
- **Deciders:** amirmtaati, coding agent

## Context

The project needs one toolchain for package management, workspaces, scripts,
tests, library bundling, a WebSocket server, and CLI executables — while the
shipping runtime of the product is the browser (worker engine + UI). Runtime
divergence (Bun = JavaScriptCore; Chrome = V8; Firefox = SpiderMonkey) has
numerical consequences for a simulator (SPEC §14).

## Options considered

1. **Bun everywhere (chosen)** — single fast toolchain, native workspaces,
   `bun test`, `bun build`, `Bun.serve` WebSockets, `--compile` executables.
   Cons: JSC vs V8 numeric drift must be managed; some tooling (Playwright,
   Stryker) may need their own CLIs.
2. **Node + pnpm + vitest** — most battle-tested ecosystem; slower installs,
   three extra tools to configure and pin; server needs a WS dependency.
3. **Mixed (Bun for scripts, Node for CI/tests)** — two runtimes to pin and
   debug; drift risks discovered late.

## Decision

Bun (pinned exactly via `.bun-version` + `packageManager`) is the toolchain and
the server/CLI runtime. Vite (executed by Bun) remains the UI bundler/dev
server until Bun's HTML bundler reaches parity (revisit then, per SPEC §3.1).
Biome owns formatting + general lint; ESLint owns type-aware rules only.

## Consequences

- No bit-identical numerics across runtimes: analytical/reference/conformance
  suites must run under Bun **and** in Chromium/Firefox/WebKit (SPEC §13.8);
  all engine math is funneled through `core/math/` so a deterministic
  implementation can be swapped in if drift ever breaks tolerance (ADR then).
- Bun-version upgrades are separate PRs with the full suite green.
- If a Bun limitation blocks a needed tool (DOM test env, branch coverage
  thresholds, fake timers), mitigate per SPEC §23 risk register and record the
  exception in an ADR.
