/** Studio DS Tooltip: Radix tooltip with Studio tokens and Kbd support. */
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  readonly children: ReactNode;
  /** Override for tests/storybook (default 300 ms per §4.3). */
  readonly delayDuration?: number;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={100}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "bottom",
  shortcut,
}: {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly side?: "top" | "right" | "bottom" | "left";
  /** Optional shortcut rendered as a Kbd chip after the text. */
  readonly shortcut?: string;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md border border-line bg-elevated px-2 py-1",
            "text-xs text-fg shadow-[var(--shadow-popover)]",
            "data-[state=delayed-open]:animate-[fade-in_var(--dur-1)_ease-out]",
          )}
        >
          {content}
          {shortcut !== undefined && (
            <span className="rounded border border-line bg-panel px-1 text-2xs text-muted">
              {shortcut}
            </span>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
