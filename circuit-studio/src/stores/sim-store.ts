/**
 * simStore (UX2-T1, UI-UX-SPEC §7/§8.1): engine session state machine, typed
 * error surface, analysis selection, and run readouts. The FSM follows
 * AGENTS.md §3: idle → connecting → ready → loaded → running (live: paused)
 * with recovering/error overlays. The controller is the ONLY writer besides
 * the UI analysis options; components subscribe with fine-grained selectors.
 */
import { create } from "zustand";
import type {
  AnalysisRequest,
  EngineCapabilities,
  EngineErrorPayload,
  EngineInfo,
  LoadResult,
  RunStats,
} from "../sim/types.ts";

/**
 * Session states (AGENTS.md §3 diagram + §3.4 recovery):
 *  - idle: nothing connected yet
 *  - connecting: handshake in flight
 *  - ready: connected, no circuit loaded
 *  - loaded: circuit loaded (edits not yet applied keep this state)
 *  - running / paused: a run is active (live pause is a running substate)
 *  - recovering: transport lost; auto re-connect + reload in progress
 *  - error: last action failed; user-visible banner; reconnect available
 */
export type SessionState =
  | "idle"
  | "connecting"
  | "ready"
  | "loaded"
  | "running"
  | "paused"
  | "recovering"
  | "error";

/** Analysis settings held per kind so switching preserves each kind's options. */
export interface AnalysisOptions {
  op: Record<string, never>;
  dc: { source: string; start: number; stop: number; step: number };
  ac: { sweep: "dec" | "oct" | "lin"; points: number; fstart: number; fstop: number };
  tran: { tstep: number; tstop: number; tstart: number; uic: boolean };
  noise: {
    output: string;
    source: string;
    sweep: "dec" | "oct" | "lin";
    points: number;
    fstart: number;
    fstop: number;
  };
  tf: { output: string; source: string };
}

export type AnalysisKind = keyof AnalysisOptions;

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  op: {},
  dc: { source: "V1", start: 0, stop: 5, step: 0.1 },
  ac: { sweep: "dec", points: 20, fstart: 1, fstop: 1e6 },
  tran: { tstep: 1e-4, tstop: 0.01, tstart: 0, uic: false },
  noise: { output: "v(out)", source: "V1", sweep: "dec", points: 20, fstart: 1, fstop: 1e6 },
  tf: { output: "v(out)", source: "V1" },
};

/** Build the wire request from the selected kind + options. */
export function toAnalysisRequest(kind: AnalysisKind, o: AnalysisOptions): AnalysisRequest {
  switch (kind) {
    case "op":
      return { kind: "op" };
    case "dc":
      return {
        kind: "dc",
        source: o.dc.source,
        start: o.dc.start,
        stop: o.dc.stop,
        step: o.dc.step,
      };
    case "ac":
      return {
        kind: "ac",
        sweep: o.ac.sweep,
        points: o.ac.points,
        fstart: o.ac.fstart,
        fstop: o.ac.fstop,
      };
    case "tran": {
      const t0 = o.tran.tstart > 0 ? o.tran.tstart : undefined;
      const uic = o.tran.uic ? true : undefined;
      return {
        kind: "tran",
        tstep: o.tran.tstep,
        tstop: o.tran.tstop,
        ...(t0 === undefined ? {} : { tstart: t0 }),
        ...(uic === undefined ? {} : { uic }),
      };
    }
    case "noise":
      return {
        kind: "noise",
        output: o.noise.output,
        source: o.noise.source,
        sweep: o.noise.sweep,
        points: o.noise.points,
        fstart: o.noise.fstart,
        fstop: o.noise.fstop,
      };
    case "tf":
      return { kind: "tf", output: o.tf.output, source: o.tf.source };
  }
}

export interface SimError extends EngineErrorPayload {
  /** UI component id resolved via Circuit.sourceMap (§7.2), when known. */
  readonly componentId?: string;
  /** The offending netlist line text, when the error pinned a line. */
  readonly lineText?: string;
  /** "load" (loadSpice/loadCircuit failed) or "run" (a run failed). */
  readonly phase: "load" | "run" | "transport";
}

export interface SimState {
  readonly session: SessionState;
  readonly engineInfo: EngineInfo | null;
  readonly transportLabel: string;
  readonly loadResult: LoadResult | null;
  readonly error: SimError | null;
  readonly recovering: boolean;

  readonly analysisKind: AnalysisKind;
  readonly options: AnalysisOptions;
  readonly live: boolean;
  readonly speed: number;

  readonly runId: string | null;
  readonly progress: { fraction: number; simTime: number } | null;
  /** Sim time frozen at the pause transition (scope-like Stop readout).
   * Chunks already in flight keep appending to resultStore, but the readout
   * must not move while paused (UX2-T3 "pause freezes"). */
  readonly pausedSimTime: number | null;
  readonly stats: RunStats | null;
  /** How many runs completed since app start (run history chip). */
  readonly runCounter: number;

  // ── writers (controller + UI) ──
  setSession: (s: SessionState) => void;
  setEngineInfo: (info: EngineInfo | null) => void;
  setTransportLabel: (label: string) => void;
  setLoadResult: (r: LoadResult | null) => void;
  setError: (e: SimError | null) => void;
  setRecovering: (r: boolean) => void;
  setAnalysisKind: (k: AnalysisKind) => void;
  setOptions: <K extends AnalysisKind>(kind: K, patch: Partial<AnalysisOptions[K]>) => void;
  setLive: (live: boolean) => void;
  setSpeed: (factor: number) => void;
  setRunId: (id: string | null) => void;
  setProgress: (p: { fraction: number; simTime: number } | null) => void;
  setPausedSimTime: (t: number | null) => void;
  setStats: (s: RunStats | null) => void;
  bumpRunCounter: () => void;
}

export const useSimStore = create<SimState>((set) => ({
  session: "idle",
  engineInfo: null,
  transportLabel: "worker",
  loadResult: null,
  error: null,
  recovering: false,
  analysisKind: "tran",
  options: DEFAULT_ANALYSIS_OPTIONS,
  live: false,
  speed: 1,
  runId: null,
  progress: null,
  pausedSimTime: null,
  stats: null,
  runCounter: 0,

  setSession: (session) => set({ session }),
  setEngineInfo: (engineInfo) => set({ engineInfo }),
  setTransportLabel: (transportLabel) => set({ transportLabel }),
  setLoadResult: (loadResult) => set({ loadResult }),
  setError: (error) => set({ error }),
  setRecovering: (recovering) => set({ recovering }),
  setAnalysisKind: (analysisKind) => set({ analysisKind }),
  setOptions: (kind, patch) =>
    set((s) => ({
      options: { ...s.options, [kind]: { ...s.options[kind], ...patch } },
    })),
  setLive: (live) => set({ live }),
  setSpeed: (speed) => set({ speed: Math.min(10, Math.max(0.01, speed)) }),
  setRunId: (runId) => set({ runId }),
  setProgress: (progress) => set({ progress }),
  setPausedSimTime: (pausedSimTime) => set({ pausedSimTime }),
  setStats: (stats) => set({ stats }),
  bumpRunCounter: () => set((s) => ({ runCounter: s.runCounter + 1 })),
}));

/** Convenience: current analysis as a wire request (controller use). */
export function currentAnalysisRequest(
  s: Pick<SimState, "analysisKind" | "options">,
): AnalysisRequest {
  return toAnalysisRequest(s.analysisKind, s.options);
}

/** Capability gate (§7 rule 6): feature-detect, never version-sniff. */
export function supportsAnalysis(
  caps: EngineCapabilities | null | undefined,
  kind: AnalysisKind,
): boolean {
  return caps?.analyses.includes(kind) === true;
}
