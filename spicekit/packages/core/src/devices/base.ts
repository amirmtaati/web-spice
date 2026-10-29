/**
 * Device contract + shared stamp helpers (SPEC §5.3). Devices import from
 * this module only — keeps the per-device files free of hub cycles with
 * devices/index.ts (the factory). MNA conventions:
 *
 *  - Unknowns: node voltages, then branch currents in allocation order.
 *  - A voltage-defined branch (V, L, E, H) stamps +1 into (node+, branch),
 *    −1 into (node−, branch) and symmetrically in the branch row; x[branch]
 *    is the current INTO the + terminal (so i(V1) matches ngspice's sign).
 *  - The device state array is one Float64Array owned by the analysis; each
 *    device owns `stateSlots` contiguous slots at `stateBase`.
 */

export type IntegrationMethod = "be" | "trap" | "gear2";

/** Matrix + RHS write access (shared, mutable, allocation-free). */
export interface MatrixStamp {
  addA(row: number, col: number, value: number): void;
  addRhs(row: number, value: number): void;
}

/** Per-device view over the shared simulation state. */
export interface DeviceEnv {
  /** MNA offsets of this device's nodes (ground = −1). Reused scratch. */
  nodes: number[];
  /** MNA offsets of this device's branch unknowns. Reused scratch. */
  branches: number[];
  /** Full solution vector (node voltages then branch currents). */
  readonly x: Float64Array;
  /** Shared state store; this device's slots start at `stateBase`. */
  readonly state: Float64Array;
  stateBase: number;
  /** Device name → stateBase (lets K read its partner inductors' state). */
  readonly stateBases: ReadonlyMap<string, number>;
  /** Time of the step currently being solved (seconds). */
  time: number;
}

/** Unit of the local truncation error estimate (current or voltage). */
export type LteUnit = "A" | "V";

export interface Device {
  readonly name: string;
  readonly stateSlots: number;
  /** DC / Newton-pass stamp. Linear devices stamp identically every pass. */
  stampDC(m: MatrixStamp, env?: DeviceEnv): void;
  /** Companion-model stamp for a transient step of size h. */
  stampTran?(m: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void;
  /**
   * Junction limiting between Newton iterations (SPEC §5.3). Called after a
   * solve with env.x holding the fresh iterate; the device compares each
   * junction voltage against the value it stamped with (its state) and may
   * clamp node potentials in env.x (SPICE2/3 semantics). Returns true when
   * anything was clamped — the analysis then distrusts convergence for this
   * iteration and keeps iterating.
   */
  limit?(env: DeviceEnv): boolean;
  /** Commit device state after an accepted step (reads fresh env.x). */
  accept?(env: DeviceEnv): void;
  /** Local truncation error estimate for the just-solved step. */
  lte?(env: DeviceEnv, h: number): number;
  readonly lteUnit?: LteUnit;
  /** Magnitude of the LTE signal (|i| for caps, |v| for inductors). */
  lteMagnitude?(env: DeviceEnv): number;
  /** Next source discontinuity strictly after time t (sources only). */
  nextBreakpoint?(t: number): number | undefined;
  /** DC value of an independent source (used by OP). */
  dcValue?(): number;
  /** Update the DC value (DC sweeps); sources only. */
  setDc?(value: number): void;
}

/** Voltage across a two-terminal device (v_plus − v_minus). */
export function branchVoltage(env: DeviceEnv, plusIdx: number, minusIdx: number): number {
  const p = env.nodes[plusIdx] as number;
  const n = env.nodes[minusIdx] as number;
  const vp = p === -1 ? 0 : (env.x[p] as number);
  const vn = n === -1 ? 0 : (env.x[n] as number);
  return vp - vn;
}

/** Node potential with ground = 0 (limiting write-backs, device outputs). */
export function nodePotential(env: DeviceEnv, nodeIdx: number): number {
  const k = env.nodes[nodeIdx] as number;
  return k === -1 ? 0 : (env.x[k] as number);
}

/**
 * Write a clamped junction voltage back into the solution vector (SPICE2
 * node-poking): move the potential of `plusIdx` so that v(plus) − v(minus)
 * equals `v`, leaving the minus node untouched. Grounded nodes are skipped.
 */
export function pokeJunctionVoltage(
  env: DeviceEnv,
  plusIdx: number,
  minusIdx: number,
  v: number,
): void {
  const p = env.nodes[plusIdx] as number;
  const n = env.nodes[minusIdx] as number;
  if (n === -1) {
    if (p >= 0) {
      env.x[p] = v;
    }
    return;
  }
  if (p === -1) {
    env.x[n] = -v;
    return;
  }
  env.x[p] = (env.x[n] as number) + v;
}

/** Add a symmetric 2×2 conductance block between two node offsets. */
export function stampConductance(m: MatrixStamp, p: number, n: number, g: number): void {
  if (p >= 0) {
    m.addA(p, p, g);
    if (n >= 0) {
      m.addA(p, n, -g);
    }
  }
  if (n >= 0) {
    m.addA(n, n, g);
    if (p >= 0) {
      m.addA(n, p, -g);
    }
  }
}

/** Shared branch-equation stamp: v_p − v_n appears in the branch row. */
export function stampVoltageBranch(stamp: MatrixStamp, br: number, p: number, n: number): void {
  if (p >= 0) {
    stamp.addA(p, br, 1);
    stamp.addA(br, p, 1);
  }
  if (n >= 0) {
    stamp.addA(n, br, -1);
    stamp.addA(br, n, -1);
  }
}
