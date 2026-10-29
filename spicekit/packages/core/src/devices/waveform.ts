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

export interface WaveEval {
  valueAt(t: number): number;
  /** Next source discontinuity strictly after t, or undefined. */
  nextBreakpoint(t: number): number | undefined;
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
  | { kind: "PWL"; points: [number, number][]; repeat: boolean };

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
    case "EXP":
    case "SFFM":
    case "AM":
    case "NOISE":
    case "EXTERNAL":
    case "TRIANGLE":
    case "SAWTOOTH":
    case "SQUARE":
      throw new Error(`resolveWave: unsupported waveform "${w.kind}" (E2/E3)`);
  }
}

export function createWaveEval(w: ResolvedWave): WaveEval {
  switch (w.kind) {
    case "SIN":
      return sinEval(w);
    case "PULSE":
      return pulseEval(w);
    case "PWL":
      return pwlEval(w);
  }
}

function sinEval(w: Extract<ResolvedWave, { kind: "SIN" }>): WaveEval {
  const omega = TAU * w.freq;
  return {
    valueAt(t: number): number {
      if (t <= w.delay) {
        return w.offset;
      }
      const dt = t - w.delay;
      return w.offset + w.amp * sin(omega * dt + w.phase) * exp(-w.damping * dt);
    },
    nextBreakpoint(t: number): number | undefined {
      return t < w.delay ? w.delay : undefined;
    },
  };
}

function pulseEval(w: Extract<ResolvedWave, { kind: "PULSE" }>): WaveEval {
  // Degenerate periods fall back to a single ramp+width+fall cycle.
  const per = w.period > 0 ? w.period : w.rise + w.width + w.fall;
  /** Shape within one period: v1 —rise→ v2 —width→ v2 —fall→ v1. */
  const shape = (phase: number): number => {
    if (phase < w.rise) {
      return w.rise === 0 ? w.v2 : w.v1 + (w.v2 - w.v1) * (phase / w.rise);
    }
    if (phase < w.rise + w.width) {
      return w.v2;
    }
    if (phase < w.rise + w.width + w.fall) {
      return w.fall === 0 ? w.v1 : w.v2 + (w.v1 - w.v2) * ((phase - w.rise - w.width) / w.fall);
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
    nextBreakpoint(t: number): number | undefined {
      if (t < w.delay) {
        return w.delay;
      }
      // Next edge: scan candidate edges in the current and next cycle.
      const cycle = Math.floor((t - w.delay) / per);
      for (let c = cycle; c <= cycle + 1; c++) {
        for (const edge of [w.rise, w.rise + w.width, w.rise + w.width + w.fall, per]) {
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
