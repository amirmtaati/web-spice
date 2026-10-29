/**
 * Engine facade (SPEC §5): one-call entry points used by the CLI and tests.
 * The client/worker transports (E4) wrap the same functions behind the
 * message protocol; nothing here imports `bun:*` or `node:*`.
 */

import { type Circuit, EngineError } from "@spicekit/protocol";

import { type RunResult, runAnalysis } from "./analyses/index.ts";
import { type CompiledCircuit, compile } from "./compiler/index.ts";
import type { IncludeResolver } from "./parser/index.ts";
import { parseNetlist } from "./parser/index.ts";

export type { RunResult } from "./analyses/index.ts";
export type { CompiledCircuit } from "./compiler/index.ts";

export interface LoadOutcome {
  ok: boolean;
  nodeNames: string[];
  branchNames: string[];
  warnings: { code: string; message: string; elementName?: string }[];
  compiled?: CompiledCircuit;
  /** Present when ok === false. */
  error?: { code: string; message: string };
}

/** Validate + compile; returns node/branch tables and warnings. */
export function loadCircuit(circuit: Circuit): LoadOutcome {
  try {
    const compiled = compile(circuit);
    return {
      ok: true,
      nodeNames: compiled.nodeNames,
      branchNames: compiled.branchOwners,
      warnings: compiled.warnings,
      compiled,
    };
  } catch (error) {
    if (error instanceof EngineError) {
      return {
        ok: false,
        nodeNames: [],
        branchNames: [],
        warnings: [],
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

/**
 * Parse a netlist and run every analysis declared in it (defaulting to
 * `.op` when the netlist declares none). Returns one result per analysis.
 */
export function simulateNetlist(
  text: string,
  opts: { include?: IncludeResolver; analyses?: number } = {},
): { title: string; results: RunResult[] } {
  const circuit = parseNetlist(text, opts.include);
  return { title: circuit.title, results: simulateCircuit(circuit, opts.analyses) };
}

/** Run every analysis declared in the circuit (or a default OP). */
export function simulateCircuit(circuit: Circuit, limit?: number): RunResult[] {
  const compiled = compile(circuit);
  const requests = circuit.analyses.length > 0 ? circuit.analyses : [{ kind: "op" as const }];
  const selected = limit !== undefined ? requests.slice(0, limit) : requests;
  return selected.map((request) => runAnalysis(compiled, request));
}

/** Rethrow with the stable message format used by the CLI. */
export function describeError(error: unknown): string {
  if (error instanceof EngineError) {
    const loc = error.location;
    const where =
      loc?.elementName !== undefined
        ? ` (element ${loc.elementName})`
        : loc?.node !== undefined
          ? ` (node ${loc.node})`
          : loc?.line !== undefined
            ? ` (line ${loc.line}${loc.column !== undefined ? `, col ${loc.column}` : ""})`
            : "";
    return `${error.code}: ${error.message}${where}`;
  }
  return error instanceof Error ? error.message : String(error);
}
