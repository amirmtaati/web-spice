/**
 * WebSocket transport (SPEC §2.1, E4): talks to `@spicekit/server` using the
 * same JSON protocol as the worker transport. Automatic reconnect with
 * capped exponential backoff; in-flight requests fail fast on close so the
 * client can surface connection loss instead of hanging.
 */

import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";
import { EngineError } from "@spicekit/protocol";
import type { Transport } from "../transport.ts";

export interface WebSocketTransportOptions {
  /** Reconnect on unexpected close (default true). */
  reconnect?: boolean;
  /** Initial backoff in ms (default 250; doubles, capped at 5 s). */
  backoffMs?: number;
  /** Connection-state changes (for UI status chips). */
  onStateChange?: (state: "connecting" | "open" | "closed") => void;
}

export function createWebSocketTransport(
  url: string,
  options: WebSocketTransportOptions = {},
): Transport {
  return new WebSocketTransport(url, options);
}

interface MinimalSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", cb: () => void): void;
  addEventListener(type: "message", cb: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", cb: () => void): void;
  addEventListener(type: "error", cb: () => void): void;
}

class WebSocketTransport implements Transport {
  private socket: MinimalSocket | null = null;
  private handler: ((message: EngineToClient) => void) | null = null;
  private readonly reconnect: boolean;
  private readonly baseBackoff: number;
  private readonly onStateChange: ((state: "connecting" | "open" | "closed") => void) | undefined;
  private attempts = 0;
  private userClosed = false;
  private startPromise: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    options: WebSocketTransportOptions = {},
  ) {
    this.reconnect = options.reconnect ?? true;
    this.baseBackoff = options.backoffMs ?? 250;
    this.onStateChange = options.onStateChange;
  }

  async start(): Promise<void> {
    if (this.startPromise === null) {
      this.startPromise = this.open().then(() => {
        this.attempts = 0;
      });
    }
    await this.startPromise;
  }

  send(message: ClientToEngine): void {
    if (this.socket === null) {
      throw new EngineError({
        code: "E_PROTOCOL_VERSION",
        message: "WebSocket transport is not open",
      });
    }
    this.socket.send(JSON.stringify(message));
  }

  onMessage(handler: (message: EngineToClient) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.userClosed = true;
    this.handler = null;
    this.socket?.close();
    this.socket = null;
  }

  private open(): Promise<void> {
    this.onStateChange?.("connecting");
    const WebSocketCtor = (
      globalThis as unknown as {
        WebSocket: new (url: string) => MinimalSocket;
      }
    ).WebSocket;
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocketCtor(this.url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.onStateChange?.("open");
        resolve();
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return; // binary frames land with waveform bulk transfer (E4+)
        }
        try {
          this.handler?.(JSON.parse(event.data) as EngineToClient);
        } catch {
          // Malformed frame: drop it; the server is responsible for validity.
        }
      });
      socket.addEventListener("close", () => {
        this.onStateChange?.("closed");
        if (this.userClosed) {
          return;
        }
        // Fail in-flight requests fast; the client surfaces the disconnect.
        this.handler?.({
          id: "*",
          type: "error",
          payload: new EngineError({
            code: "E_PROTOCOL_VERSION",
            message: "WebSocket connection closed",
          }).toJSON(),
        });
        this.socket = null;
        if (this.reconnect) {
          this.scheduleReconnect();
        }
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        reject(
          new EngineError({
            code: "E_PROTOCOL_VERSION",
            message: `WebSocket failed to connect to ${this.url}`,
          }),
        );
      });
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.baseBackoff * 2 ** this.attempts, 5000);
    this.attempts += 1;
    setTimeout(() => {
      if (this.userClosed || this.socket !== null) {
        return;
      }
      void this.open()
        .then(() => {
          this.attempts = 0;
        })
        .catch(() => {
          this.scheduleReconnect();
        });
    }, delay);
  }
}
