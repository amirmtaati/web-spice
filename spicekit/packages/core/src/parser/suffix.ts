/**
 * Engineering-suffix parsing/formatting (SPEC §5.1): SPICE units suffixes,
 * case-insensitive; `mil` = 25.4e-6. Round-trip is property-tested (§13.3).
 *
 * Examples: "4.7k" -> 4700, "100n" -> 1e-7, "1meg" -> 1e6, "2M" -> 2e6? —
 * SPICE is case-insensitive for prefixes, so "M" and "m" both mean milli;
 * "MEG"/"meg" means 1e6. Bare "f" is femto, not farad — context-free here.
 */

const SUFFIXES: readonly string[] = ["t", "g", "meg", "k", "mil", "m", "u", "n", "p", "f"] as const;

const FACTORS: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  mil: 25.4e-6,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/** Longest-first so "meg" wins over "m" when scanning a token tail. */
const ORDERED_SUFFIXES: readonly string[] = [...SUFFIXES].sort((a, b) => b.length - a.length);

export class SuffixParseError extends Error {
  readonly token: string;
  constructor(token: string, reason: string) {
    super(`Cannot parse value "${token}": ${reason}`);
    this.name = "SuffixParseError";
    this.token = token;
  }
}

/**
 * Parse a SPICE value token to a number. Accepts plain numbers ("100",
 * "1.5e3"), engineering suffixes ("4.7k", "100n", "1meg", "25mil"), and a
 * trailing unit ("10kohm", "47uf", "1nh") since SPICE ignores anything after
 * the numeric+prefix part. Throws `SuffixParseError` on garbage.
 */
export function parseValue(token: string): number {
  const s = token.trim();
  if (s.length === 0) {
    throw new SuffixParseError(token, "empty string");
  }

  // Optional sign, mantissa with optional fraction, optional exponent.
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/.exec(s);
  if (match === null) {
    throw new SuffixParseError(token, "not a number");
  }
  const mantissa = Number(match[1]);
  const tail = match[2] ?? "";
  if (!Number.isFinite(mantissa)) {
    throw new SuffixParseError(token, "out of range");
  }

  const lowerTail = tail.toLowerCase();
  if (lowerTail.length === 0) {
    return mantissa;
  }
  for (const suffix of ORDERED_SUFFIXES) {
    if (lowerTail.startsWith(suffix)) {
      const factor = FACTORS[suffix];
      if (factor === undefined) {
        break;
      }
      // Anything after the suffix is a unit ("kohm", "uf") and is ignored.
      return mantissa * factor;
    }
  }
  // Tolerate a bare unit with no prefix ("10ohm", "5V").
  return mantissa;
}

/**
 * Strict numeric token parse for expressions: mantissa + optional single
 * engineering suffix and *nothing else* ("1k" → 1000, "2e3" → 2000, but
 * "2pi" and "10kohm" are rejected). Expression syntax requires an explicit
 * operator, so looser unit-tolerance would silently mis-parse ("2pi" → 2).
 * Returns undefined when `token` is not a strict SPICE number.
 */
export function tryParseSpiceNumber(token: string): number | undefined {
  const s = token.trim();
  // Group 1 = mantissa INCLUDING exponent ("1e3" must evaluate as 1000).
  const match = /^((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/.exec(s);
  if (match === null) {
    return undefined;
  }
  const mantissa = Number(match[1]);
  if (!Number.isFinite(mantissa)) {
    return undefined;
  }
  const tail = (match[2] ?? "").toLowerCase();
  if (tail.length === 0) {
    return mantissa;
  }
  for (const suffix of ORDERED_SUFFIXES) {
    if (tail === suffix) {
      const factor = FACTORS[suffix];
      return factor === undefined ? undefined : mantissa * factor;
    }
  }
  return undefined;
}

/**
 * Format a number using engineering notation with the shortest exact-ish
 * representation (3 significant digits by default). Inverse of `parseValue`
 * for values in the suffix range 1e-15…1e12; property-tested (SPEC §13.3).
 */
export function formatValue(value: number, significantDigits = 3): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value === 0) {
    return "0";
  }
  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return `${trim(value / 1e12, significantDigits)}T`;
  }
  if (abs >= 1e9) {
    return `${trim(value / 1e9, significantDigits)}G`;
  }
  if (abs >= 1e6) {
    return `${trim(value / 1e6, significantDigits)}MEG`;
  }
  if (abs >= 1e3) {
    return `${trim(value / 1e3, significantDigits)}k`;
  }
  if (abs >= 1) {
    return trim(value, significantDigits);
  }
  const small: readonly [number, string][] = [
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
    [1e-15, "f"],
  ];
  for (const [scale, suffix] of small) {
    if (abs >= scale * 0.9995) {
      return trim(value / scale, significantDigits) + suffix;
    }
  }
  return value.toExponential(2);
}

function trim(x: number, digits: number): string {
  const rounded = Number(x.toPrecision(digits));
  return String(rounded);
}

/**
 * Exact round-trip formatting for serialization: prefer a pretty engineering
 * form, but verify it reparses to the identical double; otherwise fall back
 * to JS shortest-round-trip (`String(number)`), which is always exact. This
 * is what makes the parse(serialize(ir)) == IR property hold bit-for-bit.
 */
export function formatExact(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const candidates = [String(value), formatValue(value, 17), formatValue(value, 15)];
  for (const candidate of candidates) {
    try {
      if (parseValue(candidate) === value) {
        return candidate;
      }
    } catch {
      // fall through to the next candidate
    }
  }
  return String(value);
}
