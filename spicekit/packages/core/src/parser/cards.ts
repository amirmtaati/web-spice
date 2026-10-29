/**
 * Element card parsers (SPEC §5.1, E1 set: R C L K V I E G F H, plus the
 * nonlinear D/Q/M/J cards which parse now and simulate from E2). Each parser
 * consumes one card's tokens and produces an IR `Element`. Values follow
 * SPICE semantics: engineering suffixes, `{expr}` expressions, key=value
 * extras (TC=, IC=, AREA=, W=/L=).
 */

import type { Element, Expr } from "@spicekit/protocol";
import type { CardToken } from "./lexer.ts";
import { NetlistSyntaxError } from "./lexer.ts";
import { parseValue } from "./suffix.ts";
import { matchWaveform } from "./waveforms.ts";

export type ElementParser = (card: CardToken[]) => Element;

/** Narrowed element types so optional fields are assignable after creation. */
type REl = Extract<Element, { type: "R" }>;
type CEl = Extract<Element, { type: "C" }>;
type LEl = Extract<Element, { type: "L" }>;
type VIEl = Extract<Element, { type: "V" | "I" }>;
type DEl = Extract<Element, { type: "D" }>;
type QEl = Extract<Element, { type: "Q" }>;
type MEl = Extract<Element, { type: "M" }>;
type JEl = Extract<Element, { type: "J" }>;
type SEl = Extract<Element, { type: "S" }>;
type WEl = Extract<Element, { type: "W" }>;

const FAIL = NetlistSyntaxError;

function tok(tokens: CardToken[], i: number): CardToken {
  const t = tokens[i];
  if (t === undefined) {
    const last = tokens[tokens.length - 1] ?? { text: "", line: 1, col: 1 };
    throw new FAIL(
      `Unexpected end of card (missing operand after "${last.text}")`,
      last.line,
      last.col + last.text.length + 1,
    );
  }
  return t;
}

/**
 * Parse a value/expression token. `{...}` becomes an Expr string (braces
 * stripped, possibly joined across whitespace); otherwise an engineering
 * suffix number. Returns the Expr and the index of the next unconsumed token.
 */
function parseExprValue(tokens: CardToken[], i: number): { expr: Expr; next: number } {
  const first = tok(tokens, i);
  if (!first.text.startsWith("{")) {
    try {
      return { expr: parseValue(first.text), next: i + 1 };
    } catch {
      throw new FAIL(`Invalid value "${first.text}"`, first.line, first.col);
    }
  }
  let text = first.text;
  let j = i;
  while (!text.includes("}")) {
    j += 1;
    text += ` ${tok(tokens, j).text}`;
  }
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (close === -1 || close < open) {
    throw new FAIL("Malformed {expression}", first.line, first.col);
  }
  return { expr: text.slice(open + 1, close).trim(), next: j + 1 };
}

interface KeyValues {
  tc1?: number;
  tc2?: number;
  ic?: number;
  area?: number;
  w?: Expr;
  l?: Expr;
}

/** Consume trailing key=value extras (TC=, IC=, AREA=, W=, L=). */
function parseExtras(tokens: CardToken[], i: number): { extras: KeyValues; next: number } {
  const extras: KeyValues = {};
  let index = i;
  while (index < tokens.length) {
    const t = tok(tokens, index);
    const eq = t.text.indexOf("=");
    const key = (eq === -1 ? t.text : t.text.slice(0, eq)).toLowerCase();
    const inline = eq === -1 ? undefined : t.text.slice(eq + 1);

    // Value source: inline after '=', or the following token(s).
    const readValue = (): { expr: Expr; next: number } =>
      inline !== undefined && inline.length > 0
        ? { expr: parseExprValue([{ ...t, text: inline }], 0).expr, next: index + 1 }
        : parseExprValue(tokens, index + 1);

    if (key === "tc") {
      // TC=a[,b] — the lexer splits on commas, so a following bare number
      // token is tc2 ("TC=0.001, 0.00002" ≡ "TC=0.001" "0.00002").
      const first = readValue();
      extras.tc1 = asNumber(first.expr, t, "tc1");
      const peek = tokens[first.next];
      if (peek !== undefined && /^[+-]?(\d|\.)/.test(peek.text)) {
        extras.tc2 = parseValue(peek.text);
        index = first.next + 1;
      } else {
        index = first.next;
      }
      continue;
    }
    if (key === "ic" || key === "area") {
      const r = readValue();
      if (key === "ic") {
        extras.ic = asNumber(r.expr, t, "ic");
      } else {
        extras.area = asNumber(r.expr, t, "area");
      }
      index = r.next;
      continue;
    }
    if (key === "w" || key === "l") {
      const r = readValue();
      if (key === "w") {
        extras.w = r.expr;
      } else {
        extras.l = r.expr;
      }
      index = r.next;
      continue;
    }
    throw new FAIL(`Unknown card parameter "${t.text}"`, t.line, t.col);
  }
  return { extras, next: index };
}

function asNumber(expr: Expr, at: CardToken, what: string): number {
  if (typeof expr !== "number") {
    throw new FAIL(`${what} must be a plain number, not an expression`, at.line, at.col);
  }
  return expr;
}

function nodes(tokens: CardToken[], from: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(tok(tokens, from + i).text);
  }
  return out;
}

export const parseR: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const { expr, next } = parseExprValue(tokens, 3);
  const { extras } = parseExtras(tokens, next);
  const el: REl = {
    type: "R",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    value: expr,
  };
  if (extras.tc1 !== undefined) {
    el.tc1 = extras.tc1;
  }
  if (extras.tc2 !== undefined) {
    el.tc2 = extras.tc2;
  }
  return el;
};

export const parseC: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const { expr, next } = parseExprValue(tokens, 3);
  const { extras } = parseExtras(tokens, next);
  const el: CEl = {
    type: "C",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    value: expr,
  };
  if (extras.ic !== undefined) {
    el.ic = extras.ic;
  }
  return el;
};

export const parseL: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const { expr, next } = parseExprValue(tokens, 3);
  const { extras } = parseExtras(tokens, next);
  const el: LEl = {
    type: "L",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    value: expr,
  };
  if (extras.ic !== undefined) {
    el.ic = extras.ic;
  }
  return el;
};

export const parseK: ElementParser = (tokens) => {
  const l1 = tok(tokens, 1).text;
  const l2 = tok(tokens, 2).text;
  const { expr } = parseExprValue(tokens, 3);
  const coupling = asNumber(expr, tok(tokens, 3), "coupling coefficient");
  return { type: "K", name: tok(tokens, 0).text, inductors: [l1, l2], coupling };
};

export const parseVI: ElementParser = (tokens) => {
  const type = tok(tokens, 0).text.charAt(0).toUpperCase() === "V" ? "V" : "I";
  const n = nodes(tokens, 1, 2);
  const el: VIEl = { type, name: tok(tokens, 0).text, n: [n[0] as string, n[1] as string] };
  let i = 3;
  let sawDc = false;
  while (i < tokens.length) {
    const t = tok(tokens, i);
    const head = t.text.toLowerCase();
    if (head === "dc") {
      if (sawDc) {
        throw new FAIL("Duplicate DC specification", t.line, t.col);
      }
      const { expr, next } = parseExprValue(tokens, i + 1);
      el.dc = expr;
      sawDc = true;
      i = next;
      continue;
    }
    if (head === "ac") {
      const magTok = tok(tokens, i + 1);
      const phase =
        tokens[i + 2] !== undefined && !isKeywordOrWave(tokens[i + 2] as CardToken)
          ? parseValue((tokens[i + 2] as CardToken).text)
          : undefined;
      el.ac =
        phase !== undefined
          ? { mag: parseValue(magTok.text), phase }
          : { mag: parseValue(magTok.text) };
      i += phase !== undefined ? 3 : 2;
      continue;
    }
    const waveMatch = matchWaveform(tokens, i);
    if (waveMatch !== undefined) {
      el.wave = waveMatch.wave;
      i += waveMatch.consumed;
      continue;
    }
    if (sawDc) {
      throw new FAIL(`Unexpected token "${t.text}" after DC value`, t.line, t.col);
    }
    const { expr, next } = parseExprValue(tokens, i);
    el.dc = expr;
    sawDc = true;
    i = next;
  }
  return el;
};

function isKeywordOrWave(t: CardToken): boolean {
  const lower = t.text.toLowerCase();
  return ["dc", "ac"].includes(lower) || ["sin", "pulse", "pwl"].some((k) => lower.startsWith(k));
}

export const parseE: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 4);
  const { expr } = parseExprValue(tokens, 5);
  const gain = asNumber(expr, tok(tokens, 5), "voltage gain");
  return { type: "E", name: tok(tokens, 0).text, n, gain };
};

export const parseG: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 4);
  const { expr } = parseExprValue(tokens, 5);
  const gm = asNumber(expr, tok(tokens, 5), "transconductance");
  return { type: "G", name: tok(tokens, 0).text, n, gm };
};

export const parseF: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const control = tok(tokens, 3).text;
  const { expr } = parseExprValue(tokens, 4);
  const gain = asNumber(expr, tok(tokens, 4), "current gain");
  return { type: "F", name: tok(tokens, 0).text, n, control, gain };
};

export const parseH: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const control = tok(tokens, 3).text;
  const { expr } = parseExprValue(tokens, 4);
  const gain = asNumber(expr, tok(tokens, 4), "transresistance");
  return { type: "H", name: tok(tokens, 0).text, n, control, gain };
};

export const parseD: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const model = tok(tokens, 3).text;
  const el: DEl = {
    type: "D",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    model,
  };
  if (tokens.length > 4) {
    el.area = parseValue(tok(tokens, 4).text);
  }
  return el;
};

export const parseQ: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 3);
  const model = tok(tokens, 4).text;
  const el: QEl = {
    type: "Q",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string, n[2] as string],
    model,
  };
  if (tokens.length > 5) {
    el.area = parseValue(tok(tokens, 5).text);
  }
  return el;
};

export const parseM: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 4);
  const model = tok(tokens, 5).text;
  const el: MEl = {
    type: "M",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string, n[2] as string, n[3] as string],
    model,
  };
  const { extras } = parseExtras(tokens, 6);
  if (extras.w !== undefined) {
    el.w = extras.w;
  }
  if (extras.l !== undefined) {
    el.l = extras.l;
  }
  return el;
};

export const parseJ: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 3);
  const model = tok(tokens, 4).text;
  const el: JEl = {
    type: "J",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string, n[2] as string],
    model,
  };
  if (tokens.length > 5) {
    el.area = parseValue(tok(tokens, 5).text);
  }
  return el;
};

/** Sxxx n+ n- nc+ nc- mname [ON|OFF] — voltage-controlled switch. */
export const parseS: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 4);
  const model = tok(tokens, 5).text;
  const el: SEl = {
    type: "S",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    ctrl: [n[2] as string, n[3] as string],
    model,
  };
  applyOnOff(tokens, 6, el);
  return el;
};

/** Wxxx n+ n- vsource mname [ON|OFF] — current-controlled switch. */
export const parseW: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  const control = tok(tokens, 3).text;
  const model = tok(tokens, 4).text;
  const el: WEl = {
    type: "W",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    control,
    model,
  };
  applyOnOff(tokens, 5, el);
  return el;
};

/** Bxxx n+ n- V|I = expression — behavioral source (E3). */
export const parseB: ElementParser = (tokens) => {
  const n = nodes(tokens, 1, 2);
  // Three accepted spellings: `V = expr`, `V expr`, `V=expr` (the lexer may
  // glue the '=' and the start of the expression onto the kind token).
  const kindRaw = tok(tokens, 3).text;
  const eq = kindRaw.indexOf("=");
  const kindTok = (eq === -1 ? kindRaw : kindRaw.slice(0, eq)).toLowerCase();
  if (kindTok !== "v" && kindTok !== "i") {
    throw new FAIL(
      `B source expects "V = expr" or "I = expr", got "${kindRaw}"`,
      tok(tokens, 3).line,
      tok(tokens, 3).col,
    );
  }
  // Tokens are rejoined with spaces; the expression grammar treats
  // whitespace as argument separation (see eval/parser.ts).
  const parts: string[] = [];
  if (eq >= 0 && kindRaw.length > eq + 1) {
    parts.push(kindRaw.slice(eq + 1));
  }
  let i = eq >= 0 ? 4 : 4;
  if (eq === -1 && tok(tokens, 4).text === "=") {
    i = 5;
  }
  for (; i < tokens.length; i++) {
    parts.push(tok(tokens, i).text);
  }
  if (parts.length === 0) {
    const last = tok(tokens, 4);
    throw new FAIL(`B source is missing its expression`, last.line, last.col);
  }
  const kind = kindTok === "v" ? "V" : "I";
  return {
    type: "B",
    name: tok(tokens, 0).text,
    n: [n[0] as string, n[1] as string],
    kind,
    expr: parts.join(" "),
  };
};

/** Apply the optional ON/OFF state suffix (SPICE3 switch cards). */
function applyOnOff(tokens: CardToken[], at: number, el: SEl | WEl): void {
  if (tokens.length > at) {
    const word = tok(tokens, at).text.toUpperCase();
    if (word === "ON") {
      el.on = true;
    } else if (word === "OFF") {
      el.on = false;
    }
  }
}
