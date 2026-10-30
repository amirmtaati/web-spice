/** Studio DS Chip: status indicator with state dot (engine chip, ERC counts). */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type ChipState = "neutral" | "connecting" | "ok" | "warning" | "error";

const DOT_CLASS: Record<ChipState, string> = {
  neutral: "bg-faint",
  connecting: "bg-info animate-pulse",
  ok: "bg-ok",
  warning: "bg-warning",
  error: "bg-error",
};

export function Chip({
  state = "neutral",
  children,
  className,
  title,
}: {
  readonly state?: ChipState;
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-0.5",
        "text-xs text-muted",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", DOT_CLASS[state])} />
      {children}
    </span>
  );
}
