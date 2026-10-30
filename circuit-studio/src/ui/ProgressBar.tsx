/** Studio DS ProgressBar: determinate 0..1 or indeterminate. */
import { cn } from "./cn.ts";

export function ProgressBar({
  value,
  label,
  className,
  indeterminate = false,
}: {
  /** 0..1; ignored when indeterminate. */
  readonly value?: number;
  readonly label?: string;
  readonly className?: string;
  readonly indeterminate?: boolean;
}) {
  const clamped = value === undefined ? 0 : Math.min(Math.max(value, 0), 1);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-elevated", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-accent transition-[width] duration-[var(--dur-1)] ease-[var(--ease-standard)]",
          indeterminate && "w-1/3 animate-[progress-slide_1.2s_ease-in-out_infinite]",
        )}
        style={indeterminate ? undefined : { width: `${clamped * 100}%` }}
      />
    </div>
  );
}
