# @spicekit/client

Transport-agnostic client for the spicekit engine (SPEC §6). The UI never
touches transports directly — it gets a `SimulatorClient`.

- `createInProcessClient()` — tests, Bun, Node (wraps the stub engine for now)
- `createWorkerClient()` — default browser transport (lands with E4)
- `createWebSocketClient(url)` — remote Bun engine server (lands with E4)

The client owns request/response correlation, timeouts, typed errors, and (in
E4) WebSocket reconnect + worker-crash detection. Every transport must pass
`runClientConformance(factory)` — one shared suite (SPEC §6).
