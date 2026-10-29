# ADR-002: Scaffold-time decisions — single-repo monorepo, dependency set, Bun 1.3.14 verification

- **Status:** accepted
- **Date:** 2026-10-29
- **Deciders:** amirmtaati, coding agent

## Context

SPEC §3.2 describes `spicekit` and `circuit-studio` as separate repositories.
The product owner directed that both live in one repository (`amirmtaati/web-spice`)
at least for now. SPEC §23 also asks the agent to re-verify risk-register items
at scaffold time and record outcomes.

## Decision 1 — one repository, two project roots

`web-spice` is a Bun workspace monorepo:

```jsonc
"workspaces": ["spicekit/packages/*", "circuit-studio"]
```

- One `bun.lock`, one CI pipeline, atomic cross-project changes (protocol bump +
  client + UI in one PR) — strictly simpler than the two-repo alternative while
  the product is this tightly coupled.
- The **boundary is preserved in code and enforced by tooling**: `circuit-studio`
  may import only `@spicekit/client` (via `src/sim/`), and everything still
  flows through `@spicekit/protocol`. Dependency-cruiser + ESLint + CI enforce
  it (SPEC §12.4).
- Splitting later is mechanical: `spicekit/` and `circuit-studio/` already have
  independent package graphs; a split only needs two lockfiles and published
  `@spicekit/*` versions.

## Decision 2 — package resolution during development

Workspace packages expose their **TypeScript source** through `exports`
(`"types": "./src/index.ts"`, `"default": "./src/index.ts"`) so `bun test`,
Vite, and `tsc -b` all resolve without a prebuild step. Publishing will switch
exports to built `dist/` artifacts plus `tsc --emitDeclarationOnly` types, with
`publint`/`attw`/api-extractor gates (SPEC §3.6) — that change lands with E4.

## Decision 3 — initial dependency set (all need an ADR per SPEC §12.4)

| Package | Choice | Why |
|---|---|---|
| `protocol` | `zod` v4 | Spec-mandated schema validation; single runtime dep of the contract |
| `core` | none | Zero runtime dependencies (SPEC §12.4) |
| `client` | protocol + core only | Transports ship with the client |
| `circuit-studio` | React 19, Zustand 5, Tailwind CSS 4, Vite 7 | Spec-mandated UI stack (§3.1); docking library (`dockview`) deferred to the dashboard milestone to keep the scaffold lean |
| tooling | Biome 2, ESLint 9 + typescript-eslint 8, dependency-cruiser 16, knip 5, commitlint 19, lefthook 1 | Spec §3.1 |

## Risk register re-verification (SPEC §23) — outcomes at scaffold time

| Risk | Outcome |
|---|---|
| Bun pinned version | Bun **1.3.14** verified installed; pinned via `.bun-version` + `packageManager` |
| Bun test runner lacks branch thresholds | Deferred: `bunfig.toml` has text coverage reporting; the lcov-parsing threshold script is scheduled with E1 (tracked in `docs/progress.md`) |
| Playwright/Stryker under Bun | Not yet exercised; will run via their own CLIs in CI when U-track starts |
| Accidental Bun/Node API use in shared code | Guarded now: ESLint `no-restricted-globals`/`no-restricted-imports` on agnostic globs + CI browser-target bundle check + Biome `noNodejsModules` (except server/cli/scripts) |
| Provenance publishing | Not applicable until first publish (E4) |

## Consequences

- `docs/spec/SPEC.md` lives at the repo root docs folder rather than per-repo.
- Two `package.json`s named in the spec as "roots" (`spicekit/package.json`,
  per-project `bunfig.toml`) are consolidated at the repo root; scripts use
  `bun run --filter`.
- `trustedDependencies` stays empty; dependency lifecycle scripts are blocked
  by default (SPEC §3.4).
