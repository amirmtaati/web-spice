/**
 * @spicekit/client — public API (SPEC §6).
 */

export type { EngineReply, SessionClock } from "@spicekit/core";
export type {
  AnalysisRequest,
  Circuit,
  DcSweep,
  Element,
  EngineCapabilities,
  EngineErrorPayload,
  EngineLimits,
  Expr,
  MeasureResult,
  MeasureSpec,
  NodeId,
  ParamTarget,
  ProbeSpec,
  RunStats,
  SignalInfo,
  SimOptions,
  Waveform,
} from "@spicekit/protocol";
// Protocol re-exports (AGENTS.md §0: the client re-exports every type the UI
// needs — hosts never deep-import @spicekit/protocol). Type-only except
// EngineError, which UIs need for `instanceof` (AGENTS.md §7.3).
export { EngineError } from "@spicekit/protocol";
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
import { createWebSocketTransport } from "./transports/websocket.ts";
import { createWorkerTransport } from "./transports/worker.ts";

/** Client over an in-process real engine session (tests, CLI, embedding). */
export function createInProcessClient(): SimulatorClient {
  return new SimulatorClientImpl(new InProcessTransport());
}

/** Client over a WebSocket engine host (`@spicekit/server`, SPEC §7.1). */
export function createWebSocketClient(
  url: string,
  options?: Parameters<typeof createWebSocketTransport>[1],
): SimulatorClient {
  return new SimulatorClientImpl(createWebSocketTransport(url, options));
}

/** Client over a Web Worker hosting the engine (default UI mode). */
export function createWorkerClient(
  workerUrl: URL | string,
  options?: Parameters<typeof createWorkerTransport>[1],
): SimulatorClient {
  return new SimulatorClientImpl(createWorkerTransport(workerUrl, options));
}
