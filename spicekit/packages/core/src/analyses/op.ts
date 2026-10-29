/**
 * Operating point (SPEC §5.5): Newton-Raphson over the MNA stamps with
 * reltol/vntol/abstol convergence. All E1 devices are linear, so the loop
 * converges in one extra pass; the structure (per-iteration stamp, factor,
 * solve, convergence check) is what E2's junction limiting and the
 * gmin/source-stepping fallback ladder plug into.
 */

import type { SimOptions } from "@spicekit/protocol";

import { EngineError } from "@spicekit/protocol";
import type { Device } from "../devices/index.ts";
import type { Workspace } from "./workspace.ts";

export interface OpOutcome {
  iterations: number;
  /** True when the Newton loop converged within itl1 iterations. */
  converged: boolean;
}

/**
 * Stamp all devices (DC or transient companion), factor, solve.
 * `time` is the step time for transient source evaluation.
 */
export function stampAndSolve(
  ws: Workspace,
  time: number,
  tran: boolean,
  h: number,
  method: "be" | "trap" | "gear2",
): void {
  ws.beginStamp();
  for (let i = 0; i < ws.devices.length; i++) {
    ws.prepareEnv(i, time);
    const d = ws.devices[i] as Device;
    if (tran && d.stampTran !== undefined) {
      d.stampTran(ws, ws.envRef(), h, method);
    } else {
      d.stampDC(ws);
    }
  }
  ws.factor();
  ws.solve();
}

/** Newton loop: stamp+solve repeatedly until converged (linear: 1 pass). */
function solveNewton(ws: Workspace, options: SimOptions, time: number): OpOutcome {
  const previous = new Float64Array(ws.size);
  let iterations = 0;
  for (let iter = 0; iter < options.itl1; iter++) {
    stampAndSolve(ws, time, false, 0, "be");
    iterations += 1;
    if (iter > 0 && isConverged(previous, ws.x, ws.nodeCount, options)) {
      return { iterations, converged: true };
    }
    previous.set(ws.x);
  }
  return { iterations, converged: isConverged(previous, ws.x, ws.nodeCount, options) };
}

/** SPICE convergence: per-unknown |Δ| ≤ reltol·max(|a|,|b|) + vntol/abstol. */
function isConverged(
  a: Float64Array,
  b: Float64Array,
  nodeCount: number,
  options: SimOptions,
): boolean {
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    const tol =
      options.reltol * Math.max(Math.abs(av), Math.abs(bv)) +
      (i < nodeCount ? options.vntol : options.abstol);
    if (Math.abs(av - bv) > tol) {
      return false;
    }
  }
  return true;
}

/** Run a DC operating point; throws E_NO_CONVERGENCE on failure. */
export function runOp(ws: Workspace, options: SimOptions, time = 0): OpOutcome {
  const outcome = solveNewton(ws, options, time);
  if (!outcome.converged) {
    throw new EngineError({
      code: "E_NO_CONVERGENCE",
      message: `Operating point did not converge in ${outcome.iterations} iterations (itl1=${options.itl1})`,
    });
  }
  return outcome;
}
