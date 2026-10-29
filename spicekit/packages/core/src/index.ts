/**
 * @spicekit/core — public API. Grows with milestones E1–E4 (SPEC §22).
 */

export type { EngineAdapter, LoadOutcome } from "./adapter.ts";
export {
  type AnalysisKind,
  type AnalysisProgress,
  type RunResult,
  runAnalysis,
  type SignalSeries,
} from "./analyses/index.ts";
export { type CompiledCircuit, type CompiledElement, compile } from "./compiler/index.ts";
export {
  buildDevices,
  type Device,
  type DeviceEnv,
  type IntegrationMethod,
  type MatrixStamp,
} from "./devices/index.ts";
export { describeError, loadCircuit, simulateCircuit, simulateNetlist } from "./engine.ts";
export {
  compileExpression,
  type EvalContext,
  ParamScope,
  resolveExpr,
} from "./eval/index.ts";
export {
  abs,
  cos,
  exp,
  sin,
  sqrt,
  TAU,
  vThermal,
} from "./math/index.ts";
export {
  BUILTIN_MODEL_CARDS,
  builtinModel,
  builtinModelNames,
  canonicalModelType,
  knownModelParams,
  MODEL_TYPES_BY_ELEMENT,
  type ModelParamSpec,
  modelSpecsFor,
  modelTypeMismatch,
  specDefault,
  unknownModelParams,
} from "./models/index.ts";
export type { ParseDiagnostics, ParseResult } from "./parser/index.ts";
export {
  formatExact,
  formatValue,
  parseNetlist,
  parseValue,
  SuffixParseError,
  serializeNetlist,
  tryParseNetlist,
} from "./parser/index.ts";
export { luFactor, luSolve } from "./solver/index.ts";
