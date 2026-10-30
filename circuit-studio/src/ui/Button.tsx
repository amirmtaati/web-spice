/** Studio DS Button (UI-UX-SPEC §4.3): primary/ghost/danger variants. */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:opacity-90",
  ghost: "bg-transparent text-fg hover:bg-elevated border border-line",
  danger: "bg-transparent text-error border border-error hover:bg-error-soft",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-xs gap-1",
  md: "h-[var(--ctl-h)] px-3 text-sm gap-1.5",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium select-none",
        "transition-[background,opacity] duration-[var(--dur-1)] ease-[var(--ease-standard)]",
        "active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
