/**
 * Plots panel (UX3-T6, UI-UX-SPEC §6.7.0 "purpose-built plot panels"): tab
 * strip over Bode / DC sweep / X–Y / spectrum views. The tab auto-follows
 * the run kind (ac → Bode, dc → sweep) unless the user picked one manually.
 */
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { resultStore } from "../../stores/result-store.ts";
import { Tabs } from "../../ui/Tabs.tsx";
import { BodeView } from "./BodeView.tsx";
import { SpectrumView } from "./SpectrumView.tsx";
import { SweepView } from "./SweepView.tsx";
import { XYView } from "./XYView.tsx";

type PlotTab = "bode" | "sweep" | "xy" | "spectrum";

const TAB_FOR_KIND: Record<string, PlotTab> = {
  ac: "bode",
  noise: "bode",
  dc: "sweep",
  tran: "spectrum",
};

export function PlotsPanel(): ReactNode {
  const version = useSyncExternalStore(
    (cb) => resultStore.subscribe(cb),
    () => resultStore.getSnapshot().version,
  );
  void version;
  const [tab, setTab] = useState<PlotTab>("bode");
  const [userPicked, setUserPicked] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  // Auto-follow new run kinds (per run, not per snapshot tick).
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an explicit re-trigger (StudioShell presetNonce pattern)
  useEffect(() => {
    const analysis = resultStore.currentAnalysis;
    const runId = resultStore.getSnapshot().runId;
    if (analysis === null || runId === null || runId === lastRunId) {
      return;
    }
    setLastRunId(runId);
    if (!userPicked) {
      setTab(TAB_FOR_KIND[analysis.kind] ?? "bode");
    }
  }, [version, lastRunId, userPicked]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-panel="plots">
      <Tabs
        ariaLabel="Plot panels"
        value={tab}
        onValueChange={(id) => {
          setUserPicked(true);
          setTab(id as PlotTab);
        }}
        className="h-full"
        items={[
          { id: "bode", label: "Bode", content: <BodeView /> },
          { id: "sweep", label: "DC sweep", content: <SweepView /> },
          { id: "xy", label: "X–Y", content: <XYView /> },
          { id: "spectrum", label: "Spectrum", content: <SpectrumView /> },
        ]}
      />
    </div>
  );
}
