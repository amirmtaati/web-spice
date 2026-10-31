/**
 * Engine worker entry (UX0-T6, AGENTS.md W0): hosts the spicekit engine in a
 * Web Worker so parsing, compiling, and solving never block the UI thread.
 * Spawned by `sim/client.ts` via the Vite `?worker` import; Vite bundles this
 * file (with @spicekit/core inside) as the worker chunk.
 */
import "@spicekit/client/worker-entry";

// The Vite `?worker` import replaces this module with a synthetic
// constructor, so this default export is never seen by the app. It exists
// because bun's test resolver strips the `?worker` query and loads THIS
// module directly — without a default export the import statement fails in
// `bun test` (see sim/controller.test.ts).
export default class EngineWorkerStub {}
