/** Studio DS ErrorState: thrown-instrument fallback (§4.3, UX0-T7). */
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { cn } from "./cn.ts";

export function ErrorState({
  title = "Something went wrong",
  detail,
  onRetry,
  className,
  icon,
}: {
  readonly title?: string;
  readonly detail?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
  readonly icon?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
        className,
      )}
    >
      {icon !== undefined && <div className="text-error">{icon}</div>}
      <p className="text-sm text-error">{title}</p>
      {detail !== undefined && (
        <p className="max-w-96 truncate font-mono text-2xs text-faint" title={detail}>
          {detail}
        </p>
      )}
      {onRetry !== undefined && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
