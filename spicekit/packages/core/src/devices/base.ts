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

/**
 * Complex matrix + RHS write access for AC small-signal stamping (E3).
 * Values are (real, imaginary) pairs; the underlying storage is interleaved
 * so entries stay cache-local (see solver/complex.ts).
 */
export interface AcStamp {
  addAc(row: number, col: number, re: number, im: number): void;
  addRhsAc(row: number, re: number, im: number): void;
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
  /** Global node-name → MNA offset (case-insensitive; ground = −1). */
  nodeOffset(name: string): number;
  /** Voltage-branch offset of an element by name, or −1 (B sources). */
  branchOffset(name: string): number;
}

/** Unit of the local truncation error estimate (current or voltage). */
export type LteUnit = "A" | "V";

/**
 * One device's small-signal AC model (SPEC §5.5: "AC: linearize at OP,
 * complex solve per frequency"). `env.x` holds the DC operating point while
 * the complex solution lives in the AC workspace, so devices may read their
 * bias freely. `omega` is 2πf; ω = 0 means the DC limit (C open, L short).
 */
export type AcStampFn = (m: AcStamp, env: DeviceEnv, omega: number) => void;

/**
 * One small-signal noise source of a device (E3 noise analysis): a current
 * source of power spectral density `psd` (A²/Hz) between MNA offsets
 * (p, n) — ground = −1. The analysis computes each source's transfer to the
 * output through the adjoint system.
 */
export interface NoiseSource {
  p: number;
  n: number;
  psd: number;
}

export interface Device {
  readonly name: string;
  readonly stateSlots: number;
  /** DC / Newton-pass stamp. Linear devices stamp identically every pass. */
  stampDC(m: MatrixStamp, env?: DeviceEnv): void;
  /** Companion-model stamp for a transient step of size h. */
  stampTran?(m: MatrixStamp, env: DeviceEnv, h: number, method: IntegrationMethod): void;
  /** Small-signal AC stamp at angular frequency ω (E3). */
  stampAc?: AcStampFn;
  /** Noise sources at the operating point (E3; per frequency for 1/f). */
  noise?(env: DeviceEnv, freqHz: number): NoiseSource[];
  /**
   * Junction limiting before the stamp (SPEC §5.3, ngspice semantics): read
   * the junction voltages from the current iterate (env.x), clamp them
   * against the previous stamp with pnjlim/fetlim, store the clamped values
   * in device state, and return true when anything was clamped — the
   * analysis then distrusts convergence for this iteration. The subsequent
   * stamp evaluates the nonlinearities AT the stored (limited) values.
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

/** Node potential with ground = 0 (limiting reconstruction, outputs). */
export function nodePotential(env: DeviceEnv, nodeIdx: number): number {
  const k = env.nodes[nodeIdx] as number;
  return k === -1 ? 0 : (env.x[k] as number);
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

/** Complex form of `stampVoltageBranch` (all entries real +1/−1). */
export function stampVoltageBranchAc(stamp: AcStamp, br: number, p: number, n: number): void {
  if (p >= 0) {
    stamp.addAc(p, br, 1, 0);
    stamp.addAc(br, p, 1, 0);
  }
  if (n >= 0) {
    stamp.addAc(n, br, -1, 0);
    stamp.addAc(br, n, -1, 0);
  }
}

/** Add a symmetric 2×2 complex conductance block between two node offsets. */
export function stampConductanceAc(
  stamp: AcStamp,
  p: number,
  n: number,
  gre: number,
  gim: number,
): void {
  if (p >= 0) {
    stamp.addAc(p, p, gre, gim);
    if (n >= 0) {
      stamp.addAc(p, n, -gre, -gim);
    }
  }
  if (n >= 0) {
    stamp.addAc(n, n, gre, gim);
    if (p >= 0) {
      stamp.addAc(n, p, -gre, -gim);
    }
  }
}

/** Add a jωC capacitor block between two node offsets (no-op when C ≤ 0). */
export function stampCapacitanceAc(
  stamp: AcStamp,
  p: number,
  n: number,
  c: number,
  omega: number,
): void {
  if (c <= 0 || omega === 0) {
    return;
  }
  stampConductanceAc(stamp, p, n, 0, omega * c);
}
