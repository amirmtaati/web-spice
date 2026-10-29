/**
 * EngineAdapter seam (SPEC §2.1): lets a future ngspice-WASM backend replace
 * the core without UI changes. The stub adapter (client package) exercises
 * this interface in v1.
 */
import type {
  AnalysisRequest,
  Circuit,
  EngineCapabilities,
  EngineLimits,
} from "@spicekit/protocol";

export interface EngineAdapter {
  /** Validate + compile; returns node/branch tables and warnings. */
  loadCircuit(circuit: Circuit): Promise<LoadOutcome>;
  /** Start an analysis; returns a run id. */
  run(analysis: AnalysisRequest): Promise<string>;
  /** Pause/resume/stop/step an active run. */
  control(runId: string, op: "pause" | "resume" | "stop" | "step"): Promise<void>;
  dispose(): void;
  readonly capabilities: EngineCapabilities;
  readonly limits: EngineLimits;
}

export interface LoadOutcome {
  ok: boolean;
  nodeNames: string[];
  branchNames: string[];
  warnings: { code: string; message: string; line?: number }[];
}
