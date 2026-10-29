/**
 * Engine capabilities and limits advertised in `ready` (SPEC §4.3, §4.5) so
 * any GUI can adapt to the connected engine.
 */

export interface EngineCapabilities {
  analyses: ("op" | "dc" | "ac" | "tran" | "noise" | "tf")[];
  devices: string[];
  waveforms: string[];
  liveParamMode: boolean;
  streaming: ("buffered" | "live")[];
}

export interface EngineLimits {
  maxElements: number;
  maxNodes: number;
  maxTimestepsPerRun: number;
  maxOutputSamples: number;
  maxNetlistBytes: number;
  maxSubcktNesting: number;
  maxIncludeDepth: number;
  maxRunWallClockMs?: number;
}

/** Conservative defaults (SPEC §16); a server may tighten them per run. */
export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  maxElements: 50_000,
  maxNodes: 50_000,
  maxTimestepsPerRun: 10_000_000,
  maxOutputSamples: 50_000_000,
  maxNetlistBytes: 10 * 1024 * 1024,
  maxSubcktNesting: 32,
  maxIncludeDepth: 8,
};
