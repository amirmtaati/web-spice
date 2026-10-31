/**
 * sim/types.ts — the UI-side type boundary (AGENTS.md §0): the rest of the
 * app imports engine wire types from HERE, never from @spicekit/* directly.
 * dependency-cruiser rule `only-sim-imports-spicekit-client` enforces it.
 */
import type { AnalysisRequest, SignalInfo } from "@spicekit/client";

export type {
  AnalysisRequest,
  Circuit,
  DataChunk,
  DcSweep,
  EngineCapabilities,
  EngineErrorPayload,
  EngineInfo,
  EngineLimits,
  LoadResult,
  ParamTarget,
  ProbeSpec,
  Progress,
  RunHandle,
  RunRequest,
  RunStats,
  SignalInfo,
  SimOptions,
  SimulatorClient,
  StreamOptions,
} from "@spicekit/client";
export { EngineError } from "@spicekit/client";

/** How a run streams: buffered (op/dc/ac/tf, bounded tran) or live (tran). */
export type RunMode = "buffered" | "live";

/** A run as tracked by the UI stores (resultStore/simStore). */
export interface ActiveRun {
  readonly runId: string;
  readonly analysis: AnalysisRequest;
  readonly mode: RunMode;
  /** Signal names in engine order (chunk order). */
  readonly signals: readonly SignalInfo[];
  /** First axis value seen (chunk tStart of the first chunk). */
  axisStart: number;
  /** Samples appended per signal so far (rings may be smaller: capacity). */
  count: number;
}
