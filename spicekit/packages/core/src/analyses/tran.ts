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
import { runOp } from "./op.ts";
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
  if (req.uic === true) {
    initStatesFromIc(ws);
  } else {
    runOp(ws, options, 0);
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
    stepWith(ws, h0, h0, "be");
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

    // LTE gate only applies when the last two step sizes are locally
    // uniform — the equal-spacing Δ³ estimate is meaningless otherwise
    // (right after breakpoints or step-size changes).
    const lteGate = method === "trap" && Math.abs(h - hPrev) <= 0.2 * Math.max(h, hPrev);

    // Attempt the step; LTE control may reject and retry with h/2.
    let accepted = false;
    for (let attempt = 0; attempt < 32; attempt++) {
      stepWith(ws, t + h, h, method);
      if (lteGate && !lteAcceptable(ws, options, h)) {
        rejectedSteps += 1;
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

function stepWith(ws: Workspace, time: number, h: number, method: IntegrationMethod): void {
  ws.beginStamp();
  for (let i = 0; i < ws.devices.length; i++) {
    ws.prepareEnv(i, time);
    const d = ws.devices[i] as Device;
    if (d.stampTran !== undefined) {
      d.stampTran(ws, ws.envRef(), h, method);
    } else {
      d.stampDC(ws);
    }
  }
  ws.factor();
  ws.solve();
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
