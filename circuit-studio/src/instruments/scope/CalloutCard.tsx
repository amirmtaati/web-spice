/**
 * Experiment callout card (UX3-T7, UI-UX-SPEC §6.7.4): title, one-line
 * physics explanation, and "what to look for" — teaching without leaving
 * the tool. Dismissable; pinnable (stays across runs).
 */
import { Pin, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { useScopeStore } from "./scope-store.ts";

export function CalloutCard(): ReactNode {
  const experiment = useScopeStore((s) => s.experiment);
  const dismissed = useScopeStore((s) => s.calloutDismissed);
  const pinned = useScopeStore((s) => s.calloutPinned);
  const setDismissed = useScopeStore((s) => s.setCalloutDismissed);
  const setPinned = useScopeStore((s) => s.setCalloutPinned);

  if (experiment === null || dismissed) {
    return null;
  }
  return (
    // Pointer events stay off the positioning wrapper so the canvas below
    // (cursors, zoom box) stays interactive around the card.
    <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex max-h-[calc(100%-0.5rem)] justify-end overflow-hidden">
      <div
        className="pointer-events-auto max-w-72 overflow-y-auto rounded-md border border-line bg-elevated/95 p-3 shadow-lg backdrop-blur-sm"
        data-testid="callout-card"
        role="note"
        aria-label={`Experiment: ${experiment.title}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium text-accent">{experiment.title}</div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={pinned ? "Unpin callout" : "Pin callout"}
              onClick={() => setPinned(!pinned)}
              active={pinned}
              className="h-6 w-6"
            >
              <Pin size={13} />
            </IconButton>
            <IconButton
              label="Dismiss callout"
              onClick={() => setDismissed(true)}
              className="h-6 w-6"
            >
              <X size={13} />
            </IconButton>
          </div>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg">{experiment.explanation}</p>
        <p className="mt-1.5 text-2xs leading-relaxed text-muted">
          <span className="font-medium text-warning">Look for: </span>
          {experiment.lookFor}
        </p>
      </div>
    </div>
  );
}
