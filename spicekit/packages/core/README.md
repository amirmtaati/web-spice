# @spicekit/core

The SPICE-class engine (SPEC §5): parser → Circuit IR → compiler (MNA stamps) →
solvers → analyses. **Zero runtime dependencies** (only `@spicekit/protocol` for
the IR contract) and **runtime-agnostic** — no Bun/Node/DOM APIs; browsers are a
product runtime.

```
src/
  parser/    SPICE3-style netlist text → IR (engineering suffixes, diagnostics)
  compiler/  flatten subcircuits, resolve params, node indices, pre-flight checks
  solver/    dense LU (≲200 unknowns) now; sparse LU with symbolic reuse (E4)
  analyses/  OP / DC sweep / AC / transient / noise / tf
  devices/   uniform Device interface (stamps, limiting, truncation)
  math/      ALL transcendental math used by devices & the evaluator (SPEC §14)
```

Invariants: no allocation in Newton/timestep hot loops; deterministic; all math
through `math/`.
