/**
 * scopeStore (UX3-T1..T5, UI-UX-SPEC §6.7.1): oscilloscope configuration —
 * channels (max 8), per-channel style/offset/invert, timebase, trigger,
 * cursors, measurements, math channels, active experiment (annotations +
 * callout), and run-history overlay. Zustand + fine selectors; the pipeline
 * reads via getState() inside the frame loop (never a React subscriber).
 */
import { create } from "zustand";
import type { MathOp } from "../math.ts";
import { CURSORS_OFF, type CursorState } from "./cursors.ts";
import type { MeasurementRow } from "./measure.ts";
import type { TriggerEdge } from "./trigger.ts";

export const MAX_CHANNELS = 8;

/** One scope channel: a probe signal or a math waveform. */
export interface ScopeChannel {
  /** Signal name ("v(out)", "i(C1)") or math id ("math:1"). */
  readonly id: string;
  /** Display label (math channels get "A+B" style labels). */
  readonly label: string;
  /** Palette index (1–8) resolved to --sig-N per theme. */
  readonly colorIndex: number;
  readonly visible: boolean;
  /** Vertical offset in data units (added after invert). */
  readonly offset: number;
  readonly invert: boolean;
  /** Math transform when this is a math channel. */
  readonly math?: MathOp;
}

export type TriggerMode = "auto" | "normal" | "single";

export interface TriggerState {
  /** Trigger source channel id (signal name); null = first channel. */
  readonly source: string | null;
  readonly level: number;
  readonly edge: TriggerEdge;
  readonly mode: TriggerMode;
  /** Blind time between accepted triggers (seconds). */
  readonly holdoffSec: number;
  /** Single-shot arming (mode "single" only). */
  readonly armed: boolean;
}

export interface ScopeState {
  readonly channels: readonly ScopeChannel[];
  readonly activeChannelId: string | null;

  /** s/div from the 1-2-5 decades (window = 10 divisions). */
  readonly secPerDiv: number;
  /** Horizontal position: fraction of the window BEFORE the trigger (0.5 = centered). */
  readonly position: number;
  /** Y axis: auto-fit or fixed volts-per-division. */
  readonly yAuto: boolean;
  readonly voltsPerDiv: number;
  /** Live roll mode (scrolling window, §6.7.1). */
  readonly roll: boolean;

  readonly trigger: TriggerState;
  readonly cursors: CursorState;
  /** Automatic measurements column (4 Hz refresh in the legend). */
  readonly showMeasurements: boolean;
  /** Run-history ghost overlay (last 5 runs, §6.7.4/UX3-T8). */
  readonly showHistory: boolean;

  /** Active experiment (annotations + callout card), null when none. */
  readonly experiment: ExperimentContext | null;
  readonly calloutPinned: boolean;
  readonly calloutDismissed: boolean;
  /** Last "Estimate τ from cursor" result (§6.7.4). */
  readonly tauEstimate: TauEstimate | null;
  /** Custom `evaluate` expression for the active-channel readout. */
  readonly customExpr: string | null;

  addChannel: (signal: string) => void;
  addMathChannel: (op: MathOp, label: string) => void;
  removeChannel: (id: string) => void;
  updateChannel: (id: string, patch: Partial<Omit<ScopeChannel, "id" | "math">>) => void;
  setActiveChannel: (id: string | null) => void;
  /** Experiment/probe bulk selection (replaces the channel list). */
  selectSignals: (signals: readonly string[]) => void;
  setSecPerDiv: (v: number) => void;
  setPosition: (v: number) => void;
  setYAuto: (v: boolean) => void;
  setVoltsPerDiv: (v: number) => void;
  setRoll: (v: boolean) => void;
  updateTrigger: (patch: Partial<Omit<TriggerState, "armed">>) => void;
  rearm: () => void;
  updateCursors: (patch: Partial<CursorState>) => void;
  setShowMeasurements: (v: boolean) => void;
  setShowHistory: (v: boolean) => void;
  setExperiment: (ctx: ExperimentContext | null) => void;
  setCalloutPinned: (v: boolean) => void;
  setCalloutDismissed: (v: boolean) => void;
  setTauEstimate: (v: TauEstimate | null) => void;
  setCustomExpr: (expr: string | null) => void;
  /** Test isolation. */
  resetForTests: () => void;
}

/** The active experiment's render context (§6.7.4). */
export interface ExperimentContext {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly lookFor: string;
  /** Driving source amplitude (annotation hlines are fractions of it). */
  readonly sourceAmplitude: number;
  /** Declared τ (R·C) when the recipe is first-order. */
  readonly tau?: number;
  readonly annotations: readonly ExperimentAnnotationView[];
}

/** An annotation resolved to concrete axis-space values. */
export type ExperimentAnnotationView =
  | { readonly kind: "hline"; readonly y: number; readonly label: string }
  | { readonly kind: "vline"; readonly x: number | "tau"; readonly label: string }
  | {
      readonly kind: "band";
      readonly from: number | "3tau";
      readonly to: number | "5tau";
      readonly label: string;
    };

export interface TauEstimate {
  readonly tau: number;
  readonly r2: number;
  readonly firstOrder: boolean;
  readonly channel: string;
}

let nextMathId = 1;

export const useScopeStore = create<ScopeState>((set) => ({
  channels: [],
  activeChannelId: null,

  secPerDiv: 1e-3,
  position: 0.5,
  yAuto: true,
  voltsPerDiv: 1,
  roll: false,

  trigger: { source: null, level: 0, edge: "rise", mode: "auto", holdoffSec: 0, armed: true },
  cursors: CURSORS_OFF,
  showMeasurements: true,
  showHistory: false,

  experiment: null,
  calloutPinned: false,
  calloutDismissed: false,
  tauEstimate: null,
  customExpr: null,

  addChannel: (signal) =>
    set((s) => {
      if (s.channels.some((c) => c.id === signal) || s.channels.length >= MAX_CHANNELS) {
        return {};
      }
      const ch: ScopeChannel = {
        id: signal,
        label: signal,
        colorIndex: (s.channels.length % MAX_CHANNELS) + 1,
        visible: true,
        offset: 0,
        invert: false,
      };
      return { channels: [...s.channels, ch], activeChannelId: s.activeChannelId ?? signal };
    }),

  addMathChannel: (op, label) =>
    set((s) => {
      if (s.channels.length >= MAX_CHANNELS) {
        return {};
      }
      const id = `math:${nextMathId++}`;
      const ch: ScopeChannel = {
        id,
        label,
        colorIndex: (s.channels.length % MAX_CHANNELS) + 1,
        visible: true,
        offset: 0,
        invert: false,
        math: op,
      };
      return { channels: [...s.channels, ch], activeChannelId: id };
    }),

  removeChannel: (id) =>
    set((s) => {
      const channels = s.channels.filter((c) => c.id !== id);
      return {
        channels,
        activeChannelId: s.activeChannelId === id ? (channels[0]?.id ?? null) : s.activeChannelId,
      };
    }),

  updateChannel: (id, patch) =>
    set((s) => ({
      channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  setActiveChannel: (activeChannelId) => set({ activeChannelId }),

  selectSignals: (signals) =>
    set(() => ({
      channels: signals.slice(0, MAX_CHANNELS).map((name, k) => ({
        id: name,
        label: name,
        colorIndex: (k % MAX_CHANNELS) + 1,
        visible: true,
        offset: 0,
        invert: false,
      })),
      activeChannelId: signals[0] ?? null,
    })),

  setSecPerDiv: (secPerDiv) => set({ secPerDiv: clampDiv(secPerDiv) }),
  setPosition: (position) => set({ position: Math.min(1, Math.max(0, position)) }),
  setYAuto: (yAuto) => set({ yAuto }),
  setVoltsPerDiv: (voltsPerDiv) => set({ voltsPerDiv: Math.max(1e-12, voltsPerDiv) }),
  setRoll: (roll) => set({ roll }),

  updateTrigger: (patch) => set((s) => ({ trigger: { ...s.trigger, ...patch } })),
  rearm: () => set((s) => ({ trigger: { ...s.trigger, armed: true } })),

  updateCursors: (patch) => set((s) => ({ cursors: { ...s.cursors, ...patch } })),
  setShowMeasurements: (showMeasurements) => set({ showMeasurements }),
  setShowHistory: (showHistory) => set({ showHistory }),

  setExperiment: (experiment) =>
    set({ experiment, calloutDismissed: false, calloutPinned: false, tauEstimate: null }),
  setCalloutPinned: (calloutPinned) => set({ calloutPinned }),
  setCalloutDismissed: (calloutDismissed) => set({ calloutDismissed }),
  setTauEstimate: (tauEstimate) => set({ tauEstimate }),
  setCustomExpr: (customExpr) => set({ customExpr }),

  resetForTests: () =>
    set({
      channels: [],
      activeChannelId: null,
      secPerDiv: 1e-3,
      position: 0.5,
      yAuto: true,
      voltsPerDiv: 1,
      roll: false,
      trigger: { source: null, level: 0, edge: "rise", mode: "auto", holdoffSec: 0, armed: true },
      cursors: CURSORS_OFF,
      showMeasurements: true,
      showHistory: false,
      experiment: null,
      calloutPinned: false,
      calloutDismissed: false,
      tauEstimate: null,
      customExpr: null,
    }),
}));

/** 1-2-5 decade clamp for s/div (1 ns … 10 s). */
export function clampDiv(v: number): number {
  const steps = [
    1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4,
    2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5, 10,
  ];
  let best: number = steps[0] ?? 1e-3;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of steps) {
    const d = Math.abs(Math.log(v / s));
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Measurement readouts cache (pipeline writes at 4 Hz, legend reads). */
export const measurementCache = new Map<string, MeasurementRow>();
