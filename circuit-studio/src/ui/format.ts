/**
 * Studio number formatting (UI-UX-SPEC §4.1): engineering notation with SI
 * prefixes, unit-aware readouts, time formatting, and the matching input
 * parser. All numeric display in the app goes through this module —
 * monospaced tabular digits everywhere, precision that adapts to magnitude.
 *
 * Rounding: 3 significant digits; trailing zeros are trimmed by default
 * (`4.7 kΩ`, `12 V`, `3.2 mA`); pass `{trimZeros: false}` for fixed-width
 * readouts (`12.0 V`). The input parser accepts SI prefixes (`4.7k`, `1.2 M`)
 * and the SPICE-friendly `meg` (`1meg` = 1e6).
 */

export interface FormatOptions {
  /** Keep trailing zeros for stable-width readouts (default: trim). */
  readonly trimZeros?: boolean;
}

const SI_PREFIXES: readonly { symbol: string; power: number }[] = [
  { symbol: "q", power: -30 },
  { symbol: "r", power: -27 },
  { symbol: "y", power: -24 },
  { symbol: "z", power: -21 },
  { symbol: "a", power: -18 },
  { symbol: "f", power: -15 },
  { symbol: "p", power: -12 },
  { symbol: "n", power: -9 },
  { symbol: "µ", power: -6 },
  { symbol: "m", power: -3 },
  { symbol: "", power: 0 },
  { symbol: "k", power: 3 },
  { symbol: "M", power: 6 },
  { symbol: "G", power: 9 },
  { symbol: "T", power: 12 },
  { symbol: "P", power: 15 },
  { symbol: "E", power: 18 },
  { symbol: "Z", power: 21 },
  { symbol: "Y", power: 24 },
  { symbol: "R", power: 27 },
  { symbol: "Q", power: 30 },
];

const MIN_POWER = -30;
const MAX_POWER = 30;
const MINUS = "\u2212"; // typographic minus in output
const THIN = "\u2009"; // thin space between value and unit/prefix
const DASH = "\u2014"; // em-dash for non-finite readouts

function formatMantissa(mantissa: number, trimZeros: boolean): string {
  const abs = Math.abs(mantissa);
  if (abs !== 0 && abs < 1) {
    let text = mantissa.toPrecision(3);
    if (trimZeros && text.includes(".")) {
      text = text.replace(/\.?0+$/, "");
    }
    return text;
  }
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  let text = mantissa.toFixed(digits);
  if (trimZeros && text.includes(".")) {
    text = text.replace(/\.?0+$/, "");
  }
  return text;
}

/**
 * Engineering notation with SI prefix: `formatEng(4.7e3, "Ω")` → `"4.7 kΩ"`.
 * Non-finite values render as an em-dash (never "NaN" in a readout).
 */
export function formatEng(value: number, unit = "", options: FormatOptions = {}): string {
  const trimZeros = options.trimZeros ?? true;
  if (!Number.isFinite(value)) {
    return unit === "" ? DASH : `${DASH}${THIN}${unit}`;
  }
  if (value === 0) {
    return unit === "" ? "0" : `0${THIN}${unit}`;
  }
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  const exp3 = Math.floor(Math.log10(abs) / 3) * 3;
  let power = Math.min(Math.max(exp3, MIN_POWER), MAX_POWER);
  // Rounding at the prefix boundary rolls over: 999.5k → "1 M", not "1000 k".
  if (abs / 10 ** power >= 999.5 && power < MAX_POWER) {
    power += 3;
  }
  const prefix = SI_PREFIXES[(power - MIN_POWER) / 3] ?? { symbol: "", power: 0 };
  const body = `${sign}${formatMantissa(abs / 10 ** power, trimZeros)}`;
  const suffix = prefix.symbol === "" ? unit : `${prefix.symbol}${unit}`;
  return suffix === "" ? body : `${body}${THIN}${suffix}`;
}

/** SI-prefixed number without a unit: `formatSI(1.2e6)` → `"1.2 M"`. */
export function formatSI(value: number, options: FormatOptions = {}): string {
  return formatEng(value, "", options);
}

/** Value with a plain unit, no prefix scaling: `formatUnit(63.2, "%")`. */
export function formatUnit(value: number, unit: string, options: FormatOptions = {}): string {
  const trimZeros = options.trimZeros ?? true;
  if (!Number.isFinite(value)) {
    return `${DASH}${THIN}${unit}`;
  }
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  let text = abs.toFixed(digits);
  if (trimZeros && text.includes(".")) {
    text = text.replace(/\.?0+$/, "");
  }
  return unit === "" ? `${sign}${text}` : `${sign}${text}${THIN}${unit}`;
}

/** Simulation-time axis readout: `formatTime(1.2e-3)` → `"1.2 ms"`. */
export function formatTime(seconds: number, options: FormatOptions = {}): string {
  return formatEng(seconds, "s", options);
}

const PREFIX_PARSE: Record<string, number> = {
  q: 1e-30,
  r: 1e-27,
  y: 1e-24,
  z: 1e-21,
  a: 1e-18,
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Z: 1e21,
  Y: 1e24,
  R: 1e27,
  Q: 1e30,
};

const INPUT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|mil|[a-zA-ZµμQR])?$/;

/**
 * Parse an engineering-notation input (`"4.7k"`, `"1.2 M"`, `"1meg"`,
 * `"3.3e-6"`) to a number, or null when invalid. `meg` (SPICE) wins over the
 * bare `m` prefix; `mil` is 25.4 µm. SI-style case (`M` = mega) differs from
 * netlist text — netlist parsing is the engine's job, this parser is UI-only.
 */
export function parseEngineering(text: string): number | null {
  const match = INPUT_RE.exec(text.trim());
  if (match === null) {
    return null;
  }
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) {
    return null;
  }
  const suffix = match[2];
  if (suffix === undefined) {
    return value;
  }
  if (suffix === "meg") {
    return value * 1e6;
  }
  if (suffix === "mil") {
    return value * 25.4e-6;
  }
  const factor = PREFIX_PARSE[suffix];
  return factor === undefined ? null : value * factor;
}

/** Round-trip helper: format then parse; null when not representable. */
export function roundTrip(value: number): number | null {
  return parseEngineering(formatSI(value));
}

/* ── Signal naming (UI-UX-SPEC Appendix A) ──────────────────────────────── */

const SIGNAL_PREFIXES: Record<string, string> = {
  v: "V",
  vm: "V",
  vr: "V",
  vi: "V",
  i: "I",
  im: "I",
  ir: "I",
  ii: "I",
  vp: "∠V",
  ip: "∠I",
  vdb: "V",
  idb: "I",
  p: "P",
};

/** Pretty label for a raw engine signal: `v(out)` → `V(out)`, `i(v1)` → `I(V1)`. */
export function prettySignal(rawName: string): string {
  const match = /^([a-z]+)\((.+)\)$/.exec(rawName);
  if (match === null) {
    return rawName;
  }
  const key = match[1];
  const inner0 = match[2];
  if (key === undefined || inner0 === undefined) {
    return rawName;
  }
  const pretty = SIGNAL_PREFIXES[key];
  if (pretty === undefined) {
    return rawName;
  }
  const isCurrent = key.startsWith("i");
  const inner = isCurrent
    ? inner0.toUpperCase() // element names display uppercase: I(R1)
    : inner0.replace(/^[^:]+/, (element) =>
        inner0.includes(":") ? element.toUpperCase() : element,
      ); // v(c1:1) → V(C1:1); plain nodes stay lowercase: V(out)
  return `${pretty}(${inner})`;
}

/** Unit for a raw engine signal name (v→V, i→A, vm→V, vp→°, vdb→dB, …). */
export function signalUnit(rawName: string): string {
  const kind = rawName.replace(/\(.*\)$/, "");
  const units: Record<string, string> = {
    v: "V",
    vm: "V",
    vr: "V",
    vi: "V",
    i: "A",
    im: "A",
    ir: "A",
    ii: "A",
    vp: "°",
    ip: "°",
    vdb: "dB",
    idb: "dB",
    p: "W",
    onoise_spectrum: "V/√Hz",
    inoise_spectrum: "A/√Hz",
    transfer_function: "V/V",
    input_impedance: "Ω",
    output_impedance: "Ω",
  };
  const unit = units[kind];
  return unit ?? "";
}
