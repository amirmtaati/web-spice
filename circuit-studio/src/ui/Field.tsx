/** Studio DS Field: label + control + unit + validation message (§4.3). */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export interface FieldProps {
  readonly label: string;
  readonly htmlFor?: string;
  /** Unit rendered after the control, muted (e.g. "V", "Ω"). */
  readonly unit?: string;
  readonly error?: string | null;
  readonly hint?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Field({ label, htmlFor, unit, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
        {unit !== undefined && <span className="ml-1 text-faint">({unit})</span>}
      </label>
      <div className="flex items-center gap-1.5">{children}</div>
      {error !== undefined && error !== null && error !== "" ? (
        <p role="alert" className="text-2xs text-error">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="text-2xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
