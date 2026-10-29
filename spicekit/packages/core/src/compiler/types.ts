/**
 * Compiled-circuit data types (SPEC §5.2). Split from compiler/index.ts so
 * the pre-flight checks module can use them without a hub cycle.
 */

import type { Element, MeasureSpec, ProbeSpec, SimOptions } from "@spicekit/protocol";

export interface CompiledElement {
  element: Element;
  type: Element["type"];
  name: string;
  /** MNA offsets; ground is -1. For S: [n+, n-, nc+, nc-]. */
  nodes: number[];
  /** Resolved numeric payload (R/C/L value, K coupling, E/F/H gain, G gm). */
  value?: number;
  dc?: number;
  ic?: number;
  tc1?: number;
  tc2?: number;
  area?: number;
  /** MOSFET geometry (meters; SPICE default 100 µm each). */
  w?: number;
  l?: number;
  /** Own branch-current unknown (V/L/E/H), as an absolute MNA offset. */
  branch?: number;
  /**
   * Multiple MNA unknowns owned by one element (BJT internal b'/c'/e'
   * nodes when RB/RC/RE > 0), as absolute MNA offsets. These rows carry
   * KCL equations, not voltage branches (SPEC §5.7, ngspice-44 structure).
   */
  branches?: number[];
  /** F/H/W: branch offset of the controlling V source. */
  controlBranch?: number;
  controlName?: string;
  /** Model-backed devices: lowercased model card type (diode/npn/nmos/...). */
  modelType?: string;
  /** Model card parameters resolved to numbers (expressions evaluated). */
  modelParams?: Record<string, number>;
  /** S/W initial state from the ON/OFF card suffix. */
  on?: boolean;
  /** B source: "V" (voltage-defined) or "I" (current-defined). */
  kind?: "V" | "I";
  /** B source: the behavioral expression source text. */
  expr?: string;
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
  /** `.measure` cards (E3), evaluated after each analysis run. */
  measures?: MeasureSpec[];
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
