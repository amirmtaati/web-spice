# Security Policy

## Reporting a vulnerability

Please open a private security advisory via GitHub ("Report a vulnerability" on
the Security tab) rather than a public issue. Include a reproduction (netlist,
project file, or protocol traffic) and the affected package(s).

## Scope

- `spicekit/packages/protocol` — protocol decoding / validation
- `spicekit/packages/core` — SPICE parser, expression evaluator, resource limits
- `spicekit/packages/server` — WebSocket surface, DoS/backpressure
- `circuit-studio` — project loader, clipboard/URL-hash import, CSP

## Standing guarantees (enforced in code review and CI)

- All untrusted input (SPICE text, project JSON, clipboard, URL hash, WebSocket
  frames) passes validated, size-limited parsers; zod validates every protocol
  message.
- No `eval`, `new Function`, dynamic `import()` of user data, or `innerHTML`
  with untrusted strings. SVG import is sanitized.
- Resource limits (elements, nodes, timesteps, samples, netlist size, nesting
  depth, per-run wall clock) raise typed `E_LIMIT_EXCEEDED` errors — never hangs.
- The engine worker never touches the DOM or storage.
- In worker mode, no user data leaves the browser.

## Supported versions

Pre-release: only `main` receives security fixes.
