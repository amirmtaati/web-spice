/**
 * Compiler (SPEC §5.2): flatten subcircuits (hierarchical names `X1.R3`),
 * resolve params, assign node indices, allocate branch unknowns, run
 * pre-flight checks (no ground, floating nodes, V/I-source loops, unknown
 * models) with typed, located errors, and emit device arrays + the sparsity
 * pattern. Lands with E1.
 */
import { EngineError } from "@spicekit/protocol";

export interface CompiledCircuit {
  /** Number of node unknowns (ground excluded). */
  nodeCount: number;
  /** Number of branch-current unknowns (V, L, E, H, K as needed). */
  branchCount: number;
}

export function compile(_ir: unknown): CompiledCircuit {
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "Netlist compiler lands with milestone E1 (SPEC §22).",
  });
}
