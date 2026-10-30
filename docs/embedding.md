# Embedding the spicekit engine

The engine is a plain npm-style workspace — no DOM, no timers, no Bun-only
APIs in `@spicekit/protocol`, `@spicekit/core`, or `@spicekit/client`. Pick
the transport that matches your host:

| Host | Transport | Factory |
|---|---|---|
| Same process (tests, CLI, SSR) | in-process | `createInProcessClient()` |
| Browser / Electron UI | Web Worker | `createWorkerClient(workerUrl)` |
| Remote / shared service | WebSocket | `createWebSocketClient(url)` |

All three return the same `SimulatorClient`, pass one conformance suite, and
speak protocol `0.2.0` (see `@spicekit/protocol` for zod schemas).

## Plain JS (worker)

```js
import { createWorkerClient } from "@spicekit/client";

const client = createWorkerClient(
  new URL("../engine/worker-entry.js", import.meta.url),
);

const info = await client.connect();
await client.loadSpice(`
RC divider
V1 in 0 DC 5
R1 in out 1k
C1 out 0 1u
.tran 100u 5m
.end
`);

const handle = client.run({ analysis: { kind: "tran", tstep: 100e-6, tstop: 5e-3 } });
handle.onData((chunk) => {
  const vout = chunk.chunk.find((c) => c.name === "v(out)");
  render(vout.samples);
});
const stats = await handle.done;
client.dispose();
```

The worker entry is five lines (see `spicekit/packages/client/src/worker-entry.ts`):
an `EngineSession` from `@spicekit/core` bridging `onmessage`/`postMessage`.

## React

```jsx
import { useEffect, useRef, useState } from "react";
import { createInProcessClient } from "@spicekit/client";

export function useSimulator() {
  const clientRef = useRef(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const client = createInProcessClient(); // or createWorkerClient(...)
    clientRef.current = client;
    return () => client.dispose();
  }, []);

  const run = async (netlist) => {
    const client = clientRef.current;
    setStatus("connecting");
    await client.connect();
    setStatus("running");
    await client.loadSpice(netlist);
    const handle = client.run({
      analysis: { kind: "tran", tstep: 1e-4, tstop: 1e-2 },
    });
    handle.onData((chunk) => plot(chunk)); // buffers, never re-renders per chunk
    await handle.done;
    setStatus("idle");
  };

  return { run, status };
}
```

Data-flow rule (SPEC §8.2): feed chunks into typed-array ring buffers and let
instruments read them in `requestAnimationFrame` — React never re-renders
per data chunk.

## Vue

```vue
<script setup>
import { onBeforeUnmount, ref } from "vue";
import { createInProcessClient } from "@spicekit/client";

const client = createInProcessClient();
const value = ref(0);
let handle = null;

onBeforeUnmount(() => client.dispose());

async function run(netlist) {
  await client.connect();
  await client.loadSpice(netlist);
  handle = client.run({ analysis: { kind: "op" } });
  handle.onData((chunk) => {
    value.value = chunk.chunk.find((c) => c.name === "v(out)")?.samples[0] ?? 0;
  });
  await handle.done;
}
</script>

<template>
  <button @click="run('op demo\nV1 a 0 5\nR1 a b 1k\nRl b 0 1k\n.end\n')">Run</button>
  <span>v(out) = {{ value }} V</span>
</template>
```

## Live mode (interactive transients)

```js
const handle = client.run({
  analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 }, // unbounded
  stream: { mode: "live", realtimeFactor: 1 },
});
await handle.setParam({ elementName: "V1", property: "frequency" }, 220);
await handle.setExternal("gen", 2.5);
handle.pause();
handle.resume();
handle.stop();
await handle.done;
```

Frequency changes are phase-continuous (SPEC §4.4) — the waveform never
glitches when a live source is retuned.

## Non-JS GUIs over WebSocket

Run `spicekit serve` (or `@spicekit/server`) and speak the JSON protocol
directly: every frame is `{"id": "...", "type": "...", "payload": {...}}`,
validated by the zod schemas in `@spicekit/protocol` (`requestSchema`).
Handshake with `hello {protocol}` and read `ready {engineVersion,
capabilities, limits}`. Errors carry stable codes (`E_PARSE`,
`E_NO_CONVERGENCE`, …) with `elementName`/`node`/`line` locations for
highlighting the culprit on a schematic.

## Compatibility policy

Minors add; majors may break with a migration guide; deprecations last at
least two minors with runtime warnings. The public-API snapshot test
(`spicekit/packages/client/test/api-snapshot.test.ts`) guards accidental
breaks.
