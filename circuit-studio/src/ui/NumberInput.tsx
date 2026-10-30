/**
 * Studio DS NumberInput (UI-UX-SPEC §6.4): engineering-notation entry with
 * scrubbing. Type `4.7k`; ↑/↓ steps; Alt+drag scrubs (log mode for positive
 * R/C/L values); wheel steps (Shift = finer); invalid input shakes and is
 * rejected on commit. Every commit routes through onChange with a parsed
 * number — the invalid state never reaches app state.
 */
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "./cn.ts";
import { formatEng, parseEngineering } from "./format.ts";

export interface NumberInputProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly label: string;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  /** Arrow-key step (default: decade-relative 10%); Shift ×0.1. */
  readonly step?: number;
  /** Log scrubbing for R/C/L-style positive magnitudes. */
  readonly scrub?: "linear" | "log";
  readonly disabled?: boolean;
  readonly className?: string;
}

export function NumberInput({
  value,
  onChange,
  label,
  unit,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step,
  scrub = "linear",
  disabled = false,
  className,
}: NumberInputProps) {
  const inputId = useId();
  const [text, setText] = useState<string | null>(null); // null = show formatted value
  const [invalid, setInvalid] = useState(false);
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (text === null) {
      return;
    }
    const parsed = parseEngineering(text);
    setInvalid(parsed === null || parsed < min || parsed > max);
  }, [text, min, max]);

  const commit = (candidate: string): boolean => {
    const parsed = parseEngineering(candidate);
    if (parsed === null || parsed < min || parsed > max) {
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 400); // shake duration
      return false;
    }
    setInvalid(false);
    setText(null);
    if (parsed !== value) {
      onChange(parsed);
    }
    return true;
  };

  const nudge = (direction: 1 | -1, fine: boolean): void => {
    const base = Math.abs(value) > 0 ? Math.abs(value) : 1;
    const factor = step ?? base * 0.1;
    const next = clamp(value + direction * factor * (fine ? 0.1 : 1), min, max);
    onChange(next);
  };

  const scrubTo = (clientX: number): void => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    const dx = clientX - drag.startX;
    if (scrub === "log" && drag.startValue > 0) {
      const decades = dx / 100; // 100 px per decade
      const next = clamp(drag.startValue * 10 ** decades, min, max);
      onChange(next);
      return;
    }
    const perPx = step ?? Math.max(Math.abs(drag.startValue) * 0.01, 1e-12);
    onChange(clamp(drag.startValue + dx * perPx, min, max));
  };

  const onPointerDown = (event: PointerEvent<HTMLInputElement>): void => {
    if (!event.altKey || disabled) {
      return;
    }
    dragRef.current = { startX: event.clientX, startValue: value };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLInputElement>): void => {
    if (dragRef.current !== null) {
      scrubTo(event.clientX);
    }
  };

  const onPointerUp = (): void => {
    dragRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      if (text !== null) {
        commit(text);
      }
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      setText(null);
      setInvalid(false);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (text !== null) {
        commit(text);
        return;
      }
      nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLInputElement>): void => {
    if (disabled || text !== null) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    nudge(direction, event.shiftKey);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData("text");
    if (parseEngineering(pasted) === null && pasted.trim() !== "") {
      event.preventDefault();
      setInvalid(true);
    }
  };

  const display = text ?? formatEng(value);
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <input
        id={inputId}
        ref={inputRef}
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={display}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onPaste={onPaste}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onBlur={() => {
          if (text !== null) {
            commit(text);
          }
        }}
        className={cn(
          "num h-[var(--ctl-h)] w-full min-w-24 rounded-md border bg-panel px-2 text-sm",
          "border-line text-fg focus:border-accent disabled:opacity-40",
          invalid && "animate-[value-shake_0.3s_ease-in-out] border-error",
        )}
      />
      {unit !== undefined && (
        <span aria-hidden="true" className="pointer-events-none ml-1 text-2xs text-faint">
          {unit}
        </span>
      )}
    </span>
  );
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
