/**
 * Tool rail (UI-UX-SPEC §3.1 region B, 44 px): icon buttons with tooltip +
 * shortcut label. Active tool is accent-highlighted. Bodies land with UX1;
 * the rail exists and is fully themed from UX0.
 */
import {
  Crosshair,
  type LucideIcon,
  MousePointer2,
  Route,
  Tag,
  TextCursorInput,
} from "lucide-react";
import type { ReactNode } from "react";
import { type ToolId, useUiStore } from "../stores/ui-store.ts";
import { Tooltip } from "../ui/Tooltip.tsx";

const TOOLS: readonly { id: ToolId; label: string; icon: LucideIcon }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "wire", label: "Wire", icon: Route },
  { id: "place", label: "Place", icon: TextCursorInput },
  { id: "text", label: "Text", icon: Tag },
  { id: "probe", label: "Probe", icon: Crosshair },
];

export function ToolRail(): ReactNode {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);

  return (
    <nav
      data-testid="tool-rail"
      aria-label="Tools"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
    >
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id} content={label} side="right">
          <button
            type="button"
            aria-label={`${label} tool`}
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-[background] duration-[var(--dur-1)] ${
              tool === id
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-elevated hover:text-fg"
            }`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
