# ADR-003: Hand-rolled seeded property-test generators instead of fast-check

- Status: accepted
- Date: 2026-10-29
- Deciders: engine track (E1)

## Context

SPEC §13.1 names **fast-check** for property-based testing (parser round
trip, KCL invariants, scaling invariance). SPEC §12.4 simultaneously
requires **zero runtime dependencies in `@spicekit/core`** and says every
new dependency elsewhere needs an ADR (size, license, maintenance,
alternatives). fast-check would be a dev-only dependency of the core
package and would enter CI's dependency graph.

## Options considered

1. **Add fast-check** as a devDependency. Pros: shrinking, distribution
   over random cases, ecosystem familiarity. Cons: ~1 MB transitive graph
   in CI, nondeterministic shrinker output across versions, one more
   supply-chain surface to audit (SPEC §16), and our invariants need
   *seeded reproducibility* (§13.1: "seeded randomness") which fast-check
   supports but with its own RNG semantics.
2. **Hand-rolled seeded generators** (mulberry32 + task-specific
   generators in the test files). Pros: zero dependencies, fully
   reproducible runs (same seed → same cases → same failures), trivially
   auditable, no API churn. Cons: no automatic shrinking; we must keep
   generators honest ourselves.

## Decision

Option 2 for E1. The property suite uses a small seeded PRNG
(`mulberry32`) with task-specific generators (random passive networks,
mutated netlists). Every test logs its seed implicitly through the fixed
constants, so a failure is exactly reproducible.

## Consequences

- Core keeps zero dependencies; CI supply chain unchanged.
- No shrinking: when a property fails, the seed pinpoints the exact case;
  we then add a minimal regression fixture by hand (SPEC §13.2.6
  regression corpus) rather than relying on automatic shrinking.
- Revisit at E2 when property coverage expands to nonlinear devices: if
  generator complexity grows (stateful circuits, temperature sweeps), an
  ADR for fast-check adoption becomes worthwhile.

## Related

- SPEC §13.1 (property-based targets), §13.3 (invariants), §16 (supply
  chain), §12.4 (dependency policy).
- ADR-002 (scaffold decisions), `docs/progress.md` (E1 entry).
