/** Studio DS Tabs: Radix Tabs wrapped with Studio tokens (§4.3). */
import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export function Tabs({
  items,
  value,
  onValueChange,
  className,
  ariaLabel,
}: {
  readonly items: readonly TabItem[];
  /** Controlled value; omit for uncontrolled. */
  readonly value?: string;
  readonly onValueChange?: (id: string) => void;
  readonly className?: string;
  readonly ariaLabel: string;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onValueChange}
      className={cn("flex min-h-0 flex-col", className)}
      aria-label={ariaLabel}
    >
      <RadixTabs.List className="flex shrink-0 items-center gap-1 border-b border-line px-1">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.id}
            value={item.id}
            className={cn(
              "h-8 border-b-2 border-transparent px-2.5 text-xs text-muted",
              "transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)]",
              "hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.id} value={item.id} className="min-h-0 flex-1 outline-none">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
