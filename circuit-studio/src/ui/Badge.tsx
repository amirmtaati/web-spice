/** Studio DS Badge: status/label pill (tone carries icon+text, never color alone). */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type BadgeTone = "neutral" | "ok" | "warning" | "error" | "info" | "accent";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-elevated text-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  error: "bg-error-soft text-error border-transparent",
  info: "bg-info-soft text-info border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
