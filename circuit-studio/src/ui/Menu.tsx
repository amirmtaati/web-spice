/** Studio DS Menu: Radix dropdown-menu parts styled with Studio tokens. */
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

const CONTENT_CLASS = cn(
  "z-50 min-w-44 rounded-lg border border-line bg-elevated p-1 shadow-[var(--shadow-popover)]",
  "data-[state=open]:animate-[fade-in_var(--dur-1)_ease-out]",
);

const ITEM_CLASS = cn(
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg outline-none",
  "data-[highlighted]:bg-accent-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

export function Menu({
  trigger,
  children,
  align = "start",
}: {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end";
}) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content align={align} sideOffset={6} className={CONTENT_CLASS}>
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  shortcut,
  disabled,
}: {
  readonly children: ReactNode;
  readonly onSelect?: () => void;
  readonly shortcut?: string;
  readonly disabled?: boolean;
}) {
  return (
    <RadixMenu.Item className={ITEM_CLASS} onSelect={onSelect} disabled={disabled}>
      <span className="flex-1">{children}</span>
      {shortcut !== undefined && <span className="text-2xs text-faint">{shortcut}</span>}
    </RadixMenu.Item>
  );
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { readonly children: ReactNode }) {
  return <RadixMenu.Label className="px-2 py-1 text-2xs text-faint">{children}</RadixMenu.Label>;
}
