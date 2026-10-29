/**
 * @spicekit/protocol — public API (SPEC §4).
 * Named exports only; internal modules are not importable from outside.
 */

export type { EngineCapabilities, EngineLimits } from "./capabilities.ts";
export { DEFAULT_ENGINE_LIMITS } from "./capabilities.ts";
export type {
  AnalysisRequest,
  Circuit,
  DcSweep,
  Element,
  Expr,
  ModelCard,
  NodeId,
  ProbeSpec,
  SimOptions,
  Subcircuit,
  Waveform,
} from "./circuit.ts";
export { DEFAULT_SIM_OPTIONS } from "./circuit.ts";
export type { EngineErrorPayload, ErrorCode, ErrorLocation } from "./errors.ts";
export { EngineError, ERROR_CODES } from "./errors.ts";
export type {
  ClientToEngine,
  ControlMsg,
  DataMsg,
  DoneMsg,
  EngineToClient,
  Envelope,
  ErrorMsg,
  EvaluateMsg,
  EvaluateResultMsg,
  EvaluateResultPayload,
  ExportSpiceMsg,
  HelloMsg,
  LoadCircuitMsg,
  LoadResultPayload,
  LoadResultPayloadMsg,
  LoadSpiceMsg,
  NodeTableEntry,
  ParamTarget,
  ProgressMsg,
  ReadyMsg,
  RunAcceptedMsg,
  RunAcceptedPayload,
  RunControlOp,
  RunMsg,
  RunStats,
  SetExternalMsg,
  SetParamMsg,
  SignalInfo,
  SpiceMsg,
} from "./messages.ts";
export {
  circuitSchema,
  controlPayload,
  errorPayloadSchema,
  evaluatePayload,
  helloPayload,
  loadSpicePayload,
  requestSchema,
  runPayload,
  setExternalPayload,
  setParamPayload,
} from "./schema.ts";
export { isCompatibleProtocol, PROTOCOL_VERSION } from "./version.ts";
