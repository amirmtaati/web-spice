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
import type { ReactNode } from "react";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";

interface PanelSpec {
  readonly title: string;
  readonly icon: LucideIcon;
  /** Where the body lands (shown by the placeholder). */
  readonly landsIn: string;
  /** The concrete body; undefined → themed placeholder (UX0). */
  readonly body?: () => ReactNode;
}

const SPECS: Record<string, PanelSpec> = {
  canvas: { title: "Schematic", icon: CircuitBoard, landsIn: "UX1" },
  library: { title: "Library", icon: Grid3x3, landsIn: "UX1" },
  inspector: { title: "Inspector", icon: SlidersHorizontal, landsIn: "UX2" },
  scope: { title: "Scope", icon: ChartLine, landsIn: "UX3" },
  plots: { title: "Plots", icon: ChartLine, landsIn: "UX3" },
  generator: { title: "Generator", icon: Zap, landsIn: "UX5" },
  meters: { title: "Meters", icon: Gauge, landsIn: "UX4" },
  console: { title: "Console", icon: ScrollText, landsIn: "UX2" },
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
