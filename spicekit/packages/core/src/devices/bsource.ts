/**
 * Behavioral B sources (SPEC §5.6/§5.7, E3): V or I sources driven by an
 * arbitrary expression of node voltages v(n), element currents i(elem),
 * parameters, and time. The expression compiles once into a dual-number
 * closure (forward-mode AD, SPEC §5.6) so every evaluation yields both the
 * value and ∂f/∂operand — exactly the Jacobian row a Newton pass needs.
 *
 * Newton linearization at iterate x0 (standard SPICE companion form):
 *
 *   V-kind:  v_p − v_n = f(x)  ≈  f0 + Σ gk·(xk − x0k)
 *            row br: (v_p − v_n) − Σ gk·xk = f0 − Σ gk·x0k
 *   I-kind:  i(p→n) = f(x)  ≈  f0 + Σ gk·(xk − x0k)
 *            rhs[p] −= f0 + Σ gk·(xk − x0k)   (and + into n)
 *
 * Operands map to MNA offsets at construction time (node names via the
 * compiled node table; i() via branchByName — the compiler already converted
 * branch indices to absolute offsets). Operand values are read from env.x;
 * the derivative w.r.t. a branch operand (i(vsrc)) lands in the branch row.
 *
 * AC small-signal: linearize at the operating point and stamp the real
 * coefficients gk into the complex matrix (anchor terms are DC-only). The
 * nonlinear behavior does not exist in AC — standard SPICE semantics.
 *
 * Transient: B is algebraic (no memory), so stampTran ≡ stampDC with the
 * waveform evaluated at env.time; `time` is a plain operand value (no d/dt
 * term exists in MNA stamps).
 */

import { EngineError } from "@spicekit/protocol";

import type { CompiledCircuit, CompiledElement } from "../compiler/index.ts";
import { constDual, type Dual, type DualEvalContext } from "../eval/dual.ts";
import { type CompiledDualExpression, compileExpressionDual } from "../eval/index.ts";
import type { AcStamp, Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { stampVoltageBranch, stampVoltageBranchAc } from "./base.ts";

interface OperandBinding {
  /** MNA offset of the operand unknown (node or branch). */
  offset: number;
  /** Gradient slot of the operand inside the dual's grads array. */
  slot: number;
}

export function bSourceDevice(ce: CompiledElement, compiled: CompiledCircuit): Device {
  if (ce.type !== "B" || ce.element.type !== "B") {
    throw new Error(`bSourceDevice: not a B element (${ce.type})`);
  }
  const el = ce.element;
  const exprSrc = typeof ce.expr === "string" ? ce.expr : "";
  let dual: CompiledDualExpression;
  try {
    dual = compileExpressionDual(exprSrc);
  } catch (error) {
    throw new EngineError({
      code: "E_PARSE",
      message: `B source ${ce.name}: ${(error as Error).message}`,
      location: { elementName: ce.name },
    });
  }

  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  const isVoltage = el.kind === "V";
  const br = isVoltage ? (ce.branch ?? -1) : -1;
  const nSlots = dual.nSlots;
  const params = compiled.params;
  const tempC = compiled.options.temp;

  // Bind every operand to its MNA offset (case-insensitive, resolved once —
  // netlist lookups must never run per iteration). v(0) is ground: always 0
  // with no matrix column, so it takes no binding (its slot is never stamped).
  const slotOffsets = new Map<number, number>();
  for (const op of dual.operands) {
    if (op.kind === "v" && op.name === "0") {
      continue;
    }
    const offset =
      op.kind === "v"
        ? nodeOffsetOf(compiled, op.name)
        : (compiled.branchByName.get(op.name.toLowerCase()) ?? -1);
    if (offset < 0) {
      throw new EngineError({
        code: "E_PARSE",
        message: `B source ${ce.name}: unknown operand ${op.kind}(${op.name})`,
        location: { elementName: ce.name },
      });
    }
    slotOffsets.set(op.slot, offset);
  }

  const offsetOfSlot = (slot: number): number => slotOffsets.get(slot) ?? -1;

  /** One evaluation: f(x) and ∂f/∂operand at the current iterate. */
  const evaluateAt = (env: DeviceEnv): { f0: number; grads: Float64Array } => {
    const ctx: DualEvalContext = {
      time: env.time,
      tempC,
      v: (name: string, slot: number) => {
        void name;
        return seeded(env.x, offsetOfSlot(slot), slot, nSlots);
      },
      i: (name: string, slot: number) => {
        void name;
        return seeded(env.x, offsetOfSlot(slot), slot, nSlots);
      },
      param: (name: string) => {
        const value = params[name];
        if (value === undefined) {
          throw new EngineError({
            code: "E_PARSE",
            message: `B source ${ce.name}: unknown parameter "${name}"`,
            location: { elementName: ce.name },
          });
        }
        return constDual(nSlots, value);
      },
    };
    const d = dual.fn(ctx);
    return { f0: d.value, grads: d.grads };
  };

  /** V-kind Newton companion: branch row carries the linearized equation. */
  const stampLinearizedV = (stamp: MatrixStamp, env: DeviceEnv): void => {
    const { f0, grads } = evaluateAt(env);
    let anchor = f0;
    stampVoltageBranch(stamp, br, p, n);
    for (const b of slotBindings(slotOffsets)) {
      const gk = grads[b.slot] as number;
      const x0k = (env.x[b.offset] as number) ?? 0;
      anchor -= gk * x0k;
      if (gk !== 0) {
        stamp.addA(br, b.offset, -gk);
      }
    }
    stamp.addRhs(br, anchor);
  };

  /** I-kind Newton companion: current injection with Jacobian columns. */
  const stampLinearizedI = (stamp: MatrixStamp, env: DeviceEnv): void => {
    const { f0, grads } = evaluateAt(env);
    let anchor = f0;
    for (const b of slotBindings(slotOffsets)) {
      const gk = grads[b.slot] as number;
      const x0k = (env.x[b.offset] as number) ?? 0;
      anchor -= gk * x0k;
      if (gk !== 0) {
        if (p >= 0) {
          stamp.addA(p, b.offset, -gk);
        }
        if (n >= 0) {
          stamp.addA(n, b.offset, gk);
        }
      }
    }
    if (p >= 0) {
      stamp.addRhs(p, -anchor);
    }
    if (n >= 0) {
      stamp.addRhs(n, anchor);
    }
  };

  return {
    name: ce.name,
    stateSlots: 0,
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      if (isVoltage) {
        stampLinearizedV(stamp, env);
      } else {
        stampLinearizedI(stamp, env);
      }
    },
    stampTran(stamp: MatrixStamp, env: DeviceEnv): void {
      // Algebraic source: identical linearization at the current time.
      if (isVoltage) {
        stampLinearizedV(stamp, env);
      } else {
        stampLinearizedI(stamp, env);
      }
    },
    stampAc(stamp: AcStamp, env: DeviceEnv, _omega: number): void {
      // Real linearization coefficients into the complex matrix; the DC
      // anchor contributes nothing to the small-signal solve.
      const { grads } = evaluateAt(env);
      if (isVoltage) {
        stampVoltageBranchAc(stamp, br, p, n);
        for (const b of slotBindings(slotOffsets)) {
          const gk = grads[b.slot] as number;
          if (gk !== 0) {
            stamp.addAc(br, b.offset, -gk, 0);
          }
        }
      } else {
        for (const b of slotBindings(slotOffsets)) {
          const gk = grads[b.slot] as number;
          if (gk !== 0) {
            if (p >= 0) {
              stamp.addAc(p, b.offset, -gk, 0);
            }
            if (n >= 0) {
              stamp.addAc(n, b.offset, gk, 0);
            }
          }
        }
      }
    },
  };
}

/** Stable binding list from the slot→offset map (slot order). */
function slotBindings(map: Map<number, number>): OperandBinding[] {
  const out: OperandBinding[] = [];
  for (const [slot, offset] of map) {
    out.push({ slot, offset });
  }
  return out;
}

/** Global node offset by name (case-insensitive); ground = −1. */
function nodeOffsetOf(compiled: CompiledCircuit, name: string): number {
  const lower = name.toLowerCase();
  if (lower === "0") {
    return -1;
  }
  const names = compiled.nodeNames;
  for (let i = 0; i < names.length; i++) {
    if ((names[i] as string).toLowerCase() === lower) {
      return i;
    }
  }
  return -1;
}

/** Seed one operand dual: value from the solution, gradient 1 in `slot`. */
function seeded(x: Float64Array, offset: number, slot: number, nSlots: number): Dual {
  const grads = new Float64Array(nSlots);
  if (slot >= 0 && slot < nSlots) {
    grads[slot] = 1;
  }
  const value = offset >= 0 ? (x[offset] as number) : 0;
  return { value, grads };
}
