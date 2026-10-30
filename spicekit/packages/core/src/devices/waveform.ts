/**
 * Waveform source evaluation (SPEC §5.8): SIN, PULSE, PWL with allocation-
 * free evaluation and breakpoint enumeration for the adaptive timestep
 * controller (SPEC §5.5). Expressions resolve once at device build time
 * (`resolveWave`); evaluation (`createWaveEval`) is then pure arithmetic.
 */

import type { Waveform } from "@spicekit/protocol";
import type { EvalContext } from "../eval/index.ts";
import { resolveExpr } from "../eval/index.ts";
import { exp, PI, sin, TAU } from "../math/index.ts";

/** Live-tunable source properties (SPEC §4.4 setParam). */
export type LiveWaveProperty = "amplitude" | "frequency" | "offset" | "dutyCycle";

/** Registry of live EXTERNAL channel values (SPEC §4.4 setExternal). */
export interface ExternalChannels {
  /** Value of `channel` right now (zero-order hold); 0 when unset. */
  value(channel: string): number;
  /**
   * Replace the channel's sample series: sample k applies from
   * tStart + k·tStep (zero-order hold), holding the last value forever.
   */
  setSeries(channel: string, samples: number[] | Float64Array, tStart: number, tStep: number): void;
}

/** No-op registry: EXTERNAL channels read 0 until a host feeds them. */
export const nullExternals: ExternalChannels = {
  value: () => 0,
  setSeries: () => {},
};

export interface WaveEval {
  valueAt(t: number): number;
  /** Next source discontinuity strictly after t, or undefined. */
  nextBreakpoint(t: number): number | undefined;
  /**
   * Live parameter change at sim-time tNow (E4, SPEC §4.4). Frequency
   * changes accumulate phase — the value stays continuous by construction
   * ("no phase glitch"), and between retunes valueAt remains a pure
   * function of t (safe under step retries).
   */
  retune?(property: LiveWaveProperty, value: number, tNow: number): void;
}

/** Waveform with every Expr resolved to a number. */
export type ResolvedWave =
  | {
      kind: "SIN";
      offset: number;
      amp: number;
      freq: number;
      delay: number;
      damping: number;
      phase: number;
    }
  | {
      kind: "PULSE";
      v1: number;
      v2: number;
      delay: number;
      rise: number;
      fall: number;
      width: number;
      period: number;
    }
  | { kind: "PWL"; points: [number, number][]; repeat: boolean }
  | { kind: "EXTERNAL"; channel: string };

/** Resolve a protocol Waveform into numbers using the given scope. */
export function resolveWave(w: Waveform, scope: EvalContext): ResolvedWave {
  switch (w.kind) {
    case "SIN":
      return {
        kind: "SIN",
        offset: resolveExpr(w.offset, scope),
        amp: resolveExpr(w.amp, scope),
        freq: resolveExpr(w.freq, scope),
        delay: w.delay !== undefined ? resolveExpr(w.delay, scope) : 0,
        damping: w.damping !== undefined ? resolveExpr(w.damping, scope) : 0,
        phase: w.phase !== undefined ? (resolveExpr(w.phase, scope) * PI) / 180 : 0,
      };
    case "PULSE":
      return {
        kind: "PULSE",
        v1: resolveExpr(w.v1, scope),
        v2: resolveExpr(w.v2, scope),
        delay: resolveExpr(w.delay, scope),
        rise: Math.max(resolveExpr(w.rise, scope), 0),
        fall: Math.max(resolveExpr(w.fall, scope), 0),
        width: Math.max(resolveExpr(w.width, scope), 0),
        period: Math.max(resolveExpr(w.period, scope), 0),
      };
    case "PWL":
      return { kind: "PWL", points: w.points, repeat: w.repeat === true };
    case "EXTERNAL":
      return { kind: "EXTERNAL", channel: w.channel };
    case "EXP":
    case "SFFM":
    case "AM":
    case "NOISE":
    case "TRIANGLE":
    case "SAWTOOTH":
    case "SQUARE":
      throw new Error(`resolveWave: unsupported waveform "${w.kind}" (E2/E3)`);
  }
}

export function createWaveEval(
  w: ResolvedWave,
  externals: ExternalChannels = nullExternals,
): WaveEval {
  switch (w.kind) {
    case "SIN":
      return sinEval(w);
    case "PULSE":
      return pulseEval(w);
    case "PWL":
      return pwlEval(w);
    case "EXTERNAL":
      return externalEval(w.channel, externals);
  }
}

/**
 * SIN with live retuning (E4). Phase is referenced to a frozen anchor
 * (refT, refPhase) instead of computed from absolute time: a frequency
 * change at tNow folds `omega·(tNow − refT)` into refPhase and re-anchors,
 * so the value is continuous by construction (SPEC §4.4 "no phase glitch")
 * and valueAt stays a pure function of t between retunes — safe under the
 * stepper's reject-and-retry. With no retune this is exactly the classic
 * `sin(ω·dt + phase)` form.
 */
function sinEval(w: Extract<ResolvedWave, { kind: "SIN" }>): WaveEval {
  let amp = w.amp;
  let offset = w.offset;
  let omega = TAU * w.freq;
  let refT = w.delay;
  let refPhase = w.phase;
  return {
    valueAt(t: number): number {
      if (t <= w.delay) {
        return offset;
      }
      const dt = t - w.delay;
      return offset + amp * sin(refPhase + omega * (t - refT)) * exp(-w.damping * dt);
    },
    retune(property: LiveWaveProperty, value: number, tNow: number): void {
      if (property === "amplitude") {
        amp = value;
      } else if (property === "offset") {
        offset = value;
      } else if (property === "frequency") {
        if (!(value > 0)) {
          throw new Error(`retune: frequency must be > 0, got ${value}`);
        }
        refPhase += omega * (tNow - refT);
        refT = tNow;
        omega = TAU * value;
      } else {
        throw new Error(`retune: SIN sources do not support "${property}"`);
      }
    },
    nextBreakpoint(t: number): number | undefined {
      return t < w.delay ? w.delay : undefined;
    },
  };
}

function pulseEval(w: Extract<ResolvedWave, { kind: "PULSE" }>): WaveEval {
  // Degenerate periods fall back to a single ramp+width+fall cycle.
  const per = w.period > 0 ? w.period : w.rise + w.width + w.fall;
  let width = w.width;
  /** Shape within one period: v1 —rise→ v2 —width→ v2 —fall→ v1. */
  const shape = (phase: number): number => {
    if (phase < w.rise) {
      return w.rise === 0 ? w.v2 : w.v1 + (w.v2 - w.v1) * (phase / w.rise);
    }
    if (phase < w.rise + width) {
      return w.v2;
    }
    if (phase < w.rise + width + w.fall) {
      return w.fall === 0 ? w.v1 : w.v2 + (w.v1 - w.v2) * ((phase - w.rise - width) / w.fall);
    }
    return w.v1;
  };

  return {
    valueAt(t: number): number {
      if (t <= w.delay) {
        return w.v1;
      }
      return shape((t - w.delay) % per);
    },
    retune(property: LiveWaveProperty, value: number): void {
      if (property === "dutyCycle") {
        // Live duty control: width = duty·period (0 < duty < 1).
        if (!(value > 0 && value < 1) || !(per > 0)) {
          throw new Error(
            `retune: dutyCycle must be in (0,1) with period > 0, got ${value}/${per}`,
          );
        }
        width = value * per;
      } else {
        throw new Error(`retune: PULSE sources support only "dutyCycle", got "${property}"`);
      }
    },
    nextBreakpoint(t: number): number | undefined {
      if (t < w.delay) {
        return w.delay;
      }
      // Next edge: scan candidate edges in the current and next cycle.
      const cycle = Math.floor((t - w.delay) / per);
      for (let c = cycle; c <= cycle + 1; c++) {
        for (const edge of [w.rise, w.rise + width, w.rise + width + w.fall, per]) {
          const candidate = w.delay + c * per + edge;
          if (candidate > t) {
            return candidate;
          }
        }
      }
      return undefined;
    },
  };
}

function pwlEval(w: Extract<ResolvedWave, { kind: "PWL" }>): WaveEval {
  const points = w.points;
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? [0, 0];
  const span = last[0] - first[0];
  const repeat = w.repeat && span > 0;

  const valueAt = (t: number): number => {
    if (t <= first[0]) {
      return first[1];
    }
    let tt = t;
    if (repeat && t > last[0]) {
      tt = first[0] + ((t - first[0]) % span);
    } else if (!repeat && t >= last[0]) {
      return last[1];
    }
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1] as [number, number];
      const cur = points[i] as [number, number];
      if (tt <= cur[0]) {
        const f = (tt - prev[0]) / (cur[0] - prev[0]);
        return prev[1] + f * (cur[1] - prev[1]);
      }
    }
    return last[1];
  };

  return {
    valueAt,
    nextBreakpoint(t: number): number | undefined {
      if (!repeat) {
        for (const [pt] of points) {
          if (pt > t) {
            return pt;
          }
        }
        return undefined;
      }
      // Repeating: smallest point-time + n·span strictly greater than t.
      let best: number | undefined;
      for (let i = 1; i < points.length; i++) {
        const pt = (points[i] as [number, number])[0];
        const n = Math.ceil((t - pt) / span);
        const candidate = pt + n * span;
        if (candidate > t && (best === undefined || candidate < best)) {
          best = candidate;
        }
      }
      return best;
    },
  };
}

/**
 * EXTERNAL channel (E4, SPEC §4.4): the value comes from the host through
 * the session's channel registry — zero-order hold over the latest scalar
 * or over a sample series (sample k applies from tStart + k·tStep). No
 * breakpoints: the host drives discontinuities via setParam-ordered
 * restarts, and the stepper's own LTE control handles smooth variation.
 */
function externalEval(channel: string, externals: ExternalChannels): WaveEval {
  const key = channel.toLowerCase();
  return {
    valueAt(_t: number): number {
      return externals.value(key);
    },
    nextBreakpoint(): number | undefined {
      return undefined;
    },
  };
}
