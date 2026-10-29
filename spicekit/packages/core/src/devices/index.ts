/**
 * Uniform device interface (SPEC §5.3). Stamps write into preallocated
 * matrices owned by the stamp context — devices never allocate in hot loops.
 */

export type IntegrationMethod = "be" | "trap" | "gear2";

export interface StampContext {
  /** Add A[i][j] += v on the real MNA matrix (dense now; sparse in E4). */
  addMatrix(i: number, j: number, v: number): void;
  /** Add to the right-hand-side vector. */
  addRhs(i: number, v: number): void;
  /** Node indices (unknown vector offsets) of this device. */
  nodes: readonly number[];
  /** Branch-unknown offsets allocated to this device, if any. */
  branches: readonly number[];
  h: number; // timestep (transient)
  method: IntegrationMethod;
}

export interface StateContext {
  time: number;
  getState(index: number): number;
  setState(index: number, value: number): void;
}

export interface Device {
  /** DC + Newton-linearized stamp (linear devices: same stamp every pass). */
  stampDC(ctx: StampContext): void;
  /** Companion-model stamp for transient integration. */
  stampTran?(ctx: StampContext, h: number, method: IntegrationMethod): void;
  /** Complex AC stamp at angular frequency omega. */
  stampAC?(ctx: StampContext, omega: number): void;
  /** Junction limiting (pnjlim/fetlim); returns true if it modified vNew. */
  limit?(vNew: Float64Array, vOld: Float64Array): boolean;
  /** Commit charge/flux state after an accepted step. */
  acceptStep?(ctx: StateContext): void;
  /** Local truncation error estimate for adaptive stepping. */
  truncationError?(ctx: StateContext): number;
}

/** Device library v1 (SPEC §5.7). Implementations land E1–E3. */
export const DEVICE_LIBRARY_V1 = [
  "R",
  "C",
  "L",
  "K",
  "V",
  "I",
  "E",
  "G",
  "F",
  "H",
  "B",
  "D",
  "Q",
  "M",
  "J",
  "S",
  "W",
  "opamp",
] as const;

export type DeviceKind = (typeof DEVICE_LIBRARY_V1)[number];
