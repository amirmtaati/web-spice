/**
 * @spicekit/client — public API (SPEC §6).
 */

export type { EngineReply, SessionClock } from "@spicekit/core";
export type {
  DataChunk,
  EngineInfo,
  LoadResult,
  Progress,
  RunHandle,
  RunRequest,
  SimulatorClient,
  StreamOptions,
} from "./client.ts";
export { SimulatorClientImpl } from "./client.ts";
export type { ConformanceReport } from "./conformance.ts";
export { basicCircuit, runClientConformance } from "./conformance.ts";
export type { Transport, Unsubscribe } from "./transport.ts";
export { InProcessTransport } from "./transports/in-process.ts";
export { createWebSocketTransport } from "./transports/websocket.ts";
export { createWorkerTransport } from "./transports/worker.ts";

import type { SimulatorClient } from "./client.ts";
import { SimulatorClientImpl } from "./client.ts";
import { InProcessTransport } from "./transports/in-process.ts";

/** Client over an in-process real engine session (tests, CLI, embedding). */
export function createInProcessClient(): SimulatorClient {
  return new SimulatorClientImpl(new InProcessTransport());
}
