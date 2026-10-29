/**
 * In-process transport (SPEC §2.1): direct function-call delivery, used by
 * tests, the CLI, and (transiently) the UI shell until the worker transport
 * lands. Delivery is async (microtask) so request/response correlation code
 * paths are identical to the async transports.
 */
import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";
import { StubEngine } from "../stub-engine.ts";
import type { Transport } from "../transport.ts";

export class InProcessTransport implements Transport {
  private readonly engine = new StubEngine();
  private handler: ((message: EngineToClient) => void) | null = null;

  async start(): Promise<void> {
    // Nothing to open; handshake happens at the client level.
  }

  send(message: ClientToEngine): void {
    // Microtask keeps ordering and gives callers a chance to attach handlers.
    // (Promise.resolve().then == queueMicrotask, typed in every runtime lib.)
    void Promise.resolve().then(() => {
      this.engine.handle(message, (reply) => {
        this.handler?.(reply);
      });
    });
  }

  onMessage(handler: (message: EngineToClient) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.handler = null;
  }
}
