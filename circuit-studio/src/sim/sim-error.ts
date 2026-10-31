/**
 * Typed sim-error mapping (UX2-T5, AGENTS.md §7.3): converts thrown engine
 * errors into the typed SimError surface with line text and UI component ids
 * resolved via Circuit.sourceMap — the banner/ERC pinning data source.
 */
import type { SimError } from "../stores/sim-store.ts";
import { EngineError } from "./types.ts";

/** Map a thrown error to the typed SimError surface (AGENTS.md §7.3). */
export function toSimError(
  err: unknown,
  phase: SimError["phase"],
  ctx: { sourceText?: string; sourceMap?: Record<string, string> },
): SimError {
  if (err instanceof EngineError) {
    const loc = err.location;
    let lineText: string | undefined;
    if (loc?.line !== undefined && ctx.sourceText !== undefined) {
      lineText = ctx.sourceText.split("\n")[loc.line - 1]?.trim();
    }
    const componentId =
      loc?.componentId !== undefined
        ? loc.componentId
        : loc?.elementName !== undefined
          ? resolveComponentId(loc.elementName, ctx.sourceMap)
          : undefined;
    return {
      code: err.code,
      message: err.message,
      ...(loc === undefined
        ? {}
        : {
            location: {
              ...(loc.elementName === undefined ? {} : { elementName: loc.elementName }),
              ...(loc.node === undefined ? {} : { node: loc.node }),
              ...(loc.line === undefined ? {} : { line: loc.line }),
              ...(loc.column === undefined ? {} : { column: loc.column }),
            },
          }),
      ...(componentId === undefined ? {} : { componentId }),
      ...(lineText === undefined ? {} : { lineText }),
      phase,
    };
  }
  return {
    code: "E_PROTOCOL_VERSION",
    message: err instanceof Error ? err.message : String(err),
    phase: phase === "load" ? "transport" : phase,
  };
}

/** Engine element name → UI component id via Circuit.sourceMap (§7.2). */
function resolveComponentId(
  elementName: string,
  map: Record<string, string> | undefined,
): string | undefined {
  if (map === undefined) {
    return undefined;
  }
  return map[elementName] ?? map[elementName.toLowerCase()];
}

/** Render an unknown error for the console log. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
