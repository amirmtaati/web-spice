# AGENT.md — How the coding agent works on web-spice

**Read order for every session:** `docs/spec/SPEC.md` (single source of truth) →
`docs/progress.md` (where we are) → `docs/decisions/` (decisions already made —
never relitigate an ADR silently) → this file.

## Mission

Deliver the spec: a SPICE-class engine (`spicekit`) and a browser schematic
editor + instruments app (`circuit-studio`), production-ready, extensively
tested. Work milestone by milestone (P0 → E1…E4, U1…U5 → R1). A milestone is
done only when its tests, docs, benchmarks, and browser-engine runs pass, and
`docs/progress.md` has an entry.

## Daily loop

1. Pick the smallest vertical slice that advances the current milestone.
2. Write the failing test first when the slice has observable behavior.
3. Implement. Keep files ≤ 300 lines (soft), functions ≤ 50 lines, complexity
   ≤ 10 (SPEC §12.2).
4. Run the loop: `bun run lint && bun run lint:eslint && bun run typecheck && bun test`.
   All green before you move on.
5. After every milestone (and for notable decisions), append an entry to
   `docs/progress.md` and, when a trade-off was made, an ADR in
   `docs/decisions/NNN-title.md` (copy `000-adr-template.md`).
6. Commit with Conventional Commits (`feat`, `fix`, `perf`, `refactor`, `test`,
   `docs`, `build`, `ci`, `chore`). One logical change per commit.

## Commands

| Command | Purpose |
|---|---|
| `bun install` | Install (lockfile is committed; never hand-edit `bun.lock`) |
| `bun test` | Unit + integration tests |
| `bun run typecheck` | `tsc -b` over project references — **Bun does not type-check** |
| `bun run lint` / `bun run lint:eslint` | Biome / type-aware ESLint |
| `bun run check:deps` | Dependency-cruiser boundaries (SPEC §12.4) |
| `bun run dev` | circuit-studio dev server (Vite under Bun) |
| `bun run doctor` | Environment sanity check |
| `bun run check` | Everything above, in one gate |

## Hard rules (violations fail CI or review)

1. **Runtime-agnostic rule (SPEC §2.2):** `protocol`, `core`, `client`, and all
   UI code must not import `bun:*`, use the `Bun` global, `node:*` built-ins,
   or `process`. Bun-specific code lives only in `server`, `cli`, `scripts/`.
   Environment behaviors are injected via interfaces (`Clock`, `Rng`, `Logger`,
   `IncludeResolver`, `Transport`).
2. **Layering (SPEC §12.4):** `protocol ← core ← client ← server/cli`; nothing
   imports `server`/`cli`; in circuit-studio **only `sim/` imports
   `@spicekit/client`**. Zero circular dependencies.
3. **Zero runtime dependencies in `@spicekit/core`.** Any new dependency
   anywhere needs an ADR (size, license, maintenance, alternatives).
4. **No `any`.** Use `unknown` and narrow. Branded types for ids/units;
   exhaustive `switch` ending in `assertNever`. Named exports only.
5. **No `eval`/`new Function`.** Untrusted input goes through validated,
   size-limited parsers; zod validates protocol messages.
6. **Numerics:** all device/evaluator math goes through `core/math/`; no
   allocations in Newton/timestep/drag hot loops (preallocated typed arrays);
   correctness before cleverness.
7. **Errors:** stable code + human message + location (`elementName`/`node`/
   `line`/ui id). Expected failures return `Result<T, E>`; never swallow.
8. **Tests are not optional.** Every behavior ships with tests that would fail
   if it broke. Engine math gets analytical + property tests; bugs get a
   minimal regression fixture in `spicekit/fixtures/regressions/`.
9. **Determinism:** seeds explicit, snapping/routing pure functions, builds
   reproducible, lockfile committed.
10. **Never lose electrical intent** in editor work: moving/rotating/dragging
    must never silently create or break connections.

## Guardrails for judgment calls

- Spec conflict or ambiguity? Prefer the spec; if the spec is wrong for the
  platform, write an ADR and note it in `docs/progress.md`.
- Bun limitation discovered (test runner, DOM env, thresholds)? Mitigate per
  the risk register (SPEC §23) and record the outcome in an ADR.
- Performance work only with a benchmark; budgets live in SPEC §17 and are
  enforced in a real browser, not under Bun.
- UI work: dark/light/Paper themes, keyboard path, a11y, reduced motion — from
  the first PR, not as a cleanup pass.
