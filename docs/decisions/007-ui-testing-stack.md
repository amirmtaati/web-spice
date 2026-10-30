# ADR 007 — UI test stack: `bun test` + happy-dom + Testing Library

**Date:** 2026-10-31 · **Status:** accepted (UX0-T2) · **Deciders:** UI track

## Context

`UI-UX-SPEC.md` §12 defines the UI test layers: unit (`bun test
circuit-studio`), component ("bun test + happy-dom + Testing Library"), E2E
(Playwright). Bun's test runner is the monorepo standard; component tests need
a DOM.

## Decision

- **DOM:** `happy-dom` registered globally per component-test file via
  `@happy-dom/global-registrator` (`src/test/dom.ts` helper, imported first in
  every `*.test.tsx`). No root `bunfig.toml` preload — engine packages must
  never see DOM globals (bunfig note in the repo root documents this).
- **Assertions/rendering:** `@testing-library/react` + `@testing-library/dom`;
  `globalThis.IS_REACT_ACT_ENVIRONMENT = true` is set by the helper.
- **Snapshots:** bun's `toMatchSnapshot()`; snapshots are committed.
- **E2E discovery:** Playwright files are named `*.e2e.ts` with
  `testMatch: "**/*.e2e.ts"` because bun's test glob matches `*.spec.ts` and
  would otherwise try to execute Playwright suites under `bun test
  circuit-studio`.

## Alternatives considered

| Option | Verdict |
|---|---|
| jsdom | Slow DOM, older engine; happy-dom is the bun-recommended registrator target and faster. |
| Vitest + browser mode | Second test runner in the repo — rejected (toolchain discipline). |
| `bunfig.toml` root preload | Would register DOM for engine packages too — rejected; per-file import keeps engine tests DOM-free. |

## Consequences

- Component tests are colocated (`*.test.tsx` next to sources, spec §12).
- `bun test circuit-studio` must stay free of Playwright suites (enforced by
  the `.e2e.ts` naming rule).
- happy-dom quirks (no real layout) are acceptable: component tests assert
  semantics/ARIA/keyboard, not pixels — pixels are Playwright's job.
