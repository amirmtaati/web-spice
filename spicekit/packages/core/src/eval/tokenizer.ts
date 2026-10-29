/**
 * Expression tokenizer (SPEC §5.6). Position-tracking lexer for the expression
 * grammar: numbers (with SPICE engineering suffixes), identifiers, operators,
 * and punctuation. Numbers inside expressions are strict — a single optional
 * suffix and no trailing units — so "2pi" is a syntax error, not a silent 2.
 */

import { tryParseSpiceNumber } from "../parser/suffix.ts";

export class ExpressionError extends Error {
  /** Character offset of the offending token in the source expression. */
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`${message} (at offset ${pos})`);
    this.name = "ExpressionError";
    this.pos = pos;
  }
}

export type TokenType = "number" | "ident" | "op" | "lparen" | "rparen" | "comma" | "end";

export interface Token {
  type: TokenType;
  /** Normalized text: for numbers, the numeric value as text. */
  text: string;
  /** Numeric payload for "number" tokens. */
  value: number;
  pos: number;
}

/** Multi-char operators must precede their prefixes in this list. */
const OPERATORS: readonly string[] = [
  "**",
  "||",
  "&&",
  "==",
  "!=",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "<",
  ">",
  "!",
  "?",
  ":",
];

const IDENT_START = /[a-zA-Z_]/;
const IDENT_CONT = /[a-zA-Z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (DIGIT.test(ch) || (ch === "." && i + 1 < src.length && DIGIT.test(src[i + 1] as string))) {
      i = lexNumber(src, i, tokens);
      continue;
    }
    if (IDENT_START.test(ch)) {
      const start = i;
      i += 1;
      while (i < src.length && IDENT_CONT.test(src[i] as string)) {
        i += 1;
      }
      tokens.push({ type: "ident", text: src.slice(start, i), value: Number.NaN, pos: start });
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", text: "(", value: Number.NaN, pos: i });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", text: ")", value: Number.NaN, pos: i });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", text: ",", value: Number.NaN, pos: i });
      i += 1;
      continue;
    }
    const op = matchOperator(src, i);
    if (op !== undefined) {
      tokens.push({ type: "op", text: op, value: Number.NaN, pos: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${ch}"`, i);
  }
  tokens.push({ type: "end", text: "", value: Number.NaN, pos: src.length });
  return tokens;
}

function lexNumber(src: string, start: number, tokens: Token[]): number {
  let i = start;
  while (i < src.length && (DIGIT.test(src[i] as string) || src[i] === ".")) {
    i += 1;
  }
  // Scientific exponent: 'e'/'E' must be followed by optional sign + digit,
  // otherwise it belongs to a suffix or the next token.
  if ((src[i] === "e" || src[i] === "E") && /[0-9+-]/.test(src[i + 1] ?? "")) {
    const expStart = i;
    i += 1;
    if (src[i] === "+" || src[i] === "-") {
      i += 1;
    }
    while (i < src.length && DIGIT.test(src[i] as string)) {
      i += 1;
    }
    // Guard against "2e3.5": '.' cannot appear inside a strict exponent.
    if (src[i] === ".") {
      throw new ExpressionError("Malformed number", expStart);
    }
  }
  // Engineering suffix run: "1meg", "100n", "4.7k". Whether the letters
  // form a valid suffix is decided by tryParseSpiceNumber below.
  while (i < src.length && /[a-zA-Z]/.test(src[i] as string)) {
    i += 1;
  }
  const raw = src.slice(start, i);
  const value = tryParseSpiceNumber(raw);
  if (value === undefined) {
    throw new ExpressionError(`Invalid number "${raw}"`, start);
  }
  // A digit/letter glued to the number ("1k3", "2_x") is a syntax error:
  // expressions require explicit operators (unlike loose element values).
  if (i < src.length && /[a-zA-Z0-9_.]/.test(src[i] as string)) {
    throw new ExpressionError(`Unexpected character after number "${raw}"`, i);
  }
  tokens.push({ type: "number", text: raw, value, pos: start });
  return i;
}

function matchOperator(src: string, i: number): string | undefined {
  for (const op of OPERATORS) {
    if (src.startsWith(op, i)) {
      return op;
    }
  }
  return undefined;
}
