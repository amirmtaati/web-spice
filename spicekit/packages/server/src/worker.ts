/**
 * Server worker entry (E4): hosts an EngineSession inside a Bun Worker so
 * runs never execute on the server event loop (SPEC §7.1). One worker per
 * WebSocket connection; the bridge in index.ts forwards validated protocol
 * messages in and forwards replies (including async live-run events) out.
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
