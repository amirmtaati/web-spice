/** Studio DS Popover: Radix popover with Studio tokens. */
import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
  open,
  onOpenChange,
}: {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly className?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 rounded-lg border border-line bg-elevated p-2 shadow-[var(--shadow-popover)]",
            "data-[state=open]:animate-[fade-in_var(--dur-1)_ease-out]",
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
