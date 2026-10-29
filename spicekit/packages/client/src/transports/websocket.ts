/**
 * WebSocket transport (SPEC §2.1): talks to `@spicekit/server` using the same
 * protocol as the worker transport. Automatic reconnect, binary bulk-data
 * frames, and backpressure handling land with E4 — SPEC §22.
 */
import { EngineError } from "@spicekit/protocol";
import type { Transport } from "../transport.ts";

export function createWebSocketTransport(_url: string): Transport {
  void _url;
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "WebSocket transport lands with milestone E4 (SPEC §22).",
  });
}
