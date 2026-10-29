/**
 * @spicekit/testing — private test support (SPEC §3.2): circuit builders,
 * fixture loaders, tolerances, reference comparer. Grows with E1.
 */
import { type Circuit, DEFAULT_SIM_OPTIONS, type Element, type NodeId } from "@spicekit/protocol";

/** Fluent circuit builder: `circuit().v("V1","in","0",{"dc":5}).r("R1","in","out","1k")`. */
export class CircuitBuilder {
  private readonly els: Element[] = [];

  title(t: string): this {
    this.titleValue = t;
    return this;
  }

  private titleValue = "Untitled";

  element(e: Element): this {
    this.els.push(e);
    return this;
  }

  r(name: string, a: NodeId, b: NodeId, value: number | string): this {
    return this.element({ type: "R", name, n: [a, b], value });
  }

  c(name: string, a: NodeId, b: NodeId, value: number | string): this {
    return this.element({ type: "C", name, n: [a, b], value });
  }

  l(name: string, a: NodeId, b: NodeId, value: number | string): this {
    return this.element({ type: "L", name, n: [a, b], value });
  }

  v(name: string, plus: NodeId, minus: NodeId, opts: { dc?: number | string }): this {
    return this.element({
      type: "V",
      name,
      n: [plus, minus],
      ...(opts.dc !== undefined ? { dc: opts.dc } : {}),
    });
  }

  build(): Circuit {
    return {
      title: this.titleValue,
      elements: [...this.els],
      models: {},
      subcircuits: {},
      params: {},
      options: { ...DEFAULT_SIM_OPTIONS },
      analyses: [],
      probes: [],
    };
  }
}

export function circuit(): CircuitBuilder {
  return new CircuitBuilder();
}

/** Standard tolerances for analytical tests (SPEC §13.2). */
export const TOLERANCES = {
  /** OP/DC relative error bound vs exact values. */
  opRel: 1e-9,
  /** Transient RMS error bound as fraction of signal range (smooth circuits). */
  tranRmsFrac: 5e-3,
  /** Absolute floor so near-zero expectations do not flake. */
  absFloor: 1e-9,
} as const;
