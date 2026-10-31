/**
 * Dockview panel registry (UI-UX-SPEC §3.1 regions C/D/E). Every dockable
 * panel is registered here by id; each is wrapped in its own error boundary
 * so a thrown instrument is an ErrorState, never a white screen (§1.2
 * principle 8, UX0-T7). Feature bodies land with UX1–UX6 — for UX0 the
 * surfaces exist, are themed, and declare which milestone fills them.
 */
import type { IDockviewPanelProps } from "dockview-react";
import {
  ChartLine,
  CircuitBoard,
  Gauge,
  Grid3x3,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
  Table2,
  Zap,
} from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";
import { CanvasView } from "../canvas/CanvasView.tsx";
import { ConsolePanel } from "../console/ConsolePanel.tsx";
import { InspectorPanel } from "../inspector/InspectorPanel.tsx";
import { LibraryPanel } from "../library/LibraryPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";

// Instruments are lazy chunks (SPEC §15.1 budgets): uPlot + the DSP/plot
// stack load on first panel open, not at app boot.
const ScopePanel = lazy(() =>
  import("../instruments/scope/ScopePanel.tsx").then((m) => ({ default: m.ScopePanel })),
);
const PlotsPanel = lazy(() =>
  import("../instruments/plots/PlotsPanel.tsx").then((m) => ({ default: m.PlotsPanel })),
);

function PanelSuspense({ children }: { readonly children: ReactNode }): ReactNode {
  return <Suspense fallback={<PanelLoading />}>{children}</Suspense>;
}

function PanelLoading(): ReactNode {
  return (
    <div className="flex h-full items-center justify-center" aria-busy="true">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

interface PanelSpec {
  readonly title: string;
  readonly icon: LucideIcon;
  /** Where the body lands (shown by the placeholder). */
  readonly landsIn: string;
  /** The concrete body; undefined → themed placeholder (UX0). */
  readonly body?: () => ReactNode;
}

const SPECS: Record<string, PanelSpec> = {
  canvas: { title: "Schematic", icon: CircuitBoard, landsIn: "UX1", body: () => <CanvasView /> },
  library: { title: "Library", icon: Grid3x3, landsIn: "UX1", body: () => <LibraryPanel /> },
  inspector: {
    title: "Inspector",
    icon: SlidersHorizontal,
    landsIn: "UX1+",
    body: () => <InspectorPanel />,
  },
  scope: {
    title: "Scope",
    icon: ChartLine,
    landsIn: "UX3",
    body: () => (
      <PanelSuspense>
        <ScopePanel />
      </PanelSuspense>
    ),
  },
  plots: {
    title: "Plots",
    icon: ChartLine,
    landsIn: "UX3",
    body: () => (
      <PanelSuspense>
        <PlotsPanel />
      </PanelSuspense>
    ),
  },
  generator: { title: "Generator", icon: Zap, landsIn: "UX5" },
  meters: { title: "Meters", icon: Gauge, landsIn: "UX4" },
  console: {
    title: "Console",
    icon: ScrollText,
    landsIn: "UX2",
    body: () => <ConsolePanel />,
  },
  "data-table": { title: "Data table", icon: Table2, landsIn: "UX6" },
  "op-table": { title: "OP table", icon: Table2, landsIn: "UX4" },
};

function Placeholder({ spec, panelId }: { spec: PanelSpec; panelId: string }): ReactNode {
  const Icon = spec.icon;
  return (
    <EmptyState
      icon={<Icon size={22} strokeWidth={1.5} />}
      title={`${spec.title} panel`}
      hint={`Body lands with ${spec.landsIn} — shell, theming, and docking are live (UX0).`}
      actionLabel={panelId === "canvas" ? "Open command palette" : undefined}
      onAction={
        panelId === "canvas"
          ? () => document.dispatchEvent(new CustomEvent("studio:open-palette"))
          : undefined
      }
    />
  );
}

/** Per-panel boundary: region name, toast hook, and diagnostics copy. */
export function PanelBoundary({
  panelId,
  children,
}: {
  readonly panelId: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ErrorBoundary
      region={panelId}
      diagnostics={() =>
        JSON.stringify(
          { panel: panelId, time: new Date().toISOString(), boundary: "panel" },
          null,
          2,
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Component map handed to `DockviewReact#components`. */
export const PANEL_COMPONENTS: Record<string, (props: IDockviewPanelProps) => ReactNode> =
  Object.fromEntries(
    Object.entries(SPECS).map(([id, spec]) => [
      id,
      (props: IDockviewPanelProps) => (
        <PanelBoundary panelId={id}>
          {spec.body !== undefined ? (
            spec.body()
          ) : (
            <Placeholder spec={spec} panelId={props.api.id} />
          )}
        </PanelBoundary>
      ),
    ]),
  );
