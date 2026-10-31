/**
 * Plot export (UX3-T8, UI-UX-SPEC §6.7.1): CSV of the run's retained data
 * and PNG of the plot canvas. `csvString` is pure and unit-tested ("export
 * bytes validated"); PNG export composites the uPlot canvas over the theme
 * background (canvas-to-blob, browser only).
 */

export interface CsvSignal {
  readonly name: string;
  readonly unit: string;
  readonly values: ArrayLike<number>;
}

/**
 * CSV text for a run: axis column + one column per signal. Header rows are
 * `#` comments (round-trippable by numpy/pandas), values full precision
 * (17 significant digits so re-parsing is bit-exact for float64).
 */
export function csvString(
  axis: ArrayLike<number>,
  signals: readonly CsvSignal[],
  axisUnit: string,
): string {
  const header = [
    `# axis (${axisUnit})`,
    ...signals.map((s) => `${s.name}${s.unit.length > 0 ? ` (${s.unit})` : ""}`),
  ].join(",");
  const lines: string[] = [header];
  const n = axis.length;
  for (let k = 0; k < n; k++) {
    const cells = [axis[k]];
    for (const s of signals) {
      cells.push(s.values[k] ?? Number.NaN);
    }
    lines.push(cells.map((v) => (Number.isNaN(v) ? "" : String(v))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** Trigger a browser download of `text` as `filename` (UTF-8 CSV). */
export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Composite the plot canvas over `bg` and download as PNG. */
export function downloadPng(source: HTMLCanvasElement, bg: string, filename: string): void {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (ctx === null) {
    return;
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  out.toBlob((blob) => {
    if (blob === null) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFilename(filename);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

/** Filesystem-safe filename (keep it readable, drop separators). */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "export";
}
