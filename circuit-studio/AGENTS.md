# circuit-studio — Engine Integration Spec (agent handoff)

This file is the **complete contract between the UI and the simulation
engine**. An agent implementing any part of the UI that touches simulation
(`src/sim/`, run bar, instruments, probes, live controls) should be able to
work from this document plus the published package types alone — **without
reading the engine source** (`spicekit/packages/core/**`, `server/**`).

Written against protocol `0.2.0`, `@spicekit/client` 0.1.x (post-E4).
Last updated: 2026-10-30.

---

## 0. How to use this document

**Scope.** This file covers the **engine wire contract** (how the UI talks
to the simulator). For *what to build and how it should look, feel, and be
sequenced* — the design system, shell, instruments, measurement surfaces,
milestones UX0–UX7 and task tables — read
[`UI-UX-SPEC.md`](./UI-UX-SPEC.md) (work order) and start from
[`UI-AGENT-PROMPT.md`](./UI-AGENT-PROMPT.md).

**Precedence.** If sources disagree, in order:

1. The TypeScript types of `@spicekit/protocol` and `@spicekit/client`
   (installed workspace packages — the compiler is the authority).
2. This document (engine-wire matters) and `UI-UX-SPEC.md`
   (UX/design/sequencing matters).
3. `docs/spec/SPEC.md` §4 (protocol), §6 (client), §8 (UI state), §22
   (milestones) — the long-form original.
4. `docs/embedding.md` — engine-side embedding examples (React/Vue/plain JS).

**Reading budget.** You never need `spicekit/packages/core/**` (the engine:
parser, solver, devices) or `spicekit/packages/server/**`. If you want to
check a client behavior, read these files only (they are small and
authoritative):

| File | What it tells you |
|---|---|
| `spicekit/packages/client/src/client.ts` | `SimulatorClientImpl`: correlation, timeouts, run-handle routing |
| `spicekit/packages/client/src/transport.ts` | the `Transport` seam (4 methods) |
| `spicekit/packages/client/src/transports/*.ts` | worker / WebSocket / in-process behavior |
| `spicekit/packages/client/src/conformance.ts` | the 10-check conformance suite + a minimal valid `Circuit` |
| `spicekit/packages/protocol/src/*.ts` | every wire type: messages, IR, errors, capabilities |

**Non-negotiable architecture rules** (CI-enforced, see §11):

- Only `src/sim/` may import `@spicekit/client` (dependency-cruiser rule
  `only-sim-imports-spicekit-client`). Everyone else goes through `src/sim`.
- Nothing under `circuit-studio/src` may import `bun:` or `node:` modules,
  and must not use `process` or `Buffer` (rule
  `runtime-agnostic-no-bun-node`). The UI ships to the browser.
- Never import `@spicekit/core` or `@spicekit/protocol` from the UI.
  `@spicekit/client` re-exports every type the UI needs. If a type is
  missing from the client's re-exports, add it to
  `spicekit/packages/client/src/index.ts` (additive change + API-snapshot
  update) rather than deep-importing.
- The engine runs **only inside a transport-owned context** (Web Worker by
  default, in-process in tests, WebSocket against a server). The UI never
  spawns simulation workers itself and never runs netlists on the main
  thread.

---

## 1. Mental model

```
React components (app/, editor/, instruments/, dashboard/)
        │  zustand actions/selectors            React NEVER sees engine types
        ▼
stores (simStore, resultStore) ────────────── plain state + ring buffers
        │
        ▼
src/sim/  ── the ONLY importer of @spicekit/client
        │  run controller: owns the client, run handles, error surface
        ▼
SimulatorClient  (@spicekit/client)          correlation · timeouts · typed errors
        │
        ▼
Transport  ── in-process │ Web Worker (default) │ WebSocket
        │
        ▼
EngineSession (inside worker / server Bun Worker / host process)
```

Key consequences:

- **One client instance per app** (`getSimulatorClient()` singleton in
  `src/sim/client.ts`). All runs share one engine session; loads replace the
  circuit for everyone (§3).
- **The UI never touches protocol envelopes.** Requests/responses are
  correlated inside the client by message `id`; the UI sees only promises
  and `RunHandle` events.
- **Bulk waveform data arrives as chunks**, already shaped per signal; the
  UI's job is to append them into ring buffers and consume them in
  `requestAnimationFrame` — **React must not re-render per data chunk**
  (SPEC §8.2).

---

## 2. Getting an engine

Three factories, all exported from `@spicekit/client`, all returning the
same `SimulatorClient`:

| Factory | Transport | Use when |
|---|---|---|
| `createInProcessClient()` | engine session on the current thread | unit/integration tests, SSR, CLI — **never** in the app default path |
| `createWorkerClient(workerUrl, options?)` | engine in a module Web Worker | **the app default**; options: `{ onCrash?: () => void }` |
| `createWebSocketClient(url, options?)` | remote `@spicekit/server` | "remote engine" mode; options: `{ reconnect?: boolean (default true), backoffMs?: number (default 250, doubles, cap 5 s), onStateChange?: (state: "connecting"\|"open"\|"closed") => void }` |

### 2.1 Default wiring (Web Worker under Vite)

The client package ships a ready worker entry at the subpath
`@spicekit/client/worker-entry` (an `EngineSession` bridged to
`onmessage`/`postMessage`). Vite must bundle the worker's module graph, so
use the `?worker&url` import suffix — do **not** build the URL with
`new URL(...)` yourself (Vite would not bundle the worker's imports):

```ts
// src/sim/engine.worker.ts — worker entry, no other code
import "@spicekit/client/worker-entry";
```

```ts
// src/sim/client.ts
import workerUrl from "./engine.worker?worker&url";
import { createWorkerClient, type SimulatorClient } from "@spicekit/client";

let instance: SimulatorClient | null = null;

export function getSimulatorClient(): SimulatorClient {
  if (instance === null) {
    instance = createWorkerClient(workerUrl, {
      onCrash: () => {
        // Session lost (§3.4): mark the chip, re-connect + reload.
        // W1 wires this to the sim controller; until then it logs.
      },
    });
  }
  return instance;
}
```

For the `?worker&url` import to typecheck, the app needs Vite's client
types (e.g. `src/vite-env.d.ts` containing
`/// <reference types="vite/client" />`).

### 2.2 Remote engine (WebSocket)

`@spicekit/server` (Bun-only, not bundled into the UI) speaks the same
protocol on `ws://host:port/ws`. Start it locally with either:

```sh
bun spicekit/packages/cli/src/index.ts serve --port 8080
SPICEKIT_PORT=8080 bun spicekit/packages/server/src/main.ts
```

Server behavior the UI may rely on / must respect:

- Endpoints: `GET /healthz` → `{"status":"ok"}`; `GET /readyz` → 503 when at
  capacity; `GET /metrics` → Prometheus text.
- Upgrade rejects: 401 (bad/missing bearer token when `SPICEKIT_TOKEN` is
  set — token comes from `?token=` query param or `Authorization: Bearer`),
  403 (origin not in `SPICEKIT_ORIGINS` allow-list), 503 (at capacity,
  `SPICEKIT_MAX_CONNECTIONS`, default 64), 426 (not an upgrade).
- Close codes: `4400` malformed/invalid message (or binary frame — binary is
  not accepted in protocol 0.2), `4409` rate limit
  (`SPICEKIT_RATE_LIMIT`/s per connection, default 120), `1009` payload over
  `SPICEKIT_MAX_PAYLOAD` (default 4 MiB — large `loadSpice` texts must fit
  in one frame), `1001` server shutting down.
- **Every connection gets a fresh engine session.** After any reconnect the
  circuit must be re-loaded (§3.4).

### 2.3 Which transport when (decision rule)

- App runtime: worker (keeps Newton loops and waveform churn off the main
  thread; survives worker crash via respawn).
- Vitest/`bun test` unit + integration tests, Storybook: in-process
  (synchronous, deterministic, no browser needed).
- Explicit user choice / deployed-headless demo: WebSocket. Build the URL
  from `import.meta.env` (e.g. `VITE_ENGINE_URL`), never hardcode.

---

## 3. Session lifecycle

```
disconnected ──connect()──▶ ready ──loadSpice/loadCircuit──▶ loaded ──run()──▶ running
     ▲                        │                                │                   │
     └──────────── dispose() ─┴────────────────────────────────┴───────────────────┘
```

- `connect(): Promise<EngineInfo>` — opens the transport (spawns the worker
  / opens the socket), sends the handshake, checks protocol compatibility
  (major version only). Resolves with
  `{ engineVersion, capabilities, limits }`. `engineVersion` looks like
  `"0.2.0+core"` — display as-is; never string-compare against
  `PROTOCOL_VERSION` yourself (the client already did). Rejects with
  `EngineError` code `E_PROTOCOL_VERSION` on mismatch or transport failure.
  Calling `connect()` twice is safe (the conformance suite does it).
- `loadSpice(text) / loadCircuit(circuit): Promise<LoadResult>` — parse +
  compile + store the circuit **in the session**. Resolves
  `{ nodeTable, branchTable, warnings }` where the tables are
  `{ name, index }[]` of nodes / branch-current elements and `warnings` is
  `{ code, message, line? }[]` (non-fatal). Throws typed `EngineError`
  (usually `E_PARSE` with `location.line`) on bad netlists — see §7.
  Loading again simply replaces the circuit; existing runs keep going on
  the old compiled circuit (live) — but do not rely on that: stop runs
  before reloading.
- `run(req): RunHandle` — **synchronous return** (does not await the
  engine). See §5. Requires a loaded circuit (else `E_PARSE`).
- `evaluate(expr, context?)` / `exportSpice()` — §6.3 / §3.5.
- `dispose()` — closes the transport (terminates the worker / socket),
  rejects everything in flight. The instance is unusable afterwards.

State rules the sim controller must encode:

1. No `run*` before a successful `connect()`.
2. No `run`/`exportSpice` before a successful load; loading is the unit of
   "apply my edits to the engine".
3. **One live run per session at a time** (the engine allows several but
   they share one session clock — the UI should enforce one).
4. Buffered runs are executed synchronously inside the engine between
   messages; issuing many buffered runs sequentially is fine (they queue on
   the worker's event loop).

### 3.4 Transport loss and recovery (important)

- **Worker crash** (uncaught error, abnormal exit): the transport
  transparently respawns a fresh worker and calls `options.onCrash()`. The
  **fresh worker is an empty session** — no circuit, no protocol state.
  Recovery procedure in `src/sim`: set engine status to `error/recovering`,
  dispose nothing (the transport is still usable), re-`connect()`, then
  re-`loadSpice(...)` with the current document, then optionally re-run.
  In-flight requests do not reject immediately — they hit the 10 s client
  timeout (§4.2); live runs never receive `done` — so on `onCrash` you must
  drop the current `RunHandle` without awaiting `done`.
- **WebSocket close**: same fresh-session rule; the transport auto-reconnects
  with capped backoff and reports states through `onStateChange`. Treat
  `closed` as "session lost": on the next `open`, `connect()` + reload.
  The UI chip should reflect `onStateChange` directly.

### 3.5 exportSpice

`exportSpice(): Promise<string>` — returns the currently **loaded** circuit
serialized back to SPICE text (round-trips through the engine's parser).
Use it for "Export netlist" and as a debugging aid when netlist extraction
looks suspicious. Throws `E_PARSE` ("no circuit loaded") if nothing loaded.

---

## 4. Protocol reference (what actually crosses the wire)

You normally never see these — they are here so you can debug with DevTools
(worker messages) and so `src/sim` can stay honest about semantics.

### 4.1 Messages

Every message: `{ id: string; type: string; payload?: unknown }`. Replies
carry the request's `id`. Run events (`data`, `progress`, `done`, `error`
during a live run) carry the engine-assigned `runId` as their `id` instead —
the client resolves both back to your run handle.

| Client → engine | Payload | Reply(s) |
|---|---|---|
| `hello` | `{ protocol }` | `ready {engineVersion, capabilities, limits}` |
| `loadCircuit` | `{ circuit: Circuit }` | `loadResult` or `error` |
| `loadSpice` | `{ text }` | `loadResult` or `error` |
| `run` | `{ analysis, stream?, probes? }` | `runAccepted {runId}`, then `data`/`progress`/`done`/`error` |
| `control` | `{ runId, op: "pause"\|"resume"\|"stop"\|"step" }` | `ack {ok, op, runId}` or `error` |
| `setParam` | `{ runId, target: {elementName, property}, value }` | `ack` or `error` |
| `setExternal` | `{ runId, channel, value: number \| number[] }` | `ack` or `error` |
| `evaluate` | `{ expr, context? }` | `evaluateResult {ok, value}` or `error` |
| `exportSpice` | `{}` | `spice {text}` or `error` |

Engine → client events (no request outstanding): `progress {runId, fraction,
simTime}`, `data {runId, signals, tStart, chunk}`, `done {runId, stats}`,
`error {code, message, location?}`.

`RunStats = { timesteps, rejectedSteps, newtonIterations, method?,
fallbackUsed? }` — surface `method`/`fallbackUsed` in the engine chip
tooltip ("OP via gmin stepping" etc.).

### 4.2 Client-side semantics you can rely on

- **Request timeout: 10 s** per request (hardcoded default). A load that
  takes longer than 10 s fails with `E_LIMIT_EXCEEDED` ("Request … timed
  out"). Live-run events are *not* requests and never time out.
- **Buffered runs emit exactly one `data`** message containing *all*
  samples, then `done`.
- Events for a run may arrive before the `runAccepted` continuation runs;
  the client tracks runs by both request id and runId — the UI just uses
  the handle.
- Over WebSocket everything is JSON (samples are arrays, not typed arrays);
  over the worker, large `Float64Array` buffers are transferred zero-copy.
  This difference is invisible to the UI (`chunk.samples` may be
  `number[] | Float64Array` — always `Float64Array.from(chunk.samples)`
  when handing to WebGL).

---

## 5. Runs, streaming and the data pipeline

### 5.1 RunHandle surface

```ts
interface RunHandle {
  readonly id: string;                 // engine runId once accepted
  readonly signals: SignalInfo[];      // refreshed on every data chunk
  onData(cb: (chunk: DataChunk) => void): Unsubscribe;
  onProgress(cb: (p: Progress) => void): Unsubscribe;
  pause(): void; resume(): void; stop(): void; step(): void;   // fire-and-forget
  setParam(target: ParamTarget, value: number): Promise<void>; // acked
  setExternal(channel: string, v: number | number[]): Promise<void>;
  done: Promise<RunStats>;             // resolves on done, rejects on error/timeout/dispose
}
```

`DataChunk = { runId, signals: SignalInfo[], tStart, chunk: { name, samples
}[] }` — `chunk` has one entry per signal, all the same length, ordered on
the analysis axis. `SignalInfo = { name, unit: "v"|"a"|…, kind }`.

Subscribe **before** issuing the first await after `run()` (chunks for a
buffered run are emitted immediately after `runAccepted`); the client
buffers nothing for you. Pattern:

```ts
const handle = client.run(req);      // sync
handle.onData(appendChunk);          // subscribe synchronously
void handle.done.then(finish, fail); // lifecycle
```

### 5.2 The axis is not transmitted — reconstruct it

`data` carries per-signal samples plus `tStart` (= first axis value of the
chunk) but **not the axis array**. Samples always sit on the analysis's own
grid, so `src/sim` rebuilds x from the request:

| Analysis | Axis | x values |
|---|---|---|
| `op` | none | single sample; use `0` |
| `dc` | swept source value | uniform: `start + k·step` |
| `tran` | time (s) | uniform output grid: `tstart(=0 default) + k·tstep` |
| `ac` | frequency (Hz) | `dec`: `fstart·10^(k/points)` · `oct`: `fstart·2^(k/points)` · `lin`: `fstart + k·(fstop−fstart)/(points−1)` |
| `noise` | frequency (Hz) | same grid rules as `ac` |
| `tf` | none | single sample; three scalar signals (§5.4) |

For **live** chunks: samples continue the same uniform `tstep` grid; a chunk
with `tStart: T` and `n` samples covers `T … T + (n−1)·tstep`. Concatenate
across chunks by index arithmetic, not by matching sample values.

> Known gap (protocol 0.2.x): an explicit axis column in `data` is the
> cleaner fix and may be added additively later — wrap axis reconstruction
> in one function (`buildAxis(req, tStart, n)`) so a protocol bump touches
> one file.

### 5.3 Buffered vs live

- **Buffered** (`stream` omitted or `{ mode: "buffered" }`): engine runs to
  completion, one `data` + `done`. Use for op/dc/ac/noise/tf and for
  bounded transients.
- **Live** (`{ mode: "live", realtimeFactor? }`): **`tran` only** (engine
  rejects others with `E_PARSE`). Runs until `stop()`; `tstop` from the
  request is **ignored** (send any positive value, e.g. the request's
  `tstop` is meaningless over JSON — the engine runs unbounded). Wall-clock
  paced: sim advances `realtimeFactor` seconds per wall second (default 1;
  0.01–10 for the speed control). Circuit state persists between chunks, so
  `setParam`/`setExternal` act on a warm circuit.
- **Backpressure** (engine-side, you can rely on it): never more than 4096
  samples per 16 ms tick regardless of `realtimeFactor`; if the UI lags the
  engine drops pace, memory does not grow. The UI's counterpart duty: do
  the O(1) ring-buffer append in `onData` and nothing heavier.
- **Progress**: live chunks are followed by `progress { fraction, simTime }`.
  `fraction` is currently always `0` for live runs — drive progress UI from
  `simTime` (and from `tstop/tstart` for bounded buffered runs, which do not
  stream progress at all).

### 5.4 Signal names (exactly what you will see)

- Default set: `v(node)` for every node and `i(elem)` for every
  branch-current element (V, L, E, H, K…), **all lowercase**, ground is
  `v(0)`. Solver-internal branches (`#internal`) are excluded.
- AC adds variants per node: `vm(n)` magnitude, `vp(n)` phase (deg),
  `vdb(n)` dB, plus `vr(n)`/`vi(n)` only when explicitly probed; per branch:
  `im(e)` (default) and `ip/idb/ir/ii` when probed. A probe written
  `v(out)` selects `vm(out)` on AC.
- `noise`: `onoise_spectrum`, `inoise_spectrum` (noise density vs
  frequency; integrated RMS is in the netlist `.measure`/log domain).
- `tf`: three single-sample signals: `transfer_function`,
  `input_impedance`, `output_impedance`.
- **Probe filtering**: to reduce streamed volume, put `probes:
  [{ signal: "v(out)" }, …]` on the **Circuit** (or `.probe` cards in the
  netlist) *before loading*; the engine then streams only those (AC bare
  names alias as above). The per-run `probes` field of `RunRequest` is
  accepted but currently ignored — always filter via the circuit.

---

## 6. Live interaction (interactive simulation)

### 6.1 setParam — turning knobs while the run streams

```ts
await handle.setParam({ elementName: "R1", property: "value" }, 4700);
```

- Targets (`ParamTarget`): `property` ∈ `"value"` (R, C, L),
  `"amplitude" | "frequency" | "offset"` (V/I waveform sources),
  `"dutyCycle"` (PULSE), `"switchState"` (S, 0/1), `"wiper"`
  (potentiometer — **not implemented yet**: the engine replies
  `E_PARSE "arrives with U3"`; hide wiper knobs until U3).
- Effect: at the **next accepted timestep**, with a safe integrator restart
  (order reset + breakpoint). There is no mid-step tearing.
- **Frequency changes are phase-continuous** — the engine folds `ω·Δt` into
  a phase anchor instead of recomputing `sin(2πf·t)`, so retuning a
  generator mid-run does not glitch the waveform. This is the SPEC §4.4
  guarantee behind the function-generator instrument.
- Errors: unknown element / unsupported property → `E_PARSE` (the promise
  rejects). Element names are matched case-insensitively.
- Must be called on a **running live run** (`runId` known to the engine);
  calling between runs is an error (`E_PARSE "unknown or finished run"`).
  To change a parameter between *buffered* runs, edit the circuit and
  `loadSpice`/`loadCircuit` again.

### 6.2 setExternal — feeding signals into the circuit

A netlist source declared as `V1 in 0 EXTERNAL(chan)` (parentheses
required; IR `{ kind: "EXTERNAL", channel }`) draws its value from the
channel registry each timestep:

- Scalar: `handle.setExternal("chan", 2.5)` — zero-order hold (applies from
  now until changed).
- Series: `handle.setExternal("chan", number[], ...)` — plays sample k at
  `tStart + k·tstep` (tStart = current sim time, tStep = the run's tstep),
  holding the last value. This is how the function-generator instrument
  plays arbitrary/PWL shapes with sample alignment.
- Channels are matched case-insensitively; unset channels read 0.

### 6.3 evaluate — math channels

```ts
const p = await client.evaluate("v(out) * i(v1)", {
  "v(out)": 2.5, "i(v1)": -0.0025,
});
```

Pure expression evaluation (SPEC §5.6 grammar: operators, ternary,
`sin cos tan exp ln log log10 sqrt abs min max pow …`, constants `pi e q k`,
`time`). The context map supplies `v(node)` / `i(elem)` / bare parameter
values (keys case-insensitive). The engine does **not** auto-populate
values from the last run — `src/sim` builds the context from the latest
result buffers. Parse errors reject with `E_PARSE`.

### 6.4 control ops

`pause()` stops sim-time advance (chunks stop, session stays warm);
`resume()` continues (no time jump — wall clock is rebased);
`step()` advances exactly one output-grid step (`tstep`) and pauses;
`stop()` ends the run and resolves `done` with stats. All are
fire-and-forget; failures (e.g. unknown run) surface only in DevTools —
guard UI state yourself.

---

## 7. Errors

### 7.1 Error codes (stable, `EngineError.code`)

| Code | Meaning | Typical UI reaction |
|---|---|---|
| `E_PARSE` | netlist/IR syntax, bad request, unknown element/run, missing load | show message + pin `location.line`/`elementName` |
| `E_SINGULAR_MATRIX` | no unique DC solution (floating section, ideal loops) | highlight `location.node`/`elementName` |
| `E_NO_CONVERGENCE` | Newton failed after fallback ladder | suggest `.options` / source ramping; show `method` tried |
| `E_NO_GROUND` | no node "0" | ERC-style banner |
| `E_FLOATING_NODE` | node with no DC path | highlight node |
| `E_VSOURCE_LOOP` | voltage sources / inductors in loop | highlight involved elements |
| `E_UNKNOWN_MODEL` | `.model` referenced but undefined | pin element |
| `E_BAD_MODEL` | model parameter invalid | pin model card |
| `E_TIMESTEP_TOO_SMALL` | transient step collapsed | suggest `tmax`/`method: "be"` |
| `E_LIMIT_EXCEEDED` | resource limits or client request timeout (10 s) | show which limit |
| `E_PROTOCOL_VERSION` | handshake/transport-level mismatch or disconnect | reconnect flow (§3.4) |
| `E_NOT_IMPLEMENTED` | scaffold stubs only — treat as a bug if seen post-E4 | report |

### 7.2 Location pinning

`EngineError.location?: { elementName?, node?, line?, column?, componentId?
}`. `line/column` refer to the submitted SPICE text; `elementName`/`node`
refer to the loaded circuit. To highlight **schematic components** (not
netlist lines), fill `Circuit.sourceMap: Record<string, string>` (engine
element name → UI component id) when building the IR from the schematic —
the engine preserves it and the UI resolves culprits without string
matching.

### 7.3 Error surface contract for `src/sim`

Catch `EngineError` (it is exported via `@spicekit/client`'s protocol
re-exports; check `err instanceof EngineError`, else wrap). Everything that
fails a run rejects `handle.done`; everything that fails a request rejects
the call's promise. A run that fails mid-flight (live divergence) emits
`error` **and then** `done` — the client turns that into `done` rejecting;
UI must handle both orders defensively.

---

## 8. Circuit IR cheat sheet (what netlist extraction must emit)

Canonical JSON between UI and engine (SPEC §4.1). The engine parses SPICE
text into exactly this shape; `exportSpice` serializes it back. Unknown
extra fields are preserved — the UI may attach metadata beyond `sourceMap`.

```ts
interface Circuit {
  title: string;
  elements: Element[];                    // §8.1
  models: Record<string, ModelCard>;      // { name, type: "npn"|…, parameters }
  subcircuits: Record<string, Subcircuit>;// { name, ports, circuit } (nested Circuit)
  params: Record<string, number|string>;  // .param values, Expr allowed
  options: SimOptions;                    // always send DEFAULT_SIM_OPTIONS + overrides
  analyses: AnalysisRequest[];            // default analyses from the run bar
  probes: ProbeSpec[];                    // streamed-signal filter (§5.4)
  measures?: MeasureSpec[];               // post-run measurements
  ic?: Record<string, number>;            // .ic v(node)=value
  sourceMap?: Record<string, string>;     // element name → component id (§7.2)
}
```

Import `DEFAULT_SIM_OPTIONS` from `@spicekit/client`'s protocol re-exports;
never hand-roll defaults (reltol 1e-3, abstol 1e-12, vntol 1e-6, gmin 1e-12,
itl1 100, itl4 10, trtol 7, method "trap", temp/tnom 27).

### 8.1 Element union (UI extraction targets)

| IR `type` | Netlist | IR shape (abbreviated) |
|---|---|---|
| `R` | `R1 a b 1k` | `{ n: [a,b], value: Expr, tc1?, tc2? }` |
| `C` / `L` | `C1 a b 1u` | `{ n, value, ic? }` |
| `K` | `K1 L1 L2 0.99` | `{ inductors: [name,name], coupling }` |
| `V` / `I` | `V1 a b DC 5` / `SIN(...)` | `{ n, dc?, ac?: {mag, phase?}, wave?: Waveform }` |
| `E`/`G`/`F`/`H` | dependent sources | `{ n: NodeId[], … }` (see protocol/circuit.ts) |
| `B` | `B1 a b V = v(a)*2` | `{ kind: "V"\|"I", expr: string }` |
| `D` | `D1 a k 1N4148` | `{ model, area? }` |
| `Q` | `Q1 c b e 2N3904` | `{ n: [c,b,e], model, area? }` |
| `M` | `M1 d g s b IRF540` | `{ n: 4 nodes, model, w?, l? }` |
| `J` | `J1 d g s 2N5457` | `{ n: [d,g,s], model, area? }` |
| `S` | `S1 a b n+ n- SMOD ON` | `{ ctrl: [n+,n-], model, on? }` |
| `W` | `W1 a b VSENSE WMOD ON` | `{ control: "vsource name", model, on? }` |
| `X` | `X1 a b OPAMP_IDEAL params: g=2` | `{ n: NodeId[], subckt, params? }` |

`Expr = number | "{expression string}"` — expression strings are evaluated
by the engine (params, `{}` refs). Values may carry SPICE suffixes only in
netlist text (`1k`, `2meg`, `3u`); in the IR prefer plain numbers.

Waveforms: `SIN{offset,amp,freq,delay?,damping?,phase?}`,
`PULSE{v1,v2,delay,rise,fall,width,period}`, `PWL{points:[t,v][],repeat?}`,
`EXTERNAL{channel}`, plus NOISE/EXP/SFFM/AM and TRIANGLE/SAWTOOTH/SQUARE
(compiled engine-side to PWL/PULSE).

`AnalysisRequest` = `{kind:"op"} | {kind:"dc", source, start, stop, step,
second?} | {kind:"ac", sweep:"dec"|"oct"|"lin", points, fstart, fstop} |
{kind:"tran", tstep, tstop, tstart?, tmax?, uic?} | {kind:"noise", output,
source, sweep, points, fstart, fstop} | {kind:"tf", output, source}`.

`MeasureSpec` (`.measure`): `{ analysis, name, mode: "find"|"max"|"min"|
"avg"|"rms"|"pp"|"integ", expr, at?, when?: {expr, value, edge, count},
from?, to? }`. The engine evaluates measures per run and reports them via
netlist flows; the UI can render results from the run log (full measure
streaming to the client lands with the U-track — do not block on it).

### 8.2 Naming rules

Node and element names are case-insensitive on load; the engine reports
them **lowercase** everywhere (node tables, signal names). Ground is the
node named `"0"`. Extracted IR should canonicalize to lowercase except
element `name` fields, which keep the schematic's spelling (matching is
case-insensitive engine-side, including `setParam` targets).

---

## 9. Capabilities & limits (adapt, never hardcode)

From `connect()`:

- `capabilities.analyses` — which run-bar modes to show (`["op","dc","ac",
  "tran","noise","tf"]` today).
- `capabilities.devices` / `waveforms` — which library parts / generator
  shapes are legal to place.
- `capabilities.liveParamMode: true` — live knobs supported; `streaming`
  lists `"buffered" | "live"`.
- `limits` — `maxElements`, `maxNodes`, `maxNetlistBytes`, `maxSubcktNesting`,
  `maxTimestepsPerRun`, `maxOutputSamples`, … Validate **before sending**
  (element count, netlist byte length) and show friendly limits errors for
  the rest. A server may advertise tighter limits than the core defaults —
  always read them from `EngineInfo`, never from this document.

---

## 10. Worked examples

### 10.1 Buffered transient + AC through the sim controller

```ts
import { getSimulatorClient } from "./client.ts";

const client = getSimulatorClient();
const info = await client.connect();
const load = await client.loadSpice(`
RC low-pass
V1 in 0 AC 1
R1 in out 10k
C1 out 0 1u
.tran 10u 5m
.ac dec 201 10 100k
.end
`);

// — transient (buffered) —
const tran = client.run({ analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 } });
tran.onData((chunk) => {
  const vout = chunk.chunk.find((c) => c.name === "v(out)");
  if (vout) resultStore.append("v(out)", chunk.tStart, 1e-5, Float64Array.from(vout.samples));
});
const stats = await tran.done;            // RunStats

// — AC —
const ac = client.run({ analysis: { kind: "ac", sweep: "dec", points: 201, fstart: 10, fstop: 100e3 } });
ac.onData((chunk) => {
  // names: vm(out), vp(out), vdb(out) — see §5.4
  resultStore.replace("ac", chunk);
});
await ac.done;
```

### 10.2 Live mode with a knob and a generator

```ts
const handle = client.run({
  analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 },  // tstop ignored in live
  stream: { mode: "live", realtimeFactor: 1 },
});
handle.onData((chunk) => scopeStore.append(chunk));      // O(1) ring append
handle.onProgress((p) => simClock.set(p.simTime));

// function generator → EXTERNAL channel (netlist: V1 in 0 EXTERNAL(gen))
await handle.setExternal("gen", waveformSamplesAt(now));  // series feed
// user drags the R1 knob:
await handle.setParam({ elementName: "R1", property: "value" }, 4700);
// speed control:
//   re-run with a different realtimeFactor, or pause/resume for hold.

handle.stop();
const stats = await handle.done;
```

### 10.3 Failure paths

```ts
try {
  await client.loadSpice(badText);
} catch (err) {
  if (err instanceof EngineError) {
    errorStore.push({ code: err.code, message: err.message, location: err.location });
    // location.line → highlight the netlist row; sourceMap → highlight component
  }
}
```

---

## 11. Testing the integration

| Layer | Tool | What to assert |
|---|---|---|
| Unit (stores, controller) | `bun test` (engine packages) / app-side runner | run-controller state machine with a **fake** `SimulatorClient` (implement the interface in-test) |
| Integration | `runClientConformance(factory)` from `@spicekit/client` | the 10-check suite against any transport/factory you introduce; returns `{ passed, failures[] }` instead of throwing |
| Golden values | in-process client | `v(out)` of the conformance divider = 2.5 V; RC τ; AC −3 dB point — reuse `basicCircuit()` |
| E2E | `bun run e2e` (Playwright, chromium, dev server auto-started) | journeys §13.5; currently: shell loads + engine chip shows a version |
| Manual/remote | `spicekit serve` (§2.2) + `createWebSocketClient` | reconnect: kill server mid-run → UI chip → recovery |

CI rules already enforced (do not break): `bun run lint` (biome),
`lint:eslint` (type-aware), `typecheck` (`tsc -b`), `bun test spicekit`
(engine packages), `check:deps` (dependency-cruiser incl. the two
circuit-studio rules from §0), knip for unused exports. E2E is excluded
from `bun test spicekit` by design.

---

## 12. Implementation plan (UI side of the wire)

Phased so each step is independently shippable. "Done" = acceptance met +
`bun run check` green.

- **W0 — real engine by default.** `src/sim/engine.worker.ts` + switch
  `getSimulatorClient()` to `createWorkerClient` (keep in-process for
  tests via an env/flag override); add `vite-env.d.ts`; engine chip shows
  `engineVersion` from the worker.
  *Accept:* `bun run build:studio` bundles the worker (chunk visible in
  dist); e2e smoke passes against the **worker** transport; dev-mode
  handshake < 1 s.
- **W1 — sim controller + simStore.** State machine of §3 (idle → ready →
  loaded → running), typed error surface of §7, connect/reload on
  `onCrash`/`onStateChange`.
  *Accept:* load-failure banner with line pinning from a bad netlist;
  forced worker crash (test hook `onCrash`) recovers automatically.
- **W2 — run bar plumbing** (arrives visually with U3): run/pause/stop/step
  buttons → `RunHandle`; analysis selector → `AnalysisRequest`; engine
  chip ← `EngineInfo` + `RunStats.method`.
  *Accept:* buffered tran of the RC example renders a correct curve through
  `resultStore` with an axis from §5.2; stop resolves `done`.
- **W3 — result pipeline.** `resultStore` ring buffers (Float32 display
  copy, Float64 retained per SPEC §8.1), rAF-consuming instrument
  prototype (one scope), probe selection → circuit `probes` reload.
  *Accept:* 60 fps scrolling scope against a live run; no React render per
  chunk (profiler).
- **W4 — live instruments.** Function generator (component `EXTERNAL` +
  panel using `setExternal` series), live knobs (`setParam`), speed
  control (`realtimeFactor`), pause/step.
  *Accept:* retuning generator frequency mid-run shows no phase jump
  (record before/after and diff the boundary); knob change visible in the
  scope within one chunk (~16 ms + one tstep).

---

## 13. Known gaps & gotchas (protocol 0.2.0 — verify on bump)

1. `RunRequest.probes` is accepted but ignored — filter via `Circuit.probes`.
2. No axis column in `data` — reconstruct per §5.2; `progress.fraction` is
   `0` for live runs — use `simTime`.
3. Transport loss does **not** reject in-flight requests immediately (10 s
   timeout is the backstop); live runs killed by a crash never settle —
   abandon the handle on `onCrash`/`closed` (§3.4).
4. WebSocket samples are JSON arrays (no binary frames in 0.2); keep
   `loadSpice` texts < ~4 MiB or raise the server's `SPICEKIT_MAX_PAYLOAD`.
5. `setParam` between runs is an error — live params only inside a live
   run; edits between buffered runs go through a reload.
6. Live runs ignore `tstop`; the only ends are `stop()` or engine error.
7. A reconnect (worker respawn or WS re-open) means a **fresh session**:
   `connect()` + reload are mandatory before any run.
8. All names lowercase in results (`v(out)`, `i(v1)`); ground `v(0)` exists
   as a signal; element matching (incl. `setParam`) is case-insensitive.
9. `evaluate` is pure — it never reads the loaded circuit or last run;
   build the context yourself (§6.3).
10. React 19 StrictMode double-invokes effects in dev — the client
    singleton + a `cancelled` flag in the connect effect (as in
    `src/app/App.tsx`) is the required pattern; `connect()` itself is
    idempotent-safe.
