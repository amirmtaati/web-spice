/**
 * Operating point (SPEC §5.5): Newton-Raphson over the MNA stamps with
 * reltol/vntol/abstol convergence, junction limiting (device `limit` hooks,
 * SPICE2 node-poking semantics), and the E2 fallback ladder
 *
 *   direct Newton → gmin stepping → source stepping
 *
 * matching ngspice's CKTop ladder (cktop.c): the gmin rung adds a diagonal
 * conductance from every node to ground, starting at gmin·GMIN_FACTOR^N and
 * descending by GMIN_FACTOR per successful stage; the source rung scales all
 * independent sources from 0 up to full value. Each stage warm-starts from
 * the previous solution and a final plain Newton at nominal gmin validates
 * the converged point (the diagonal gmin is removed before reporting).
 */

import type { SimOptions } from "@spicekit/protocol";

import { EngineError } from "@spicekit/protocol";
import type { Device } from "../devices/index.ts";
import type { Workspace } from "./workspace.ts";

export interface OpOutcome {
  iterations: number;
  /** True when the Newton loop converged within itl1 iterations. */
  converged: boolean;
  /** Which ladder rung produced the operating point (SPEC §5.5 reporting). */
  method: "direct" | "gmin" | "source";
}

/** ngspice spice3_gmin: 10 decade steps from gmin·10^10 down to gmin. */
const GMIN_STEPS = 10;
const GMIN_FACTOR = 10;
/** ngspice spice3_src: 10 equal source increments 0 → 1. */
const SRC_STEPS = 10;

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
      d.stampDC(ws, ws.envRef());
    }
  }
  ws.factor();
  ws.solve();
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

/**
 * One Newton iteration: limit → stamp → solve. Returns false when a device
 * clamped a junction (the iterate cannot be trusted as converged).
 */
function limitThenStamp(ws: Workspace, time: number): boolean {
  let limited = false;
  for (let i = 0; i < ws.devices.length; i++) {
    const d = ws.devices[i] as Device;
    if (d.limit === undefined) {
      continue;
    }
    ws.prepareEnv(i, time);
    if (d.limit(ws.envRef())) {
      limited = true;
    }
  }
  stampAndSolve(ws, time, false, 0, "be");
  return limited;
}

/**
 * Newton loop from the current x as the initial guess: limit, stamp+solve,
 * repeat until successive iterates agree and nothing was limited. Returns
 * the iteration count and whether it converged within itl1.
 */
function solveNewton(
  ws: Workspace,
  options: SimOptions,
  time: number,
  xPrev: Float64Array,
): { iterations: number; converged: boolean } {
  xPrev.set(ws.x);
  let iterations = 0;
  for (let iter = 0; iter < options.itl1; iter++) {
    const limited = limitThenStamp(ws, time);
    iterations += 1;
    if (!limited && isConverged(xPrev, ws.x, ws.nodeCount, options)) {
      return { iterations, converged: true };
    }
    xPrev.set(ws.x);
  }
  return { iterations, converged: false };
}

interface SourceHandle {
  index: number;
  base: number;
}

/** Collect independent V/I sources with their nominal DC values. */
function collectSources(ws: Workspace): SourceHandle[] {
  const handles: SourceHandle[] = [];
  for (let i = 0; i < ws.devices.length; i++) {
    const d = ws.devices[i] as Device;
    if (d.setDc !== undefined && d.dcValue !== undefined) {
      handles.push({ index: i, base: d.dcValue() });
    }
  }
  return handles;
}

function setSourceScale(ws: Workspace, handles: SourceHandle[], scale: number): void {
  for (const h of handles) {
    const d = ws.devices[h.index] as Device;
    (d.setDc as (v: number) => void)(h.base * scale);
  }
}

/** True when the error is a recoverable matrix failure (not a bug). */
function isSingular(error: unknown): boolean {
  return error instanceof EngineError && error.code === "E_SINGULAR_MATRIX";
}

/**
 * One direct Newton attempt at the current workspace setting. Never throws
 * on non-convergence; singular matrices count as failure so the ladder's
 * gmin rung (which grounds floating nodes) gets its chance.
 */
function attemptDirect(
  ws: Workspace,
  options: SimOptions,
  time: number,
  xPrev: Float64Array,
): { ok: boolean; iterations: number } {
  try {
    const r = solveNewton(ws, options, time, xPrev);
    return { ok: r.converged, iterations: r.iterations };
  } catch (error) {
    if (isSingular(error)) {
      return { ok: false, iterations: 0 };
    }
    throw error;
  }
}

/** ngspice spice3_gmin: descending diagonal gmin, warm start, final check. */
function gminStepping(
  ws: Workspace,
  options: SimOptions,
  time: number,
  xPrev: Float64Array,
): boolean {
  let diag = options.gmin * GMIN_FACTOR ** GMIN_STEPS;
  for (let step = 0; step <= GMIN_STEPS; step++) {
    ws.nodeGmin = diag;
    ws.x.fill(0);
    let ok: boolean;
    try {
      ok = solveNewton(ws, options, time, xPrev).converged;
    } catch (error) {
      if (!isSingular(error)) {
        throw error;
      }
      ok = false;
    }
    if (!ok) {
      ws.nodeGmin = 0;
      return false;
    }
    diag /= GMIN_FACTOR;
  }
  // Final validation at nominal gmin with the diagonal shunt removed — the
  // reported operating point must satisfy the unmodified circuit.
  ws.nodeGmin = 0;
  ws.x.fill(0);
  return attemptDirect(ws, options, time, xPrev).ok;
}

/** ngspice spice3_src: scale independent sources 0 → 1, warm start each. */
function sourceStepping(
  ws: Workspace,
  options: SimOptions,
  time: number,
  xPrev: Float64Array,
): boolean {
  const handles = collectSources(ws);
  for (let step = 0; step <= SRC_STEPS; step++) {
    const scale = step / SRC_STEPS;
    setSourceScale(ws, handles, scale);
    ws.x.fill(0);
    let ok: boolean;
    try {
      ok = solveNewton(ws, options, time, xPrev).converged;
    } catch (error) {
      if (!isSingular(error)) {
        setSourceScale(ws, handles, 1);
        throw error;
      }
      ok = false;
    }
    if (!ok) {
      setSourceScale(ws, handles, 1);
      return false;
    }
  }
  return true;
}

/**
 * Run a DC operating point with the full fallback ladder; throws
 * E_NO_CONVERGENCE when every rung fails. Reports the winning rung.
 */
export function runOp(ws: Workspace, options: SimOptions, time = 0): OpOutcome {
  const xPrev = new Float64Array(ws.size);
  ws.nodeGmin = 0;
  ws.x.fill(0);
  const direct = attemptDirect(ws, options, time, xPrev);
  if (direct.ok) {
    return { iterations: direct.iterations, converged: true, method: "direct" };
  }
  // Rung 2: gmin stepping (floating nodes, metastable latches).
  if (gminStepping(ws, options, time, xPrev)) {
    return { iterations: 0, converged: true, method: "gmin" };
  }
  // Rung 3: source stepping (strong positive feedback).
  if (sourceStepping(ws, options, time, xPrev)) {
    return { iterations: 0, converged: true, method: "source" };
  }
  throw new EngineError({
    code: "E_NO_CONVERGENCE",
    message: `Operating point did not converge: direct Newton, gmin stepping (${GMIN_STEPS} steps) and source stepping (${SRC_STEPS} steps) all failed (itl1=${options.itl1})`,
  });
}

/**
 * Direct-only Newton for hot paths that already have a good warm start
 * (DC sweeps, transient steps). Throws E_NO_CONVERGENCE on failure.
 */
export function runOpWarm(ws: Workspace, options: SimOptions, time = 0): OpOutcome {
  const xPrev = new Float64Array(ws.size);
  const r = solveNewton(ws, options, time, xPrev);
  if (!r.converged) {
    throw new EngineError({
      code: "E_NO_CONVERGENCE",
      message: `Newton did not converge in ${r.iterations} iterations (itl1=${options.itl1})`,
    });
  }
  return { iterations: r.iterations, converged: true, method: "direct" };
}
