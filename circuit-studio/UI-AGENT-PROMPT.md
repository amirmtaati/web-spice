# UI Agent Kickoff Prompt (copy-paste)

Copy everything below the line into a fresh agent session working in this
repository. It is self-contained and points the agent at the right documents
in the right order.

---

You are implementing the **Circuit Studio UI** — the browser front end of the
web-spice project (repo root: the monorepo containing `spicekit/` and
`circuit-studio/`). The simulation engine (E1–E4) is complete and stable;
your job is to make its user interface excellent, production-ready, and
tested.

## Read first, in this order

1. `circuit-studio/UI-UX-SPEC.md` — **your work order**. Design system, app
   shell, every feature surface, milestones UX0–UX7 + UXR with task tables
   and acceptance gates. Follow it exactly.
2. `circuit-studio/AGENTS.md` — the engine contract (`@spicekit/client` API,
   transports, streaming/live semantics, errors, Circuit IR cheat sheet).
   You never need to read `spicekit/packages/**` source.
3. `docs/spec/SPEC.md` §8–11 (UI chapters), §13.5 (e2e journeys), §17
   (performance budgets), §21 ("looks right"), §22 (U-milestones) — the
   long-form originals.
4. Existing code you will extend: `circuit-studio/src/` (a P0 shell already
   performs the engine handshake and has the theme/token mechanism).

## How to work

- Implement milestones **strictly in order: UX0 → UX1 → … → UX7 → UXR**
  (§13 of the UI/UX spec). Finish every task of a milestone before moving
  on; cite task IDs in commits (e.g. `feat(studio): UX0-T4 dockview shell`).
- **Definition of done per milestone:** all tasks done + the milestone's
  acceptance gates demonstrably met + UI tests added and green + the §11
  "looks right" checklist for every touched surface + a `docs/progress.md`
  entry (newest first) + push.
- Gates to run before declaring anything done:
  `bun run check` (biome + eslint + tsc -b + engine tests + dep-cruiser),
  `bun test circuit-studio` (UI tests as they are added),
  `bun run build:studio` (production build), `bun run e2e` (Playwright, in
  `circuit-studio/`).
- Non-negotiables: only `src/sim/` imports `@spicekit/client`; no
  `bun:*`/`node:*`/`process` in `src/**`; React never re-renders per data
  chunk (instruments read ring buffers in rAF); every new dependency gets an
  ADR; Conventional Commits; no `any`; files ≤ 500 lines.
- The hard product requirements you are building toward: after any run (and
  live), the user can see **voltage and current for every component, element,
  and node** (badges, tooltips, Results table, cross-probing — UI/UX spec
  §6.5), and see **graphs of voltage/current over time, including capacitor
  charging and discharging with τ annotations** (§6.7, the Experiments
  presets) — all inside a chic, calm, professional dashboard with
  dark/light/Paper themes.

## Start now

Begin with **UX0** ("Design system, shell, and command foundation", §13):
tokens, primitives, formatters, dockview shell with Build/Debug/Present
presets, command palette, worker transport by default, error boundaries,
perf baselines. When UX0 passes its acceptance gates, commit, push, write
the progress entry, and continue to UX1.

Report progress per milestone: what landed, test evidence, screenshots
descriptions, budget numbers, and any deviations from the spec (with
reasons).
