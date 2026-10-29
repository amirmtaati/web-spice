/**
 * Netlist card lexer (SPEC §5.1). Splits SPICE text into logical cards:
 * title line, element cards, and dot directives, with `+` continuation lines
 * merged and comments (`*` full-line, `;` inline) removed. Tokens carry
 * 1-based line/column for precise diagnostics.
 */

export interface CardToken {
  text: string;
  line: number;
  /** 1-based column of the token start within its physical line. */
  col: number;
}

export interface LexCard {
  tokens: CardToken[];
  /** Physical line where the card starts. */
  startLine: number;
}

export interface LexResult {
  title: string;
  cards: LexCard[];
}

export class NetlistSyntaxError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.name = "NetlistSyntaxError";
    this.line = line;
    this.col = col;
  }
}

export function lexNetlist(text: string): LexResult {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    throw new NetlistSyntaxError("Empty netlist (missing title line)", 1, 1);
  }
  const title = lines[0] ?? "";
  const cards: LexCard[] = [];
  let current: LexCard | undefined;

  for (let lineNo = 2; lineNo <= lines.length; lineNo++) {
    const raw = lines[lineNo - 1] ?? "";
    const first = firstSignificant(raw);
    if (first === undefined) {
      continue; // blank or full-line comment
    }
    if (raw.charAt(0) === "+") {
      if (current === undefined) {
        throw new NetlistSyntaxError("Continuation line without a preceding card", lineNo, 1);
      }
      // Skip the '+' itself; colOffset=1 keeps columns true to the line.
      appendTokens(current, stripInlineComment(raw.slice(1)), lineNo, 1);
      continue;
    }
    current = { tokens: [], startLine: lineNo };
    appendTokens(current, stripInlineComment(raw), lineNo, 0);
    cards.push(current);
  }
  return { title, cards };
}

function firstSignificant(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (trimmed.length === 0 || trimmed.charAt(0) === "*") {
    return undefined;
  }
  return trimmed.charAt(0);
}

/** `;` starts an inline comment (SPICE3 convention, per SPEC §5.1). */
function stripInlineComment(line: string): string {
  const semi = line.indexOf(";");
  return semi === -1 ? line : line.slice(0, semi);
}

function appendTokens(card: LexCard, line: string, lineNo: number, colOffset: number): void {
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === " " || ch === "\t" || ch === ",") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < line.length) {
      const c = line.charAt(i);
      if (c === " " || c === "\t" || c === ",") {
        break;
      }
      i += 1;
    }
    card.tokens.push({ text: line.slice(start, i), line: lineNo, col: start + 1 + colOffset });
  }
}

/** Case-insensitive directive name of a card, e.g. ".param" — or undefined. */
export function directiveName(card: LexCard): string | undefined {
  const first = card.tokens[0]?.text ?? "";
  return first.startsWith(".") ? first.toLowerCase() : undefined;
}
