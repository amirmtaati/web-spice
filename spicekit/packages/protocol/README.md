# @spicekit/protocol

The versioned contract between any GUI and the spicekit engine (SPEC §4):

- **Circuit IR** — canonical JSON circuit description (`src/circuit.ts`)
- **Messages** — every client ⇄ engine message as discriminated unions + zod
  schemas (`src/messages.ts`, `src/schema.ts`)
- **Errors** — stable error codes and the `EngineError` base (`src/errors.ts`)
- **Capabilities** — engine version/capabilities/limits advertised at handshake
  (`src/capabilities.ts`)

Runtime-agnostic: no Bun, Node, DOM, or worker APIs. Breaking changes require a
`PROTOCOL_VERSION` major bump and a migration note.
