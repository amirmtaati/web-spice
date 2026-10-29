# web-spice

A browser-first circuit simulator, built in TypeScript on Bun.

Two projects, one product:

| Project | What it is |
|---|---|
| **`spicekit`** | A SPICE-class simulation engine, typed protocol, client library, WebSocket server, and CLI. No UI. |
| **`circuit-studio`** | A browser app: KiCad-accurate, Figma-smooth schematic editor, instruments (oscilloscope, function generator, multimeter, Bode/spectrum plotters, curve tracer) and a dockable dashboard. |

The two connect **only** through a versioned contract (`@spicekit/protocol`) and a
transport-agnostic client (`@spicekit/client`). The default engine transport is a
Web Worker; a remote Bun server and an in-process transport (tests, CLI) speak the
same protocol.

> The master specification is committed at [`docs/spec/SPEC.md`](docs/spec/SPEC.md)
> and is the single source of truth. `AGENT.md` describes how the coding agent
> works day to day.

## Architecture

```
┌────────────────────────── circuit-studio (browser) ──────────────────────────┐
│  Schematic editor ─► Netlist extractor ─► SimulatorClient ──┐                │
│  Instruments / Dashboard ◄── ResultStore ◄── data stream ◄──┤                │
└─────────────────────────────────────────────────────────────┼────────────────┘
                                                              │ @spicekit/protocol
                          ┌───────────────────────────────────┴───────────────┐
                          │  Transport (pluggable)                            │
                          │   • WorkerTransport    (default, Web Worker)      │
                          │   • WebSocketTransport (remote Bun engine server) │
                          │   • InProcessTransport (tests, Bun, Node)         │
                          └───────────────────────────────────┬───────────────┘
                                                              │
┌────────────────────────────── spicekit (engine) ────────────┴────────────────┐
│  Parser ─► Circuit IR ─► Compiler (MNA stamps) ─► Solver ─► Analyses ─► Data  │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Repository layout

This repository hosts both projects (one product). The spec describes them as
separate repositories; see
[ADR-002](docs/decisions/002-scaffold-notes.md) for the single-repo adaptation
and how to split later if needed.

```
web-spice/
├── spicekit/
│   ├── packages/
│   │   ├── protocol/   # @spicekit/protocol — types, zod schemas, PROTOCOL_VERSION (runtime-agnostic)
│   │   ├── core/       # @spicekit/core — parser, IR, compiler, solvers, analyses (zero runtime deps)
│   │   ├── client/     # @spicekit/client — SimulatorClient + transports (runtime-agnostic)
│   │   ├── server/     # @spicekit/server — Bun.serve WebSocket host (Bun-only)
│   │   ├── cli/        # @spicekit/cli — `spicekit` command (Bun-only)
│   │   └── testing/    # private: builders, fixtures, tolerances
│   ├── fixtures/       # netlists + golden outputs
│   └── scripts/        # doctor, gen-golden, check-size, check-limits, browser-suite
├── circuit-studio/     # browser app (Vite + React 19 + Tailwind 4 + Zustand)
├── docs/               # spec, decisions (ADRs), progress, perf baseline
└── .github/            # CI, PR template
```

## Quickstart

Requires [Bun](https://bun.sh) (exact version pinned in `.bun-version`).

```bash
bun install          # frozen lockfile in CI
bun test             # unit + integration tests
bun run typecheck    # tsc -b (project references)
bun run lint         # biome check
bun run dev          # circuit-studio dev server (Vite under Bun)
bun run doctor       # environment sanity check
bun run hooks:install  # git hooks (biome + commitlint)
```

## Status

**P0 — Foundations (scaffold)**: done. See [`docs/progress.md`](docs/progress.md)
for exactly what exists, what is stubbed, and what comes next (milestones E1→E4,
U1→U5, R1 in the spec).

## License

MIT — see [LICENSE](LICENSE).
