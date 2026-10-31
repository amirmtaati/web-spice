/**
 * Run bar (UI-UX-SPEC §3.1 region F, §6.1, 44 px): run controls, analysis
 * selector with per-kind options, live toggle + speed, readouts (sim time,
 * progress, method chip), engine chip. Wired to the sim controller (UX2-T3).
 * Sim-time/progress readouts update via rAF (useInstrumentFrame) — React
 * never re-renders per data chunk.
 */
import { Pause, Play, Square, StepForward, Zap } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { describeAnalysis } from "../sim/axis.ts";
import { getSimController } from "../sim/controller.ts";
import { useEngineStatus } from "../sim/useEngineStatus.ts";
import { useInstrumentFrame } from "../sim/useInstrumentFrame.ts";
import { resultStore } from "../stores/result-store.ts";
import {
  type AnalysisKind,
  supportsAnalysis,
  toAnalysisRequest,
  useSimStore,
} from "../stores/sim-store.ts";
import { Button } from "../ui/Button.tsx";
import { formatTime } from "../ui/format.ts";
import { NumberInput } from "../ui/NumberInput.tsx";
import { Select } from "../ui/Select.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

const KINDS: readonly AnalysisKind[] = ["op", "dc", "ac", "tran", "noise", "tf"];

const KIND_LABEL: Record<AnalysisKind, string> = {
  op: "OP",
  dc: "DC",
  ac: "AC",
  tran: "Tran",
  noise: "Noise",
  tf: "TF",
};

const SPEEDS = [0.01, 0.1, 1, 10] as const;

export function RunBar(): ReactNode {
  const session = useSimStore((s) => s.session);
  const kind = useSimStore((s) => s.analysisKind);
  const caps = useSimStore((s) => s.engineInfo?.capabilities);
  const live = useSimStore((s) => s.live);
  const method = useSimStore((s) => s.stats?.method);
  const fallback = useSimStore((s) => s.stats?.fallbackUsed);
  const { status, reconnect } = useEngineStatus();

  const running = session === "running" || session === "paused";
  const kindOk = supportsAnalysis(caps, kind);
  const controller = getSimController();

  return (
    <div
      data-testid="runbar"
      className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-panel px-3"
    >
      <Tooltip content={running ? "Stop · F5 / Shift+F5" : "Run analysis · F5"}>
        <Button
          variant="primary"
          size="sm"
          data-testid="run-btn"
          aria-label={running ? "Stop analysis" : "Run analysis"}
          onClick={() => void controller.run()}
        >
          {running ? (
            <Square size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Play size={14} strokeWidth={2} aria-hidden="true" />
          )}
          {running ? "Stop" : "Run"}
        </Button>
      </Tooltip>
      <Tooltip content="Pause / resume · F6">
        <Button
          size="sm"
          data-testid="pause-btn"
          aria-label={session === "paused" ? "Resume" : "Pause"}
          disabled={!running}
          onClick={() => controller.togglePause()}
        >
          <Pause size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Stop · Shift+F5">
        <Button
          size="sm"
          data-testid="stop-btn"
          aria-label="Stop"
          disabled={!running}
          onClick={() => controller.stop()}
        >
          <Square size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Step one output interval (live) · F7">
        <Button
          size="sm"
          data-testid="step-btn"
          aria-label="Step"
          disabled={session !== "running" && session !== "paused"}
          onClick={() => controller.step()}
        >
          <StepForward size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />

      <AnalysisPicker disabled={!kindOk} />

      <AnalysisOptions kind={kind} />

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />

      <Tooltip
        content={
          kind === "tran"
            ? "Live interactive mode (streams while you tune) · Mod+L"
            : "Live mode is transient-only"
        }
      >
        <Button
          size="sm"
          aria-pressed={live}
          data-testid="live-toggle"
          aria-label="Live mode"
          disabled={kind !== "tran"}
          onClick={() => useSimStore.getState().setLive(!live)}
        >
          <Zap size={13} strokeWidth={2} aria-hidden="true" />
          Live
        </Button>
      </Tooltip>
      {live ? (
        <Select
          label="Live speed"
          aria-label="Live speed"
          className="h-6 w-20 shrink-0 text-2xs"
          value={String(useSimStore.getState().speed)}
          options={SPEEDS.map((s) => ({ value: String(s), label: `×${s}` }))}
          onChange={(e) => getSimController().setSpeed(Number(e.target.value))}
        />
      ) : null}

      <Readouts running={running} live={live} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {method !== undefined ? (
          <span
            data-testid="method-chip"
            className="rounded-md border border-line bg-elevated px-2 py-0.5 font-mono text-2xs text-muted"
            title={
              fallback === true
                ? "OP fallback ladder used (gmin/source stepping)"
                : "Integrator method"
            }
          >
            {method}
            {fallback === true ? "·fb" : ""}
          </span>
        ) : null}
        <EngineChip status={status} onReconnect={reconnect} />
      </div>
    </div>
  );
}

/** Segmented OP·DC·AC·Tran·Noise·TF selector. */
function AnalysisPicker({ disabled }: { readonly disabled: boolean }): ReactNode {
  const kind = useSimStore((s) => s.analysisKind);
  return (
    <fieldset
      data-testid="analysis-kind"
      className="flex h-6 shrink-0 items-center overflow-hidden rounded-md border border-line"
    >
      <legend className="sr-only">Analysis type</legend>
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={kind === k}
          aria-label={`Analysis type: ${KIND_LABEL[k]}`}
          disabled={disabled}
          className={`px-2 text-2xs leading-5 transition-colors ${
            kind === k ? "bg-accent-soft font-medium text-fg" : "text-muted hover:bg-elevated"
          } disabled:opacity-40`}
          onClick={() => useSimStore.getState().setAnalysisKind(k)}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </fieldset>
  );
}

/** Per-analysis options (§6.1: "per-analysis options inline"). */
function AnalysisOptions({ kind }: { readonly kind: AnalysisKind }): ReactNode {
  const options = useSimStore((s) => s.options);
  const setOptions = useSimStore((s) => s.setOptions);
  switch (kind) {
    case "op":
      return <span className="shrink-0 text-2xs text-faint">operating point</span>;
    case "tran":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <NumberInput
            label="tstep"
            unit="s"
            value={options.tran.tstep}
            min={1e-15}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("tran", { tstep: v })}
          />
          <NumberInput
            label="tstop"
            unit="s"
            value={options.tran.tstop}
            min={1e-15}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("tran", { tstop: v })}
          />
        </div>
      );
    case "ac":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <Select
            label="AC sweep"
            aria-label="AC sweep"
            className="h-6 w-16 text-2xs"
            value={options.ac.sweep}
            options={[
              { value: "dec", label: "dec" },
              { value: "oct", label: "oct" },
              { value: "lin", label: "lin" },
            ]}
            onChange={(e) => setOptions("ac", { sweep: e.target.value as "dec" | "oct" | "lin" })}
          />
          <NumberInput
            label="pts"
            value={options.ac.points}
            min={1}
            step={5}
            className="w-16 text-2xs"
            onChange={(v) => setOptions("ac", { points: Math.round(v) })}
          />
          <NumberInput
            label="fstart"
            unit="Hz"
            value={options.ac.fstart}
            min={0}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("ac", { fstart: v })}
          />
          <NumberInput
            label="fstop"
            unit="Hz"
            value={options.ac.fstop}
            min={1e-15}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("ac", { fstop: v })}
          />
        </div>
      );
    case "dc":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <input
            aria-label="DC sweep source"
            className="h-6 w-16 rounded-md border border-line bg-elevated px-1.5 font-mono text-2xs"
            defaultValue={options.dc.source}
            onBlur={(e) => setOptions("dc", { source: e.target.value.trim() || "V1" })}
          />
          <NumberInput
            label="start"
            unit="V"
            value={options.dc.start}
            className="w-20 text-2xs"
            onChange={(v) => setOptions("dc", { start: v })}
          />
          <NumberInput
            label="stop"
            unit="V"
            value={options.dc.stop}
            className="w-20 text-2xs"
            onChange={(v) => setOptions("dc", { stop: v })}
          />
          <NumberInput
            label="step"
            unit="V"
            value={options.dc.step}
            min={1e-15}
            scrub="log"
            className="w-20 text-2xs"
            onChange={(v) => setOptions("dc", { step: v })}
          />
        </div>
      );
    case "noise":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <input
            aria-label="Noise output"
            className="h-6 w-20 rounded-md border border-line bg-elevated px-1.5 font-mono text-2xs"
            defaultValue={options.noise.output}
            onBlur={(e) => setOptions("noise", { output: e.target.value.trim() || "v(out)" })}
          />
          <input
            aria-label="Noise input source"
            className="h-6 w-16 rounded-md border border-line bg-elevated px-1.5 font-mono text-2xs"
            defaultValue={options.noise.source}
            onBlur={(e) => setOptions("noise", { source: e.target.value.trim() || "V1" })}
          />
          <NumberInput
            label="fstart"
            unit="Hz"
            value={options.noise.fstart}
            min={0}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("noise", { fstart: v })}
          />
          <NumberInput
            label="fstop"
            unit="Hz"
            value={options.noise.fstop}
            min={1e-15}
            scrub="log"
            className="w-24 text-2xs"
            onChange={(v) => setOptions("noise", { fstop: v })}
          />
        </div>
      );
    case "tf":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <input
            aria-label="TF output"
            className="h-6 w-20 rounded-md border border-line bg-elevated px-1.5 font-mono text-2xs"
            defaultValue={options.tf.output}
            onBlur={(e) => setOptions("tf", { output: e.target.value.trim() || "v(out)" })}
          />
          <input
            aria-label="TF input source"
            className="h-6 w-16 rounded-md border border-line bg-elevated px-1.5 font-mono text-2xs"
            defaultValue={options.tf.source}
            onBlur={(e) => setOptions("tf", { source: e.target.value.trim() || "V1" })}
          />
        </div>
      );
  }
}

/**
 * Readouts: simulated time + progress. rAF-driven DOM updates (no React
 * re-render per chunk/progress message — §7 rule 2).
 */
function Readouts({
  running,
  live,
}: {
  readonly running: boolean;
  readonly live: boolean;
}): ReactNode {
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  useInstrumentFrame(() => {
    const sim = useSimStore.getState();
    let t: number | null = null;
    if (sim.session === "paused") {
      // Frozen at the pause transition — late in-flight chunks must not move
      // the readout (scope-like Stop, UX2-T3).
      t = sim.pausedSimTime;
    } else if (sim.session === "running" && sim.progress !== null) {
      t = sim.progress.simTime;
    } else {
      t = resultStore.axisEnd; // last received axis value (NaN pre-data)
    }
    if (timeRef.current !== null) {
      timeRef.current.textContent = t !== null && Number.isFinite(t) ? formatTime(t) : "—";
    }
    if (barRef.current !== null) {
      // Live progress: fraction is 0 (§5.3) — show sim-time growth instead.
      const frac = live ? Math.min(1, (t ?? 0) / Math.max(1e-12, sim.options.tran.tstop)) : 0;
      barRef.current.style.width = `${(live ? frac : running ? 1 : 0) * 100}%`;
      barRef.current.style.opacity = running ? "1" : "0";
    }
  });
  return (
    <div className="flex shrink-0 items-center gap-2" aria-live="off">
      <span
        data-testid="sim-time"
        className="font-mono text-xs tabular-nums text-faint"
        title={live ? "simulated time (live)" : "simulated time"}
      >
        t = <span ref={timeRef}>—</span>
      </span>
      <span aria-hidden="true" className="h-1 w-16 overflow-hidden rounded-full bg-elevated">
        <span ref={barRef} className="block h-full w-0 rounded-full bg-accent transition-opacity" />
      </span>
      <AnalysisSummary />
    </div>
  );
}

/** Current analysis summary (compact, updates only on settings change). */
function AnalysisSummary(): ReactNode {
  const kind = useSimStore((s) => s.analysisKind);
  const options = useSimStore((s) => s.options);
  return (
    <span
      className="hidden text-2xs text-faint xl:inline"
      title="current analysis"
      data-testid="analysis-summary"
    >
      {describeAnalysis(toAnalysisRequest(kind, options))}
    </span>
  );
}

function EngineChip({
  status,
  onReconnect,
}: {
  readonly status: ReturnType<typeof useEngineStatus>["status"];
  readonly onReconnect: () => void;
}): ReactNode {
  const dot =
    status.state === "connecting"
      ? "bg-warning animate-pulse"
      : status.state === "ready"
        ? "bg-ok"
        : status.state === "recovering"
          ? "bg-warning animate-pulse"
          : "bg-error";
  return (
    <span
      data-testid="engine-chip"
      className="flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-2xs text-muted"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {status.state === "ready" ? (
        <>
          <span className="font-mono">engine {status.engineVersion}</span>
          <span aria-hidden="true">·</span>
          <span>{status.transportLabel}</span>
        </>
      ) : status.state === "connecting" ? (
        <span>engine connecting…</span>
      ) : status.state === "recovering" ? (
        <span>engine restarting…</span>
      ) : (
        <>
          <span className="text-error">engine error</span>
          <button type="button" className="text-accent hover:underline" onClick={onReconnect}>
            Reconnect
          </button>
        </>
      )}
    </span>
  );
}
