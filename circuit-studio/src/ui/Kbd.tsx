/** Studio DS Kbd: keyboard shortcut glyph. */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Kbd({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded border border-line",
        "bg-panel px-1 py-0.5 text-2xs font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
