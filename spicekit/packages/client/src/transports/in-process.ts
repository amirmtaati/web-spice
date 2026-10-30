/**
 * In-process transport (SPEC §2.1): direct function-call delivery to a real
 * `EngineSession` (E4). Used by tests, the CLI, and hosts that don't need
 * worker isolation. Delivery is async (microtask) so request/response
 * correlation behaves like the async transports; the session's live-run
 * ticks flow through the stable reply closure after handle() returns.
 */
import { EngineSession, hostClock } from "@spicekit/core";
import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";
import type { Transport } from "../transport.ts";

export class InProcessTransport implements Transport {
  private readonly session = new EngineSession({ clock: hostClock() });
  private handler: ((message: EngineToClient) => void) | null = null;

  async start(): Promise<void> {
    // Nothing to open; handshake happens at the client level.
  }

  send(message: ClientToEngine): void {
    // Microtask keeps ordering and gives callers a chance to attach handlers.
    void Promise.resolve().then(() => {
      // The reply closure delegates to the current handler — stable across
      // messages, so the session may emit live-run events at any time.
      this.session.handle(message, (reply) => {
        this.handler?.(reply);
      });
    });
  }

  onMessage(handler: (message: EngineToClient) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.handler = null;
    this.session.dispose();
  }
}
