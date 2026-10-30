/**
 * Run bar (UI-UX-SPEC §3.1 region F, §6.1, 44 px): run controls, analysis
 * selector, engine chip. Always visible in every preset. Simulation wiring
 * lands with UX2 (controls disabled until then); the engine chip is live
 * from UX0-T6.
 */
import { Pause, Play, Square, StepForward } from "lucide-react";
import type { ReactNode } from "react";
import { useEngineStatus } from "../sim/useEngineStatus.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../ui/Select.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

const ANALYSES = ["OP", "DC", "AC", "Tran", "Noise", "TF"] as const;
export type AnalysisKind = (typeof ANALYSES)[number];

export function RunBar(): ReactNode {
  const { status, reconnect } = useEngineStatus();
  const simWired = false; // UX2 flips this (run store + stream plumbing).

  return (
    <div
      data-testid="runbar"
      className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-panel px-3"
    >
      <Tooltip content="Run analysis · F5">
        <Button variant="primary" size="sm" disabled={!simWired} aria-label="Run analysis">
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          Run
        </Button>
      </Tooltip>
      <Tooltip content="Pause / resume · F6">
        <Button size="sm" disabled={!simWired} aria-label="Pause or resume">
          <Pause size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Stop · Shift+F5">
        <Button size="sm" disabled={!simWired} aria-label="Stop">
          <Square size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Step (live) · F7">
        <Button size="sm" disabled={!simWired} aria-label="Step">
          <StepForward size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <Select
        label="Analysis type"
        value="Tran"
        disabled={!simWired}
        options={ANALYSES.map((a) => ({ value: a, label: a }))}
        onChange={() => {}}
        className="h-6 w-28 text-xs"
      />

      <span className="ml-1 font-mono text-xs tabular-nums text-faint" aria-live="off">
        t = —
      </span>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-2xs text-faint">ERC 0</span>
        <EngineChip status={status} onReconnect={reconnect} />
      </div>
    </div>
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
