/** Studio DS Skeleton: loading placeholder shimmer. */
import { cn } from "./cn.ts";

export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-elevated", className)} />
  );
}
