/**
 * @spicekit/client — public API (SPEC §6).
 */

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
export { runClientConformance } from "./conformance.ts";
export type { EngineReply } from "./stub-engine.ts";
export { StubEngine, stubCircuit } from "./stub-engine.ts";
export type { Transport, Unsubscribe } from "./transport.ts";
export { InProcessTransport } from "./transports/in-process.ts";
export { createWebSocketTransport } from "./transports/websocket.ts";
export { createWorkerTransport } from "./transports/worker.ts";

import type { SimulatorClient } from "./client.ts";
import { SimulatorClientImpl } from "./client.ts";
import { InProcessTransport } from "./transports/in-process.ts";

/** Client over the in-process stub engine (tests, CLI, scaffold UI shell). */
export function createInProcessClient(): SimulatorClient {
  return new SimulatorClientImpl(new InProcessTransport());
}
