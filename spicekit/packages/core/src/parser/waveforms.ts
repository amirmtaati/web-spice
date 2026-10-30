/**
 * Waveform source card parsing (SPEC §5.8): SIN, PULSE, PWL, EXTERNAL.
 * Accepted forms: `SIN(vo va freq [td [theta [phase]]])`,
 * `PULSE(v1 v2 td tr tf pw per)`, `PWL(t1 v1 t2 v2 ...)`, and
 * `EXTERNAL(chan)` (E4 — live host-driven channel, SPEC §4.4). Parentheses
 * are optional except for EXTERNAL; arguments may span continuation lines
 * (already merged into the card by the lexer).
 */

import type { Waveform } from "@spicekit/protocol";
import type { CardToken } from "./lexer.ts";
import { NetlistSyntaxError } from "./lexer.ts";
import { parseValue } from "./suffix.ts";

/** Result of consuming a waveform off a card's token stream. */
interface WaveformMatch {
  wave: Waveform;
  /** Number of tokens consumed (including the function-name token). */
  consumed: number;
}

const WAVE_KEYWORDS: readonly string[] = ["sin", "pulse", "pwl", "external"];

/** If the token opens a waveform (`SIN...`), parse it; else undefined. */
export function matchWaveform(tokens: CardToken[], start: number): WaveformMatch | undefined {
  const head = (tokens[start]?.text ?? "").toLowerCase();
  const kind = WAVE_KEYWORDS.find((k) => head.startsWith(k));
  if (kind === undefined) {
    return undefined;
  }
  const args = collectArgs(tokens, start, head.slice(kind.length));
  let consumed = args.consumed; // includes the head token
  const wave =
    kind === "sin"
      ? parseSin(args, tokens[start] as CardToken)
      : kind === "pulse"
        ? parsePulse(args, tokens[start] as CardToken)
        : kind === "external"
          ? parseExternal(args, tokens[start] as CardToken)
          : parsePwl(args, tokens[start] as CardToken);
  // PWL postfix: REPEAT may follow the argument list outside the parens.
  if (kind === "pwl" && wave.kind === "PWL" && wave.repeat !== true) {
    const peek = tokens[start + consumed];
    if (peek !== undefined && peek.text.toLowerCase() === "repeat") {
      wave.repeat = true;
      consumed += 1;
    }
  }
  return { wave, consumed };
}

interface CollectedArgs {
  values: string[];
  /** Tokens consumed after the head token (args + closing paren). */
  consumed: number;
}

/**
 * Gather the argument list. `open` is whatever follows the keyword inside the
 * head token: "" for `SIN`, "(" for `SIN(`, or "0 1 1k)" for a packed form.
 */
function collectArgs(tokens: CardToken[], start: number, open: string): CollectedArgs {
  const values: string[] = [];
  let openParens = 0;
  let first = true;
  let i = start;

  const pushPacked = (packed: string): void => {
    for (const piece of packed.split(/[\s,]+/)) {
      if (piece.length > 0) {
        values.push(piece);
      }
    }
  };

  // Handle the remainder of the head token (after the keyword).
  if (open.length > 0) {
    openParens += countChar(open, "(") - countChar(open, ")");
    if (openParens < 0) {
      throw new NetlistSyntaxError(
        "Unbalanced ')' in waveform",
        (tokens[start] as CardToken).line,
        (tokens[start] as CardToken).col,
      );
    }
    // Fully closed: cut at the last ')' and strip a leading '('
    // (e.g. "EXTERNAL(gen)" arrives as one glued head token).
    // Unclosed: strip the leading '(' (e.g. "SIN(0" head leaves open="(0").
    const inner =
      openParens === 0
        ? open.slice(open.startsWith("(") ? 1 : 0, open.lastIndexOf(")"))
        : open.replace(/^\(+/, "");
    pushPacked(inner);
    first = false;
    i = start + 1;
    if (openParens === 0) {
      return { values, consumed: i - start };
    }
  } else {
    i = start + 1;
  }

  while (i < tokens.length) {
    const token = tokens[i] as CardToken;
    let text = token.text;
    if (first && text.startsWith("(")) {
      // Standalone "(" token or "(args...)".
      openParens += countChar(text, "(") - countChar(text, ")");
      text = openParens === 0 ? text.slice(1, text.lastIndexOf(")")) : text.slice(1);
      if (openParens === 0) {
        pushPacked(text);
        return { values, consumed: i - start + 1 };
      }
      pushPacked(text);
      first = false;
      i += 1;
      continue;
    }
    first = false;
    if (openParens > 0) {
      const closed = countChar(text, ")");
      openParens += countChar(text, "(") - closed;
      if (closed > 0) {
        const cut = text.lastIndexOf(")");
        pushPacked(text.slice(0, cut));
        return { values, consumed: i - start + 1 };
      }
      pushPacked(text);
      i += 1;
      continue;
    }
    // No parentheses: consume until a token that looks like a new keyword.
    if (/^[a-z]+\(?/i.test(text) && !/^[+-]?(\d|\.)/.test(text)) {
      return { values, consumed: i - start };
    }
    pushPacked(text);
    i += 1;
  }
  if (openParens > 0) {
    const head = tokens[start] as CardToken;
    throw new NetlistSyntaxError("Missing ')' in waveform arguments", head.line, head.col);
  }
  return { values, consumed: i - start };
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ch) {
      n += 1;
    }
  }
  return n;
}

function value(token: string, where: CardToken, what: string): number {
  try {
    return parseValue(token);
  } catch {
    throw new NetlistSyntaxError(`Invalid ${what} "${token}" in waveform`, where.line, where.col);
  }
}

function parseExternal(args: CollectedArgs, where: CardToken): Waveform {
  const v = args.values;
  if (v.length !== 1) {
    throw new NetlistSyntaxError(
      "EXTERNAL expects exactly one channel argument: EXTERNAL(chan)",
      where.line,
      where.col,
    );
  }
  return { kind: "EXTERNAL", channel: v[0] as string };
}

function parseSin(args: CollectedArgs, where: CardToken): Waveform {
  const v = args.values;
  if (v.length < 3 || v.length > 6) {
    throw new NetlistSyntaxError(
      "SIN expects SIN(offset amp freq [delay [damping [phase]]])",
      where.line,
      where.col,
    );
  }
  const wave: Waveform = {
    kind: "SIN",
    offset: value(v[0] as string, where, "offset"),
    amp: value(v[1] as string, where, "amplitude"),
    freq: value(v[2] as string, where, "frequency"),
  };
  if (v.length > 3) {
    wave.delay = value(v[3] as string, where, "delay");
  }
  if (v.length > 4) {
    wave.damping = value(v[4] as string, where, "damping");
  }
  if (v.length > 5) {
    wave.phase = value(v[5] as string, where, "phase");
  }
  return wave;
}

function parsePulse(args: CollectedArgs, where: CardToken): Waveform {
  const v = args.values;
  if (v.length !== 7) {
    throw new NetlistSyntaxError(
      "PULSE expects PULSE(v1 v2 td tr tf pw per)",
      where.line,
      where.col,
    );
  }
  return {
    kind: "PULSE",
    v1: value(v[0] as string, where, "v1"),
    v2: value(v[1] as string, where, "v2"),
    delay: value(v[2] as string, where, "delay"),
    rise: value(v[3] as string, where, "rise time"),
    fall: value(v[4] as string, where, "fall time"),
    width: value(v[5] as string, where, "pulse width"),
    period: value(v[6] as string, where, "period"),
  };
}

function parsePwl(args: CollectedArgs, where: CardToken): Waveform {
  const v = args.values;
  let repeat = false;
  let end = v.length;
  if (end > 0 && (v[end - 1] as string).toLowerCase() === "repeat") {
    repeat = true;
    end -= 1;
  }
  if (end === 0 || end % 2 !== 0) {
    throw new NetlistSyntaxError(
      "PWL expects PWL(t1 v1 t2 v2 ...) with time/value pairs",
      where.line,
      where.col,
    );
  }
  const points: [number, number][] = [];
  for (let i = 0; i < end; i += 2) {
    points.push([
      value(v[i] as string, where, "time point"),
      value(v[i + 1] as string, where, "value point"),
    ]);
  }
  for (let i = 1; i < points.length; i++) {
    if ((points[i] as [number, number])[0] <= (points[i - 1] as [number, number])[0]) {
      throw new NetlistSyntaxError(
        "PWL time points must be strictly increasing",
        where.line,
        where.col,
      );
    }
  }
  const wave: Waveform = { kind: "PWL", points };
  if (repeat) {
    wave.repeat = true;
  }
  return wave;
}
