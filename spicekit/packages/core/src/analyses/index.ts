/**
 * Analyses (SPEC §5.5): OP (Newton + gmin/source-stepping/pseudo-transient
 * fallback ladder), DC sweep, AC, transient (BE/trap/Gear-2 with adaptive
 * stepping), noise, tf. Interfaces here; implementations land E1–E3.
 */
import type { AnalysisRequest } from "@spicekit/protocol";
import { EngineError } from "@spicekit/protocol";

export type AnalysisKind = AnalysisRequest["kind"];

export interface AnalysisProgress {
  kind: AnalysisKind;
  fraction: number;
  simTime: number;
}

export function runAnalysis(_request: AnalysisRequest): never {
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "Analyses land with milestones E1–E3 (SPEC §22).",
  });
}
