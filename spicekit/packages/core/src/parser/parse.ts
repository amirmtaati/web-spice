/**
 * Netlist parser entry point (SPEC §5.1). `parseNetlist` converts SPICE3
 * text into the Circuit IR; `serializeNetlist` (serialize.ts) converts back.
 * Round trip `parse(serialize(ir))` equals the IR and is property-tested
 * (§13.3). Diagnostics carry 1-based line/column (§5.1).
 */

import type { Circuit, Element } from "@spicekit/protocol";
import { EngineError } from "@spicekit/protocol";

import {
  type ElementParser,
  parseC,
  parseD,
  parseE,
  parseF,
  parseG,
  parseH,
  parseJ,
  parseK,
  parseL,
  parseM,
  parseQ,
  parseR,
  parseVI,
} from "./cards.ts";
import { handleDirective, newAccumulator, target } from "./directives.ts";
import { directiveName, type LexCard, lexNetlist, NetlistSyntaxError } from "./lexer.ts";

const CARD_PARSERS: Readonly<Record<string, ElementParser>> = {
  r: parseR,
  c: parseC,
  l: parseL,
  k: parseK,
  v: parseVI,
  i: parseVI,
  e: parseE,
  g: parseG,
  f: parseF,
  h: parseH,
  d: parseD,
  q: parseQ,
  m: parseM,
  j: parseJ,
};

/** Element types with card syntax but no simulator implementation until E2+. */
export const PARSED_NOT_SIMULATED: ReadonlySet<string> = new Set(["d", "q", "m", "j"]);

/** Return the netlist text for an .include path (host-provided). */
export type IncludeResolver = (path: string) => string;

/**
 * Parse SPICE netlist text into the Circuit IR. Throws `EngineError` with
 * code `E_PARSE` (carrying line/column) on invalid input. `.include` needs a
 * host-provided resolver; without one it is a parse error.
 */
export function parseNetlistImpl(text: string, include?: IncludeResolver): Circuit {
  const lexed = lexNetlistOrThrow(text);
  const acc = newAccumulator(lexed.title.trim());
  for (const card of lexed.cards) {
    if (acc.ended) {
      break; // cards after .end are ignored (SPICE convention)
    }
    try {
      const dir = directiveName(card);
      if (dir !== undefined) {
        if (dir === ".include") {
          handleInclude(card, acc, include);
          continue;
        }
        handleDirective(card, acc);
      } else {
        appendElement(card, acc);
      }
    } catch (error) {
      throw toEngineError(error);
    }
  }
  if (acc.subcktStack.length > 0) {
    const open = acc.subcktStack[acc.subcktStack.length - 1];
    throw new EngineError({
      code: "E_PARSE",
      message: `Unterminated .subckt "${open?.name ?? ""}" (missing .ends)`,
      location: { line: lexed.cards[lexed.cards.length - 1]?.startLine ?? 0 },
    });
  }
  return acc.circuit;
}

function lexNetlistOrThrow(text: string): ReturnType<typeof lexNetlist> {
  try {
    return lexNetlist(text);
  } catch (error) {
    throw toEngineError(error);
  }
}
function appendElement(card: LexCard, acc: ReturnType<typeof newAccumulator>): void {
  const head = card.tokens[0];
  if (head === undefined) {
    return;
  }
  const kind = head.text.charAt(0).toLowerCase();
  const parser = CARD_PARSERS[kind];
  if (parser === undefined) {
    const future = kind === "b" || kind === "s" || kind === "w" || kind === "x";
    throw new NetlistSyntaxError(
      future
        ? `Element type "${kind.toUpperCase()}" is parsed from milestone E2/E3 onward`
        : `Unknown element type "${head.text}"`,
      head.line,
      head.col,
    );
  }
  const element: Element = parser(card.tokens);
  target(acc).elements.push(element);
}

function handleInclude(
  card: LexCard,
  acc: ReturnType<typeof newAccumulator>,
  include?: IncludeResolver,
): void {
  const path = card.tokens[1]?.text;
  if (path === undefined) {
    throw new NetlistSyntaxError(".include expects a file path", card.startLine, 1);
  }
  if (include === undefined) {
    throw new NetlistSyntaxError(
      ".include requires a host-provided IncludeResolver (none given)",
      card.startLine,
      1,
    );
  }
  const nested = parseNetlistImpl(include(path), include);
  const t = target(acc);
  t.elements.push(...nested.elements);
  for (const [name, model] of Object.entries(nested.models)) {
    t.models[name] = model;
  }
  for (const [name, sub] of Object.entries(nested.subcircuits)) {
    t.subcircuits[name] = sub;
  }
  for (const [name, value] of Object.entries(nested.params)) {
    t.params[name] = value;
  }
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) {
    return error;
  }
  if (error instanceof NetlistSyntaxError) {
    return new EngineError({
      code: "E_PARSE",
      message: error.message,
      location: { line: error.line, column: error.col },
    });
  }
  // Known domain errors from value/waveform parsing get normalized to
  // E_PARSE; anything else (TypeError etc.) is a real bug and propagates.
  if (error instanceof Error) {
    const name = error.name;
    if (name === "SuffixParseError" || name === "ExpressionError") {
      return new EngineError({ code: "E_PARSE", message: error.message });
    }
  }
  throw error;
}
