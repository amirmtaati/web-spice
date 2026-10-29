/**
 * Circuit IR — canonical JSON between UI and engine (SPEC §4.1).
 * SPICE text parses into the IR; the IR serializes back to SPICE.
 * Unknown fields are preserved (extensibility, SPEC §4.5).
 */

/** Node names; "0" is ground. Case-insensitive on SPICE import. */
export type NodeId = string;

/** Number or `{expr}` string evaluated by the engine (SPEC §4.1). */
export type Expr = number | string;

export interface Circuit {
  title: string;
  elements: Element[];
  models: Record<string, ModelCard>;
  subcircuits: Record<string, Subcircuit>;
  params: Record<string, number | string>;
  options: SimOptions;
  analyses: AnalysisRequest[];
  probes: ProbeSpec[];
  /** `.measure` cards (E3): evaluated after each analysis run. */
  measures?: MeasureSpec[];
  /** Node initial conditions from `.ic v(n)=value` (SPEC §5.5). */
  ic?: Record<NodeId, number>;
  /** element/node name -> UI component id, for error pinning (SPEC §9.8). */
  sourceMap?: Record<string, string>;
}

export interface ModelCard {
  name: string;
  type: string; // e.g. "npn", "diode", "nmos"
  parameters: Record<string, number | string>;
}

export interface Subcircuit {
  name: string;
  ports: NodeId[];
  circuit: Circuit;
}

export type Element =
  | { type: "R"; name: string; n: [NodeId, NodeId]; value: Expr; tc1?: number; tc2?: number }
  | { type: "C"; name: string; n: [NodeId, NodeId]; value: Expr; ic?: number }
  | { type: "L"; name: string; n: [NodeId, NodeId]; value: Expr; ic?: number }
  | { type: "K"; name: string; inductors: [string, string]; coupling: Expr }
  | {
      type: "V" | "I";
      name: string;
      n: [NodeId, NodeId];
      dc?: Expr;
      ac?: { mag: number; phase?: number };
      wave?: Waveform;
    }
  | { type: "E" | "G" | "F" | "H"; name: string; n: NodeId[]; [k: string]: unknown } // dependent sources
  | { type: "B"; name: string; n: [NodeId, NodeId]; kind: "V" | "I"; expr: string } // behavioral
  | { type: "D"; name: string; n: [NodeId, NodeId]; model: string; area?: number }
  | { type: "Q"; name: string; n: [NodeId, NodeId, NodeId]; model: string; area?: number }
  | {
      type: "M";
      name: string;
      n: [NodeId, NodeId, NodeId, NodeId];
      model: string;
      w?: Expr;
      l?: Expr;
    }
  | { type: "J"; name: string; n: [NodeId, NodeId, NodeId]; model: string; area?: number }
  | {
      type: "S";
      name: string;
      n: [NodeId, NodeId];
      /** Voltage-controlled: control terminals (nc+, nc-). */
      ctrl: [NodeId, NodeId];
      model: string;
      /** Initial state from the ON/OFF card suffix. */
      on?: boolean;
    }
  | {
      type: "W";
      name: string;
      n: [NodeId, NodeId];
      /** Current-controlled: name of the controlling V source. */
      control: string;
      model: string;
      on?: boolean;
    }
  | { type: "X"; name: string; n: NodeId[]; subckt: string; params?: Record<string, Expr> };

export type Waveform =
  | {
      kind: "SIN";
      offset: Expr;
      amp: Expr;
      freq: Expr;
      delay?: Expr;
      damping?: Expr;
      phase?: Expr;
    }
  | {
      kind: "PULSE";
      v1: Expr;
      v2: Expr;
      delay: Expr;
      rise: Expr;
      fall: Expr;
      width: Expr;
      period: Expr;
    }
  | { kind: "PWL"; points: [number, number][]; repeat?: boolean }
  | { kind: "EXP" | "SFFM" | "AM"; [k: string]: unknown }
  | { kind: "TRIANGLE" | "SAWTOOTH" | "SQUARE"; [k: string]: unknown } // compiled to PWL/PULSE
  | { kind: "NOISE"; rms: Expr; bandwidth?: Expr; seed?: number }
  | { kind: "EXTERNAL"; channel: string }; // live values from the host (SPEC §4.4)

export type AnalysisRequest =
  | { kind: "op" }
  | { kind: "dc"; source: string; start: number; stop: number; step: number; second?: DcSweep }
  | { kind: "ac"; sweep: "dec" | "oct" | "lin"; points: number; fstart: number; fstop: number }
  | { kind: "tran"; tstep: number; tstop: number; tstart?: number; tmax?: number; uic?: boolean }
  | {
      kind: "noise";
      output: string;
      source: string;
      sweep: "dec" | "oct" | "lin";
      points: number;
      fstart: number;
      fstop: number;
    }
  | { kind: "tf"; output: string; source: string };

export interface DcSweep {
  source: string;
  start: number;
  stop: number;
  step: number;
}

/** `.probe`/UI probe: which signals to stream back. */
export interface ProbeSpec {
  signal: string; // "v(out)", "i(R1)", "p(C1)"
}

/**
 * `.measure` specification (E3, "basic .measure"): one post-processing
 * measurement over a finished analysis result.
 */
export interface MeasureSpec {
  /** Which analysis kind this measure applies to. */
  analysis: "tran" | "ac" | "dc" | "op";
  /** Result name as written on the card. */
  name: string;
  /** Measurement function. */
  mode: "find" | "max" | "min" | "avg" | "rms" | "pp" | "integ";
  /** Signal reference, e.g. "v(out)" or "i(v1)". */
  expr: string;
  /** FIND … AT=<axis value> (time or frequency). */
  at?: number;
  /** FIND … WHEN <expr>=<value> [RISE|FALL|CROSS[=n]]. */
  when?: { expr: string; value: number; edge: "rise" | "fall" | "cross"; count: number };
  /** Window start for MAX/MIN/AVG/RMS/PP/INTEG (axis units). */
  from?: number;
  /** Window end. */
  to?: number;
}

/** Evaluated `.measure` result attached to a run. */
export interface MeasureResult {
  name: string;
  value: number;
  /** false when the condition never matched (value is then NaN). */
  found: boolean;
}

/**
 * Numerical options (SPEC §5.9). Defaults here are the contract; changing
 * them requires an ADR plus reference-suite results.
 */
export interface SimOptions {
  reltol: number; // default 1e-3
  abstol: number; // default 1e-12
  vntol: number; // default 1e-6
  gmin: number; // default 1e-12
  itl1: number; // default 100
  itl4: number; // default 10
  trtol: number; // default 7
  method: "trap" | "be" | "gear2"; // default "trap"
  temp: number; // default 27 (°C)
  tnom: number; // default 27 (°C)
  maxStepRatio?: number;
  seed?: number;
  /**
   * OP fallback-ladder controls (ngspice-compatible, SPEC §5.5):
   *  - noopiter=1 skips the direct Newton attempt and enters the ladder at
   *    gmin stepping (ngspice `.options noopiter`).
   *  - gminsteps / srcsteps set the number of continuation stages for the
   *    gmin and source rungs (ngspice `gminsteps`/`srcsteps`); 0 skips the
   *    rung. Defaults 10/10 when unset.
   */
  noopiter?: number;
  gminsteps?: number;
  srcsteps?: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  reltol: 1e-3,
  abstol: 1e-12,
  vntol: 1e-6,
  gmin: 1e-12,
  itl1: 100,
  itl4: 10,
  trtol: 7,
  method: "trap",
  temp: 27,
  tnom: 27,
};
