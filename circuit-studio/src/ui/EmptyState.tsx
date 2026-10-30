/** Studio DS EmptyState: icon + one-liner + primary action (§4.3). */
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { cn } from "./cn.ts";

export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
  className,
}: {
  /** Simple line-art glyph (Lucide icon component). */
  readonly icon?: ReactNode | undefined;
  readonly title: string;
  readonly hint?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
        className,
      )}
    >
      {icon !== undefined && <div className="text-faint">{icon}</div>}
      <p className="text-sm text-muted">{title}</p>
      {hint !== undefined && <p className="max-w-72 text-xs text-faint">{hint}</p>}
      {actionLabel !== undefined && onAction !== undefined && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
