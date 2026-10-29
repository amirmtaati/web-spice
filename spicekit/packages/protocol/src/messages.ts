/**
 * Client ⇄ engine messages (SPEC §4.3). Every request carries an `id`; every
 * response references it. Control messages are JSON validated with zod
 * (`schema.ts`); bulk waveform data moves as transferable typed arrays /
 * binary frames (framing lands with the worker transport, SPEC §2.1).
 */

import type { EngineCapabilities, EngineLimits } from "./capabilities.ts";
import type { AnalysisRequest, Circuit, ProbeSpec } from "./circuit.ts";
import type { EngineErrorPayload } from "./errors.ts";

/** Every message on the wire has this envelope shape. */
export interface Envelope {
  id: string;
  type: string;
  payload?: unknown;
}

// ─── Handshake ────────────────────────────────────────────────────────────────

export interface HelloMsg {
  id: string;
  type: "hello";
  payload: { protocol: string };
}

export interface ReadyMsg {
  id: string;
  type: "ready";
  payload: {
    engineVersion: string;
    capabilities: EngineCapabilities;
    limits: EngineLimits;
  };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export interface LoadCircuitMsg {
  id: string;
  type: "loadCircuit";
  payload: { circuit: Circuit };
}

export interface LoadSpiceMsg {
  id: string;
  type: "loadSpice";
  payload: { text: string };
}

export interface NodeTableEntry {
  name: string;
  index: number;
}

export interface LoadResultPayload {
  ok: true;
  nodeTable: NodeTableEntry[];
  branchTable: NodeTableEntry[];
  warnings: { code: string; message: string; line?: number }[];
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export interface RunMsg {
  id: string;
  type: "run";
  payload: {
    analysis: AnalysisRequest;
    stream?: { mode: "buffered" | "live"; realtimeFactor?: number };
    probes?: ProbeSpec[];
  };
}

export interface RunAcceptedPayload {
  ok: true;
  runId: string;
}

export type RunControlOp = "pause" | "resume" | "stop" | "step";

export interface ControlMsg {
  id: string;
  type: "control";
  payload: { runId: string; op: RunControlOp };
}

export interface SetParamMsg {
  id: string;
  type: "setParam";
  payload: { runId: string; target: ParamTarget; value: number };
}

/** Identifies a live-tunable parameter (SPEC §4.4). */
export interface ParamTarget {
  elementName: string;
  property: "value" | "amplitude" | "frequency" | "offset" | "dutyCycle" | "wiper" | "switchState";
}

export interface SetExternalMsg {
  id: string;
  type: "setExternal";
  payload: { runId: string; channel: string; value: number | number[] };
}

export interface EvaluateMsg {
  id: string;
  type: "evaluate";
  payload: { expr: string; context?: Record<string, number> };
}

export interface EvaluateResultPayload {
  ok: true;
  value: number;
}

// ─── Streaming results ────────────────────────────────────────────────────────

export interface ProgressMsg {
  id: string;
  type: "progress";
  payload: { runId: string; fraction: number; simTime: number };
}

export interface SignalInfo {
  name: string;
  unit: "v" | "a" | "w" | "hz" | "db";
  kind: "voltage" | "current" | "power" | "frequency";
}

/**
 * Chunked results. `chunk` holds per-signal sample arrays; over the worker
 * transport these are typed arrays transferred zero-copy (SPEC §2.1). Binary
 * WebSocket framing lands with E4; JSON arrays are the scaffold placeholder.
 */
export interface DataMsg {
  id: string;
  type: "data";
  payload: {
    runId: string;
    signals: SignalInfo[];
    tStart: number;
    chunk: { name: string; samples: number[] | Float64Array }[];
  };
}

export interface RunStats {
  timesteps: number;
  rejectedSteps: number;
  newtonIterations: number;
  method?: string;
  fallbackUsed?: boolean;
}

export interface DoneMsg {
  id: string;
  type: "done";
  payload: { runId: string; stats: RunStats };
}

export interface ErrorMsg {
  id: string;
  type: "error";
  payload: EngineErrorPayload;
}

// ─── Netlist export ───────────────────────────────────────────────────────────

export interface ExportSpiceMsg {
  id: string;
  type: "exportSpice";
}

export interface SpiceMsg {
  id: string;
  type: "spice";
  payload: { text: string };
}

export type ClientToEngine =
  | HelloMsg
  | LoadCircuitMsg
  | LoadSpiceMsg
  | RunMsg
  | ControlMsg
  | SetParamMsg
  | SetExternalMsg
  | EvaluateMsg
  | ExportSpiceMsg;

export type EngineToClient =
  | ReadyMsg
  | LoadResultPayloadMsg
  | RunAcceptedMsg
  | ProgressMsg
  | DataMsg
  | DoneMsg
  | ErrorMsg
  | SpiceMsg
  | EvaluateResultMsg;

/** `loadCircuit`/`loadSpice` replies reuse the load result payload. */
export interface LoadResultPayloadMsg {
  id: string;
  type: "loadResult";
  payload: LoadResultPayload;
}

export interface RunAcceptedMsg {
  id: string;
  type: "runAccepted";
  payload: RunAcceptedPayload;
}

export interface EvaluateResultMsg {
  id: string;
  type: "evaluateResult";
  payload: EvaluateResultPayload;
}
