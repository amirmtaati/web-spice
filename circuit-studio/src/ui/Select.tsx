/** Studio DS Select: styled native select (a11y for free, tokens for looks). */
import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  readonly options: readonly SelectOption[];
  readonly label: string;
  readonly className?: string;
}

export function Select({ options, label, className, ...rest }: SelectProps) {
  return (
    <select
      aria-label={label}
      className={cn(
        "h-[var(--ctl-h)] appearance-none rounded-md border border-line bg-panel px-2 pr-6",
        "text-sm text-fg hover:border-line-strong disabled:opacity-40",
        "bg-[length:16px] bg-[right_4px_center] bg-no-repeat",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%238b949e' stroke-width='1.5' d='m4.5 6.5 3.5 3.5 3.5-3.5'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
