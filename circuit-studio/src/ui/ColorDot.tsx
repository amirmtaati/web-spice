/** Studio DS ColorDot: signal-palette swatch (scope legend, probe flags). */
export function ColorDot({
  index,
  className,
  label,
}: {
  /** Signal palette index 1–8 (§4.1); maps to `--sig-N`. */
  readonly index: number;
  readonly className?: string;
  readonly label?: string;
}) {
  const clamped = Math.min(Math.max(index, 1), 8);
  const style = { background: `var(--sig-${clamped})` };
  if (label !== undefined) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className ?? ""}`}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className ?? ""}`}
      style={style}
    />
  );
}
