/**
 * SPICE3-style netlist parser (SPEC §5.1). Parsed diagnostics carry line and
 * column. Round-trip `parse(serialize(ir))` must equal the IR — property
 * tested (SPEC §13.3).
 */
import type { Circuit } from "@spicekit/protocol";
import { EngineError } from "@spicekit/protocol";

export { formatValue, parseValue, SuffixParseError } from "./suffix.ts";

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
 * Parse SPICE netlist text into the Circuit IR.
 * Not implemented yet — lands with E1 (SPEC §22). Throws a located
 * `E_NOT_IMPLEMENTED` error until then.
 */
export function parseNetlist(_text: string): Circuit {
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "SPICE parser lands with milestone E1 (SPEC §22).",
  });
}

/**
 * Serialize a Circuit IR back to SPICE text (round-trip partner of
 * `parseNetlist`). Not implemented yet — lands with E1.
 */
export function serializeNetlist(_circuit: Circuit): string {
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "SPICE serializer lands with milestone E1 (SPEC §22).",
  });
}
