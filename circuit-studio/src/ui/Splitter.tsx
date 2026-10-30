/**
 * Studio DS Splitter: keyboard-operable resize handle between two regions
 * (role="separator", arrows resize, Home doubles / End halves).
 */
import type { KeyboardEvent, PointerEvent } from "react";
import { cn } from "./cn.ts";

export interface SplitterProps {
  readonly label: string;
  readonly orientation: "horizontal" | "vertical";
  /** Fraction (0..1) of the primary region. */
  readonly fraction: number;
  readonly onFractionChange: (fraction: number) => void;
  /** Guard: clamp to [minFraction, 1 - minFraction]. */
  readonly minFraction?: number;
  readonly className?: string;
}

export function Splitter({
  label,
  orientation,
  fraction,
  onFractionChange,
  minFraction = 0.1,
  className,
}: SplitterProps) {
  const clamp = (f: number): number => Math.min(Math.max(f, minFraction), 1 - minFraction);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const f =
      orientation === "horizontal"
        ? (event.clientX - rect.left) / rect.width
        : (event.clientY - rect.top) / rect.height;
    onFractionChange(clamp(f));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.shiftKey ? 0.05 : 0.01;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        onFractionChange(clamp(fraction - delta));
        return;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        onFractionChange(clamp(fraction + delta));
        return;
      case "Home":
        event.preventDefault();
        onFractionChange(clamp(0.5));
        return;
      default:
        return;
    }
  };

  return (
    // Interactive ARIA separator widget (focusable + valuenow); <hr> cannot host these.
    // biome-ignore lint/a11y/useSemanticElements: focusable separator widget per WAI-ARIA
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={Math.round(minFraction * 100)}
      aria-valuemax={Math.round((1 - minFraction) * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative shrink-0 bg-line transition-[background] duration-[var(--dur-1)]",
        orientation === "horizontal" ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        "hover:bg-accent focus-visible:bg-accent",
        className,
      )}
    />
  );
}
