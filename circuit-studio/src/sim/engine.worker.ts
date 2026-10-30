/**
 * Engine worker entry (UX0-T6, AGENTS.md W0): hosts the spicekit engine in a
 * Web Worker so parsing, compiling, and solving never block the UI thread.
 * Spawned by `sim/client.ts` via `new Worker(new URL(...), {type:"module"})`;
 * Vite bundles this file (with @spicekit/core inside) as the worker chunk.
 */
import "@spicekit/client/worker-entry";
