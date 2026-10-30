/**
 * Transient analysis (SPEC §5.5): backward Euler at startup and after
 * breakpoints (mitigates trapezoidal ringing), trapezoidal (default) or
 * Gear-2 elsewhere; adaptive timestep from local truncation error with
 * growth limits, tmax, and exact landing on output-grid times and source
 * breakpoints. Initial conditions: DC operating point by default; `uic`
 * uses element `.ic` values (caps: voltage, inductors: current).
 *
 * The stepping loop lives in `TranStepper` (E4): a resumable driver shared
 * by the batch `runTransient` and the live/session layer (SPEC §4.4), so
 * both paths run one tested integrator. Batch behavior is bit-identical to
 * the pre-E4 monolithic loop (the full tran suite guards this).
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

/**
 * Resumable transient driver (E4, SPEC §4.4/§5.5). Construct, `start()`
 * once, then `advance(until)` repeatedly. Output samples live on the grid
 * `tstart + k·tstep`; `advance` reports each through `onRecord` (the `x`
 * view must be consumed synchronously — the next step overwrites it).
 * `tstop` may be `Infinity` for live runs: every `advance(until)` is
 * bounded by `until`, so memory stays with the caller's record callback.
 */
export class TranStepper {
  time = 0;
  acceptedSteps = 0;
  rejectedSteps = 0;
  minStep = Number.POSITIVE_INFINITY;
  maxStep = 0;
  opMethod = "direct";

  private readonly ws: Workspace;
  private readonly options: SimOptions;
  private readonly tstart: number;
  private readonly tstop: number;
  private readonly tstep: number;
  private readonly hmax: number;
  private readonly hmin: number;
  private readonly growth: number;
  private readonly uic: boolean;
  /** Grid index of the next output sample (tstart + k·tstep). */
  private gridIndex = 0;
  private hLast: number;
  private hPrev: number;
  private beStepsLeft = 2; // BE for the first steps out of the operating point
  /** Breakpoints injected by the live layer (setParam restarts). */
  private readonly extraBreakpoints: number[] = [];
  private started = false;

  constructor(ws: Workspace, options: SimOptions, req: TranRequestLike) {
    this.ws = ws;
    this.options = options;
    const tstart = req.tstart ?? 0;
    const tstop = req.tstop;
    const tstep = req.tstep;
    if (!(tstep > 0) || !(tstop > tstart)) {
      throw new EngineError({
        code: "E_PARSE",
        message: ".tran needs tstep > 0 and tstop > tstart",
      });
    }
    const hmax = req.tmax ?? tstep;
    if (!(hmax > 0)) {
      throw new EngineError({ code: "E_PARSE", message: ".tran tmax must be > 0" });
    }
    this.tstart = tstart;
    this.tstop = tstop;
    this.tstep = tstep;
    this.hmax = hmax;
    // Live runs (tstop = Infinity) anchor hmin at the 1-second scale.
    this.hmin = Math.max(1e-18, (Number.isFinite(tstop) ? tstop : 1) * 1e-15);
    this.growth = options.maxStepRatio ?? 2;
    this.uic = req.uic === true;
    this.hLast = tstep;
    this.hPrev = tstep;
  }

  /** Output samples for a finite horizon (batch mode); live runs are unbounded. */
  get gridCount(): number {
    return Math.floor((this.tstop - this.tstart) / this.tstep + 1e-9) + 1;
  }

  /** Initialization (OP or uic + BE micro-step). Idempotent. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const ws = this.ws;
    if (this.uic) {
      initStatesFromIc(ws);
    } else {
      this.opMethod = runOp(ws, this.options, 0).method;
      initStatesFromOp(ws);
    }
    // For uic, capture the t=0 network solution consistent with the element
    // ICs: a single backward-Euler micro-step (h → 0) pins capacitor voltages
    // and inductor currents to their IC values via the companion models. The
    // state is NOT committed — real integration starts from the IC states.
    if (this.uic) {
      const h0 = 1e-15;
      newtonStep(ws, h0, h0, "be", this.options);
    }
    this.time = 0;
  }

  /**
   * Advance until `time >= until` (further bounded by `tstop`). Calls
   * `onRecord(gridTime, x)` for every output-grid point reached.
   */
  advance(until: number, onRecord?: (gridTime: number, x: Float64Array) => void): void {
    this.start();
    const ws = this.ws;
    const endCap = Math.min(this.tstop, until);
    const eps = EPS * Math.max(1, endCap);

    // Initial sample at t = 0 (recorded before the first step, like the
    // original batch loop — only when the output grid starts at t=0).
    if (this.gridIndex === 0 && this.tstart <= 0 && this.time === 0) {
      onRecord?.(Math.max(0, this.tstart), ws.x);
      this.gridIndex += 1;
    }

    while (this.time < endCap - eps) {
      // Output-grid time the next accepted step must land on (or pass).
      const nextGrid = Math.min(this.tstart + this.gridIndex * this.tstep, endCap);
      let h = Math.min(this.hLast * this.growth, this.hmax);
      if (nextGrid - this.time < h) {
        h = nextGrid - this.time; // land exactly on the grid point
      }
      // Breakpoint handling: land exactly on the nearest source discontinuity.
      const bp = this.nextBreakpoint(this.time);
      let landedBp: number | undefined;
      if (bp !== undefined && bp > this.time && bp - this.time <= h + EPS * Math.max(1, h)) {
        h = bp - this.time;
        landedBp = bp;
      }
      if (h < this.hmin) {
        throw new EngineError({
          code: "E_TIMESTEP_TOO_SMALL",
          message: `Timestep underflow at t=${this.time} (h=${h} < hmin=${this.hmin}); circuit too stiff or event spacing too tight`,
        });
      }
      const method: IntegrationMethod = this.beStepsLeft > 0 ? "be" : this.options.method;

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
          newtonStep(ws, this.time + h, h, attemptMethod, this.options);
        } catch (error) {
          if (error instanceof EngineError && error.code === "E_NO_CONVERGENCE") {
            h /= 2;
            if (h < this.hmin) {
              throw new EngineError({
                code: "E_TIMESTEP_TOO_SMALL",
                message: `Newton convergence collapsed the timestep at t=${this.time}`,
              });
            }
            continue;
          }
          throw error;
        }
        const lteUniform =
          attemptMethod === "trap" && Math.abs(h - this.hPrev) <= 0.2 * Math.max(h, this.hPrev);
        if (lteUniform && !lteAcceptable(ws, this.options, h)) {
          this.rejectedSteps += 1;
          attemptMethod = "be"; // kink detected: damp the ringing
          h /= 2;
          if (h < this.hmin) {
            throw new EngineError({
              code: "E_TIMESTEP_TOO_SMALL",
              message: `LTE control collapsed the timestep at t=${this.time}`,
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
          message: `Transient step rejected repeatedly at t=${this.time}`,
        });
      }

      // Commit: advance state and time. Breakpoints land on bp exactly;
      // otherwise grid landings snap to the exact grid time.
      commitStates(ws);
      this.acceptedSteps += 1;
      this.minStep = Math.min(this.minStep, h);
      this.maxStep = Math.max(this.maxStep, h);
      const landedGrid = landedBp === undefined && gridLands(nextGrid, this.time + h, this.tstep);
      this.time = landedBp !== undefined ? landedBp : landedGrid ? nextGrid : this.time + h;
      this.hPrev = h;
      this.hLast = h;
      this.beStepsLeft = landedBp !== undefined ? 2 : Math.max(0, this.beStepsLeft - 1);

      // Record any grid points reached (a breakpoint jump can pass several).
      while (this.time >= this.tstart + this.gridIndex * this.tstep - eps) {
        const gt = this.tstart + this.gridIndex * this.tstep;
        if (gt > endCap + eps) {
          break;
        }
        onRecord?.(Math.max(gt, this.tstart), ws.x);
        this.gridIndex += 1;
      }
    }
  }

  /** Inject a breakpoint (live setParam restart, SPEC §4.4). */
  insertBreakpoint(t: number): void {
    this.extraBreakpoints.push(t);
  }

  /** Reset the integrator order (BE for the next two steps, SPEC §4.4). */
  resetOrder(): void {
    this.beStepsLeft = 2;
  }

  private nextBreakpoint(t: number): number | undefined {
    let best: number | undefined;
    for (const tb of this.extraBreakpoints) {
      if (tb > t && (best === undefined || tb < best)) {
        best = tb;
      }
    }
    const ws = this.ws;
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
}

/** Batch transient (SPEC §5.5): allocate the output grid, drive one stepper. */
export function runTransient(
  ws: Workspace,
  options: SimOptions,
  req: TranRequestLike,
): TranOutcome {
  const gridCount = Math.floor((req.tstop - (req.tstart ?? 0)) / req.tstep + 1e-9) + 1;
  if (gridCount > MAX_SAMPLES) {
    throw new EngineError({
      code: "E_LIMIT_EXCEEDED",
      message: `Transient would record ${gridCount} samples (limit ${MAX_SAMPLES}); increase tstep`,
    });
  }
  const size = ws.size;
  const times = new Float64Array(gridCount);
  const snapshots = new Float64Array(size * gridCount);
  let k = 0;
  const stepper = new TranStepper(ws, options, req);
  stepper.advance(req.tstop, (gt, x) => {
    if (k < gridCount) {
      times[k] = gt;
      snapshots.set(x, k * size);
      k += 1;
    }
  });
  return {
    times,
    snapshots,
    acceptedSteps: stepper.acceptedSteps,
    rejectedSteps: stepper.rejectedSteps,
    minStep: Number.isFinite(stepper.minStep) ? stepper.minStep : 0,
    maxStep: stepper.maxStep,
    opMethod: stepper.opMethod,
  };
}

function gridLands(nextGrid: number, candidate: number, tstep: number): boolean {
  return Math.abs(candidate - nextGrid) <= EPS * tstep;
}

/**
 * One transient step = a full Newton loop (nonlinear devices iterate):
 * limit, stamp companion + nonlinear models, solve, repeat until successive
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
    // Limit BEFORE the stamp (ngspice semantics): clamp junction states,
    // then evaluate the nonlinearities at the clamped values.
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
    stampAndSolve(ws, time, true, h, method);
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
