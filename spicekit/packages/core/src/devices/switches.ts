/**
 * Voltage- and current-controlled switches (SPEC §5.7, ngspice swload/csw
 * semantics): the switch is a state machine — ON when the control exceeds
 * threshold + hysteresis, OFF below threshold − hysteresis, memory in
 * between. A state flip between Newton iterations reports non-convergence
 * through the `limit` seam so the analysis re-solves (exactly ngspice's
 * CKTnoncon mechanism). The stamped element is a plain two-terminal
 * conductance: 1/RON when on, 1/ROFF when off.
 *
 * Smooth transition (model parameter SMOOTH, this engine's realization of
 * the spec's "smooth-transition option"): when SMOOTH > 0 the conductance
 * interpolates log-linearly between 1/ROFF and 1/RON across the transition
 * band — a continuous, Newton-friendly stamp with no state flips. The band
 * is [VT−VH, VT+VH] when VH > 0, else [VT−SMOOTH/2, VT+SMOOTH/2].
 *
 * W (current-controlled) reads the controlling V source's branch current
 * (x[controlBranch], the current into the source's + terminal) and applies
 * the same state machine with IT/IH thresholds.
 */

import { EngineError } from "@spicekit/protocol";
import type { CompiledElement } from "../compiler/index.ts";
import type { AcStamp, Device, DeviceEnv, MatrixStamp } from "./base.ts";
import { nodePotential, stampConductance, stampConductanceAc } from "./base.ts";

// Slot 0: switch state (1 = on, 0 = off). Slot 1: initialized flag — the
// state store is zero-filled, so an explicit flag carries the card's ON/OFF
// initial state into the first Newton pass.
const SWITCH_STATE_SLOTS = 2;

interface SwitchModel {
  gon: number;
  goff: number;
  threshold: number;
  hysteresis: number;
  /** Smooth-transition band; 0 = hard switching. */
  smooth: number;
}

function switchModel(ce: CompiledElement): SwitchModel {
  const mp = ce.modelParams ?? {};
  const ron = mp.ron ?? 1;
  const roff = mp.roff ?? 1e12;
  if (ron <= 0 || roff <= 0) {
    throw new EngineError({
      code: "E_PARSE",
      message: `${ce.name}: switch RON/ROFF must be positive`,
      location: { elementName: ce.name },
    });
  }
  const threshold = ce.type === "S" ? (mp.vt ?? 0) : (mp.it ?? 0);
  const hysteresis = Math.abs(ce.type === "S" ? (mp.vh ?? 0) : (mp.ih ?? 0));
  return {
    gon: 1 / ron,
    goff: 1 / roff,
    threshold,
    hysteresis,
    smooth: mp.smooth ?? 0,
  };
}

/** Conductance at control value `c` (smooth interpolation or hard state). */
function conductanceAt(m: SwitchModel, c: number, on: boolean): number {
  if (m.smooth > 0) {
    const half = m.hysteresis > 0 ? m.hysteresis : m.smooth / 2;
    const lo = m.threshold - half;
    const hi = m.threshold + half;
    const u = hi > lo ? Math.min(Math.max((c - lo) / (hi - lo), 0), 1) : c >= m.threshold ? 1 : 0;
    // Log-linear blend keeps the OFF state truly high-impedance.
    const lnG = Math.log(m.goff) + u * (Math.log(m.gon) - Math.log(m.goff));
    return Math.exp(lnG);
  }
  return on ? m.gon : m.goff;
}

/** Hysteresis state machine (ngspice swload): returns [state, changed]. */
function nextState(m: SwitchModel, c: number, previous: boolean): [boolean, boolean] {
  if (m.smooth > 0) {
    return [previous, false]; // continuous mode: no state flips
  }
  if (c > m.threshold + m.hysteresis) {
    return [true, !previous];
  }
  if (c < m.threshold - m.hysteresis) {
    return [false, previous];
  }
  return [previous, false]; // inside the hysteresis band: hold
}

function buildSwitch(ce: CompiledElement): Device {
  const model = switchModel(ce);
  const p = ce.nodes[0] as number;
  const n = ce.nodes[1] as number;
  const isVoltageControlled = ce.type === "S";
  const controlBranch = ce.controlBranch ?? -1;
  const initialOn = ce.on ?? false;

  const controlValue = (env: DeviceEnv): number => {
    if (isVoltageControlled) {
      // S nodes: [n+, n-, nc+, nc-] — control across positions 2, 3.
      return nodePotential(env, 2) - nodePotential(env, 3);
    }
    return controlBranch >= 0 ? (env.x[controlBranch] as number) : 0;
  };

  return {
    name: ce.name,
    stateSlots: SWITCH_STATE_SLOTS,
    limit(env: DeviceEnv): boolean {
      const base = env.stateBase;
      const initialized = (env.state[base + 1] as number) > 0.5;
      if (!initialized) {
        // First Newton pass: the iterate is still all-zeros, so the control
        // value is meaningless — seed the card's ON/OFF state without
        // evaluating the machine and let the next pass take over.
        env.state[base] = initialOn ? 1 : 0;
        env.state[base + 1] = 1;
        return false;
      }
      const [next, changed] = nextState(
        model,
        controlValue(env),
        (env.state[base] as number) > 0.5,
      );
      env.state[base] = next ? 1 : 0;
      return changed;
    },
    stampDC(stamp: MatrixStamp, env: DeviceEnv): void {
      const c = controlValue(env);
      const initialized = (env.state[env.stateBase + 1] as number) > 0.5;
      const on = initialized ? (env.state[env.stateBase] as number) > 0.5 : initialOn;
      stampConductance(stamp, p, n, conductanceAt(model, c, on));
    },
    stampAc(stamp: AcStamp, env: DeviceEnv, _omega: number): void {
      // Small-signal: a plain conductance at the OP state (hard switches)
      // or the smooth-interpolation conductance at the OP control value.
      const c = controlValue(env);
      const initialized = (env.state[env.stateBase + 1] as number) > 0.5;
      const on = initialized ? (env.state[env.stateBase] as number) > 0.5 : initialOn;
      stampConductanceAc(stamp, p, n, conductanceAt(model, c, on), 0);
    },
  };
}

export { buildSwitch as switchDevice };
