/**
 * Compiled-circuit data types (SPEC §5.2). Split from compiler/index.ts so
 * the pre-flight checks module can use them without a hub cycle.
 */

import type { Element, ProbeSpec, SimOptions } from "@spicekit/protocol";

export interface CompiledElement {
  element: Element;
  type: Element["type"];
  name: string;
  /** MNA offsets; ground is -1. */
  nodes: number[];
  /** Resolved numeric payload (R/C/L value, K coupling, E/F/H gain, G gm). */
  value?: number;
  dc?: number;
  ic?: number;
  tc1?: number;
  tc2?: number;
  area?: number;
  /** Own branch-current unknown (V/L/E/H), as an absolute MNA offset. */
  branch?: number;
  /** F/H: branch offset of the controlling V source. */
  controlBranch?: number;
  controlName?: string;
}

export interface CompileWarning {
  code: string;
  message: string;
  elementName?: string;
}

export interface CompiledCircuit {
  /** Display name of node index i (original casing of first sighting). */
  nodeNames: string[];
  /** Probe filter from .probe cards (SPEC §5.1). */
  probes: ProbeSpec[];
  /** Node initial conditions from .ic (SPEC §5.5). */
  ic?: Record<string, number>;
  nodeCount: number;
  branchCount: number;
  /** Branch index → owning element name (for i(V1)-style outputs). */
  branchOwners: string[];
  elements: CompiledElement[];
  /** Numeric branch offset per element name (lowercased), V/L/E/H only. */
  branchByName: Map<string, number>;
  options: SimOptions;
  params: Record<string, number>;
  warnings: CompileWarning[];
}
