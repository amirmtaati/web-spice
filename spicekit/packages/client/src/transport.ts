/**
 * Transport seam (SPEC §2.1). A Transport carries protocol envelopes between
 * client and engine. Implementations: in-process (tests), Web Worker
 * (default), WebSocket (remote). Bulk data framing (Transferables / binary
 * frames) is an implementation detail behind this interface.
 */
import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";

export interface Transport {
  /** Open the transport (worker, socket, or immediate for in-process). */
  start(): Promise<void>;
  send(message: ClientToEngine): void;
  onMessage(handler: (message: EngineToClient) => void): void;
  close(): void;
}

export type Unsubscribe = () => void;
