/**
 * @spicekit/core — public API. Grows with milestones E1–E4 (SPEC §22).
 */

export type { EngineAdapter, LoadOutcome } from "./adapter.ts";
export { type AnalysisKind, type AnalysisProgress, runAnalysis } from "./analyses/index.ts";
export { type CompiledCircuit, compile } from "./compiler/index.ts";
export {
  DEVICE_LIBRARY_V1,
  type Device,
  type DeviceKind,
  type IntegrationMethod,
  type StampContext,
  type StateContext,
} from "./devices/index.ts";
export { abs, cos, exp, sin, sqrt, TAU, vThermal } from "./math/index.ts";
export type { ParseDiagnostics, ParseResult } from "./parser/index.ts";
export {
  formatValue,
  parseNetlist,
  parseValue,
  SuffixParseError,
  serializeNetlist,
} from "./parser/index.ts";
export { luFactor, luSolve } from "./solver/index.ts";
