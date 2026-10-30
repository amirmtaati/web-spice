/** Studio DS IconButton: icon-only button; requires an accessible label. */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon-only buttons must be labelled (§9.1). */
  readonly label: string;
  readonly children: ReactNode;
  readonly active?: boolean;
}

export function IconButton({
  label,
  children,
  active = false,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex h-[var(--ctl-h)] w-[var(--ctl-h)] items-center justify-center rounded-md",
        "text-fg transition-[background] duration-[var(--dur-1)] ease-[var(--ease-standard)]",
        "hover:bg-elevated active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-accent-soft text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
