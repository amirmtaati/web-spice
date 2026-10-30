/**
 * Worker entry (E4): hosts an EngineSession inside a Web Worker. Every
 * incoming message is handled on the worker's event loop; replies (including
 * async live-run events) post back to the main thread. Spawned by the worker
 * transport via `new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" })`.
 */
import { EngineSession, hostClock } from "@spicekit/core";
import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";

const session = new EngineSession({ clock: hostClock() });

const selfRef = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ClientToEngine>) => void) | null;
  postMessage(message: EngineToClient): void;
};

selfRef.onmessage = (event) => {
  session.handle(event.data, (reply) => {
    selfRef.postMessage(reply);
  });
};
