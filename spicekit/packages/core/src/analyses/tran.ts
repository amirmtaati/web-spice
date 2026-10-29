/**
 * Transient analysis (SPEC §5.5): backward Euler at startup and after
 * breakpoints (mitigates trapezoidal ringing), trapezoidal (default) or
 * Gear-2 elsewhere; adaptive timestep from local truncation error with
 * growth limits, tmax, and exact landing on output-grid times and source
 * breakpoints. Initial conditions: DC operating point by default; `uic`
 * uses element `.ic` values (caps: voltage, inductors: current).
 */

import { EngineError, type SimOptions } from "@spicekit/protocol";
import type { Device, IntegrationMethod } from "../devices/index.ts";
import { runOp, stampAndSolve } from "./op.ts";
import type { Workspace } from "./workspace.ts";

const MAX_SAMPLES = 10_000_000; // SPEC §16 resource limits
const EPS = 1e-12;

export interface TranRequestLike {
  tstep: number;
  tstop: number;
  tstart?: number;
  tmax?: number;
  uic?: boolean;
}

export interface TranOutcome {
  times: Float64Array;
  /** size × points; column k is the solution snapshot at times[k]. */
  snapshots: Float64Array;
  acceptedSteps: number;
  rejectedSteps: number;
  minStep: number;
  maxStep: number;
  /** Which OP ladder rung produced the initial operating point. */
  opMethod: string;
}

export function runTransient(
  ws: Workspace,
  options: SimOptions,
  req: TranRequestLike,
): TranOutcome {
  const tstart = req.tstart ?? 0;
  const tstop = req.tstop;
  const tstep = req.tstep;
  if (!(tstep > 0) || !(tstop > tstart)) {
    throw new EngineError({ code: "E_PARSE", message: ".tran needs tstep > 0 and tstop > tstart" });
  }
  const hmax = req.tmax ?? tstep;
  if (!(hmax > 0)) {
    throw new EngineError({ code: "E_PARSE", message: ".tran tmax must be > 0" });
  }
  const gridCount = Math.floor((tstop - tstart) / tstep + 1e-9) + 1;
  if (gridCount > MAX_SAMPLES) {
    throw new EngineError({
      code: "E_LIMIT_EXCEEDED",
      message: `Transient would record ${gridCount} samples (limit ${MAX_SAMPLES}); increase tstep`,
    });
  }
  const size = ws.size;
  const times = new Float64Array(gridCount);
  const snapshots = new Float64Array(size * gridCount);

  // --- Initialization -----------------------------------------------------
  let hLast = tstep;
  let opMethod = "direct";
  if (req.uic === true) {
    initStatesFromIc(ws);
  } else {
    opMethod = runOp(ws, options, 0).method;
    initStatesFromOp(ws);
  }
  const hmin = Math.max(1e-18, tstop * 1e-15);
  const growth = options.maxStepRatio ?? 2;

  // --- Stepping loop ------------------------------------------------------
  // For uic, capture the t=0 network solution consistent with the element
  // ICs: a single backward-Euler micro-step (h → 0) pins capacitor voltages
  // and inductor currents to their IC values via the companion models. The
  // state is NOT committed — real integration starts from the IC states.
  if (req.uic === true) {
    const h0 = 1e-15;
    newtonStep(ws, h0, h0, "be", options);
  }
  let t = 0;
  let gridIndex = tstart > 0 ? 0 : record(ws, snapshots, times, 0, 0, size, tstart);
  let acceptedSteps = 0;
  let rejectedSteps = 0;
  let minStep = Number.POSITIVE_INFINITY;
  let maxStep = 0;
  let beStepsLeft = 2; // BE for the first steps out of the operating point
  let hPrev = tstep; // previous accepted step (LTE uniformity gate)

  while (t < tstop - EPS * Math.max(1, tstop)) {
    // Output-grid time the next accepted step must land on (or pass).
    const nextGrid = Math.min(tstart + gridIndex * tstep, tstop);
    let h = Math.min(hLast * growth, hmax);
    if (nextGrid - t < h) {
      h = nextGrid - t; // land exactly on the grid point
    }
    // Breakpoint handling: land exactly on the nearest source discontinuity.
    const bp = nextBreakpoint(ws, t);
    let landedBp: number | undefined;
    if (bp !== undefined && bp > t && bp - t <= h + EPS * Math.max(1, h)) {
      h = bp - t;
      landedBp = bp;
    }
    if (h < hmin) {
      throw new EngineError({
        code: "E_TIMESTEP_TOO_SMALL",
        message: `Timestep underflow at t=${t} (h=${h} < hmin=${hmin}); circuit too stiff or event spacing too tight`,
      });
    }
    const method: IntegrationMethod = beStepsLeft > 0 ? "be" : options.method;

    // Attempt the step; LTE control may reject and retry with h/2, and a
    // Newton convergence failure halves h the same way (standard SPICE
    // mitigation for stiff switching events). The LTE uniformity gate is
    // re-evaluated per attempt: once h shrinks away from hPrev the equal-
    // spacing Δ³ estimate is invalid (it degenerates to the history's own
    // third difference and never vanishes), so the gate must open. An LTE
    // rejection is the signature of a waveform kink — retries fall back to
    // backward Euler (damped trapezoidal, SPEC §5.5), which is L-stable and
    // cannot ring at switching events.
    let accepted = false;
    let attemptMethod = method;
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        newtonStep(ws, t + h, h, attemptMethod, options);
      } catch (error) {
        if (error instanceof EngineError && error.code === "E_NO_CONVERGENCE") {
          h /= 2;
          if (h < hmin) {
            throw new EngineError({
              code: "E_TIMESTEP_TOO_SMALL",
              message: `Newton convergence collapsed the timestep at t=${t}`,
            });
          }
          continue;
        }
        throw error;
      }
      const lteUniform =
        attemptMethod === "trap" && Math.abs(h - hPrev) <= 0.2 * Math.max(h, hPrev);
      if (lteUniform && !lteAcceptable(ws, options, h)) {
        rejectedSteps += 1;
        attemptMethod = "be"; // kink detected: damp the ringing
        h /= 2;
        if (h < hmin) {
          throw new EngineError({
            code: "E_TIMESTEP_TOO_SMALL",
            message: `LTE control collapsed the timestep at t=${t}`,
          });
        }
        continue;
      }
      accepted = true;
      break;
    }
    if (!accepted) {
      throw new EngineError({
        code: "E_NO_CONVERGENCE",
        message: `Transient step rejected repeatedly at t=${t}`,
      });
    }

    // Commit: advance state and time. Breakpoints land on bp exactly;
    // otherwise grid landings snap to the exact grid time.
    commitStates(ws);
    acceptedSteps += 1;
    minStep = Math.min(minStep, h);
    maxStep = Math.max(maxStep, h);
    const landedGrid = landedBp === undefined && gridLands(nextGrid, t + h, tstep);
    t = landedBp !== undefined ? landedBp : landedGrid ? nextGrid : t + h;
    hPrev = h;
    hLast = h;
    beStepsLeft = landedBp !== undefined ? 2 : Math.max(0, beStepsLeft - 1);

    // Record any grid points reached.
    while (gridIndex < gridCount && t >= tstart + gridIndex * tstep - EPS * Math.max(1, tstop)) {
      const gt = tstart + gridIndex * tstep;
      gridIndex = record(ws, snapshots, times, gridIndex, gt, size, tstart);
    }
  }

  return {
    times,
    snapshots,
    acceptedSteps,
    rejectedSteps,
    minStep: Number.isFinite(minStep) ? minStep : 0,
    maxStep,
    opMethod,
  };
}

function gridLands(nextGrid: number, candidate: number, tstep: number): boolean {
  return Math.abs(candidate - nextGrid) <= EPS * tstep;
}

function record(
  ws: Workspace,
  snapshots: Float64Array,
  times: Float64Array,
  gridIndex: number,
  gt: number,
  size: number,
  tstart: number,
): number {
  times[gridIndex] = Math.max(gt, tstart);
  snapshots.set(ws.x, gridIndex * size);
  return gridIndex + 1;
}

/**
 * One transient step = a full Newton loop (nonlinear devices iterate):
 * stamp companion + nonlinear models, solve, limit, repeat until successive
 * iterates agree within reltol/vntol/abstol and nothing was limited.
 * Iteration cap is itl4 (SPICE transient iteration limit, default 10).
 */
function newtonStep(
  ws: Workspace,
  time: number,
  h: number,
  method: IntegrationMethod,
  options: SimOptions,
): void {
  const xPrev = new Float64Array(ws.size);
  xPrev.set(ws.x);
  for (let iter = 0; iter < options.itl4; iter++) {
    stampAndSolve(ws, time, true, h, method);
    // Junction limiting between transient iterations (same as OP).
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
    let converged = !limited;
    if (converged) {
      for (let i = 0; i < xPrev.length; i++) {
        const av = xPrev[i] as number;
        const bv = ws.x[i] as number;
        const tol =
          options.reltol * Math.max(Math.abs(av), Math.abs(bv)) +
          (i < ws.nodeCount ? options.vntol : options.abstol);
        if (Math.abs(av - bv) > tol) {
          converged = false;
          break;
        }
      }
    }
    if (converged) {
      return;
    }
    xPrev.set(ws.x);
  }
  throw new EngineError({
    code: "E_NO_CONVERGENCE",
    message: `Transient Newton did not converge in ${options.itl4} iterations at t=${time}`,
  });
}

function commitStates(ws: Workspace): void {
  for (let i = 0; i < ws.devices.length; i++) {
    const d = ws.devices[i] as Device;
    if (d.accept !== undefined) {
      ws.prepareEnv(i, 0);
      d.accept(ws.envRef());
    }
  }
}

function nextBreakpoint(ws: Workspace, t: number): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < ws.devices.length; i++) {
    const d = ws.devices[i] as Device;
    if (d.nextBreakpoint === undefined) {
      continue;
    }
    ws.prepareEnv(i, t);
    const bp = d.nextBreakpoint(t);
    if (bp !== undefined && (best === undefined || bp < best)) {
      best = bp;
    }
  }
  return best;
}

/** LTE gate: reject the step when the estimate exceeds trtol-relaxed tolerances. */
function lteAcceptable(ws: Workspace, options: SimOptions, h: number): boolean {
  for (let i = 0; i < ws.devices.length; i++) {
    const d = ws.devices[i] as Device;
    if (d.lte === undefined) {
      continue;
    }
    ws.prepareEnv(i, 0);
    const estimate = d.lte(ws.envRef(), h);
    if (estimate === 0) {
      continue;
    }
    const unit = d.lteUnit ?? "A";
    // Signal magnitude comes from the device (its own current/voltage state);
    // the reltol share scales with it, abstol/vntol is the absolute floor.
    const magnitude = d.lteMagnitude !== undefined ? d.lteMagnitude(ws.envRef()) : 0;
    const tol = options.reltol * magnitude + (unit === "A" ? options.abstol : options.vntol);
    if (estimate > options.trtol * tol) {
      return false;
    }
  }
  return true;
}

/** uic: capacitor voltage / inductor current from element .ic (default 0). */
function initStatesFromIc(ws: Workspace): void {
  // Start node voltages from circuit.ic where provided.
  const ic = ws.compiled.ic;
  if (ic !== undefined) {
    for (const [name, value] of Object.entries(ic)) {
      const idx = ws.nodeIndexOf(name);
      if (idx >= 0) {
        ws.x[idx] = value;
      }
    }
  }
  for (let i = 0; i < ws.devices.length; i++) {
    const ce = ws.compiled.elements[i];
    if (ce === undefined) {
      continue;
    }
    ws.prepareEnv(i, 0);
    const env = ws.envRef();
    const base = env.stateBase;
    if (ce.type === "C") {
      env.state[base] = ce.ic ?? 0; // V0
      env.state[base + 3] = 0; // IP
    } else if (ce.type === "L") {
      env.state[base] = ce.ic ?? 0; // I0
      env.state[base + 3] = 0; // V0
    }
  }
}

/** Post-OP state: caps hold their DC voltage (i=0), inductors their DC current (v=0). */
function initStatesFromOp(ws: Workspace): void {
  for (let i = 0; i < ws.devices.length; i++) {
    const ce = ws.compiled.elements[i];
    if (ce === undefined || (ce.type !== "C" && ce.type !== "L")) {
      continue;
    }
    ws.prepareEnv(i, 0);
    const env = ws.envRef();
    const base = env.stateBase;
    const p = env.nodes[0] ?? -1;
    const n = env.nodes[1] ?? -1;
    const vp = p >= 0 ? (env.x[p] as number) : 0;
    const vn = n >= 0 ? (env.x[n] as number) : 0;
    if (ce.type === "C") {
      env.state[base] = vp - vn;
      env.state[base + 3] = 0;
    } else {
      const br = env.branches[0] ?? -1;
      env.state[base] = br >= 0 ? (env.x[br] as number) : 0;
      env.state[base + 3] = 0;
    }
  }
}
