# @spicekit/server

Bun-only WebSocket host for the spicekit engine (SPEC §7.1). The scaffold ships
`/healthz`, `/readyz`, and a protocol-handshake echo on `/ws`; the full server
(Bun `Worker` pool, zod validation, origin allow-list, bearer token, rate
limits, backpressure-aware binary streaming, Prometheus metrics, graceful
shutdown) lands with E4.

Run: `bun run spicekit/packages/server/src/index.ts`
