/** Studio DS Panel: dock/panel chrome — title, actions, scrollable body. */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export interface PanelProps {
  readonly title: ReactNode;
  /** Right-aligned action buttons/menus. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col bg-panel", className)}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <h2 className="truncate text-xs font-medium text-muted">{title}</h2>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}
