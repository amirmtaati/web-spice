/**
 * SPICE3-style netlist parser (SPEC §5.1). Parsed diagnostics carry line and
 * column. Round-trip `parse(serialize(ir))` must equal the IR — property
 * tested (SPEC §13.3).
 */

export type { CardToken, LexCard } from "./lexer.ts";
export { lexNetlist, NetlistSyntaxError } from "./lexer.ts";
export type { IncludeResolver } from "./parse.ts";
export { PARSED_NOT_SIMULATED, parseNetlistImpl } from "./parse.ts";
export { serializeNetlist } from "./serialize.ts";
export {
  formatExact,
  formatValue,
  parseValue,
  SuffixParseError,
  tryParseSpiceNumber,
} from "./suffix.ts";
export { matchWaveform } from "./waveforms.ts";

import type { Circuit } from "@spicekit/protocol";

import { type IncludeResolver, parseNetlistImpl } from "./parse.ts";

export interface ParseDiagnostics {
  line: number;
  column: number;
  message: string;
}

export interface ParseResult {
  circuit?: Circuit;
  diagnostics: ParseDiagnostics[];
}

/**
 * Parse SPICE netlist text into the Circuit IR. Throws `EngineError`
 * (`E_PARSE`, with line/column) on invalid input; use `tryParseNetlist` for
 * the diagnostics-shaped variant.
 */
export function parseNetlist(text: string, include?: IncludeResolver): Circuit {
  return parseNetlistImpl(text, include);
}

/** Non-throwing variant: first error becomes a single diagnostic entry. */
export function tryParseNetlist(text: string, include?: IncludeResolver): ParseResult {
  try {
    return { circuit: parseNetlistImpl(text, include), diagnostics: [] };
  } catch (error) {
    const err = error as { message?: string; location?: { line?: number; column?: number } };
    const loc = err.location ?? {};
    return {
      diagnostics: [
        {
          line: loc.line ?? 0,
          column: loc.column ?? 0,
          message: err.message ?? String(error),
        },
      ],
    };
  }
}
