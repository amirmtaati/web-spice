/**
 * MNA workspace (SPEC §5.3/§5.4): owns the dense matrix, RHS, solution, LU
 * factors, and the shared device state store. All buffers are preallocated
 * once; stamping and solving never allocate (SPEC §5.11). The workspace also
 * implements the `MatrixStamp` seam devices write into.
 */

import { EngineError } from "@spicekit/protocol";

import type { CompiledCircuit } from "../compiler/index.ts";
import type { Device, DeviceEnv, MatrixStamp } from "../devices/index.ts";
import { buildDevices } from "../devices/index.ts";
import { luFactor, luSolve } from "../solver/lu.ts";

export class Workspace implements MatrixStamp {
  readonly size: number;
  readonly a: Float64Array; // assembled matrix (pristine copy)
  readonly rhs: Float64Array;
  readonly x: Float64Array;
  readonly devices: Device[];
  readonly state: Float64Array;
  readonly nodeCount: number;
  readonly compiled: CompiledCircuit;
  /** Per-device MNA offsets (parallel to `devices`). */
  readonly deviceNodes: number[][];
  readonly deviceBranches: number[][];
  /**
   * Diagonal conductance added from every node to ground on the next stamp
   * (gmin stepping rung of the OP ladder, SPEC §5.5). 0 = nominal circuit.
   */
  nodeGmin = 0;

  private readonly work: Float64Array; // LU factors (destroyed copy of a)
  private readonly piv: Int32Array;
  private readonly scratch: Float64Array;
  private readonly env: DeviceEnv;
  private readonly envNodes: number[] = [];
  private readonly envBranches: number[] = [];
  private readonly stateBases: Map<string, number>;
  private readonly nodeNames: string[];
  private readonly branchOwners: string[];
  private factored = false;

  constructor(compiled: CompiledCircuit) {
    this.compiled = compiled;
    const n = compiled.nodeCount + compiled.branchCount;
    this.size = n;
    this.nodeCount = compiled.nodeCount;
    this.a = new Float64Array(n * n);
    this.work = new Float64Array(n * n);
    this.rhs = new Float64Array(n);
    this.x = new Float64Array(n);
    this.piv = new Int32Array(n);
    this.scratch = new Float64Array(n);
    this.devices = buildDevices(compiled);
    // Per-device offsets and state slots, in device order.
    this.deviceNodes = [];
    this.deviceBranches = [];
    this.stateBases = new Map<string, number>();
    let slots = 0;
    for (let i = 0; i < this.devices.length; i++) {
      const ce = compiled.elements[i];
      const d = this.devices[i] as Device;
      if (ce === undefined) {
        this.deviceNodes.push([]);
        this.deviceBranches.push([]);
        continue;
      }
      this.deviceNodes.push([...ce.nodes]);
      const branches = ce.branches ?? (ce.branch !== undefined ? [ce.branch] : []);
      this.deviceBranches.push(branches);
      this.stateBases.set(d.name.toLowerCase(), slots);
      slots += d.stateSlots;
    }
    this.state = new Float64Array(slots);
    this.env = {
      nodes: this.envNodes,
      branches: this.envBranches,
      x: this.x,
      state: this.state,
      stateBase: 0,
      stateBases: this.stateBases,
      time: 0,
    };
    this.nodeNames = compiled.nodeNames;
    this.branchOwners = compiled.branchOwners;
  }

  /** Device state base for a device (by name, case-insensitive). */
  stateBaseOf(deviceName: string): number {
    return this.stateBases.get(deviceName.toLowerCase()) ?? 0;
  }

  /** MNA index of a node by (case-insensitive) name; −1 when unknown. */
  nodeIndexOf(name: string): number {
    const lower = name.toLowerCase();
    for (let i = 0; i < this.compiled.nodeNames.length; i++) {
      if ((this.compiled.nodeNames[i] as string).toLowerCase() === lower) {
        return i;
      }
    }
    return -1;
  }

  /** Begin a fresh stamp: zero the matrix and RHS, add the diagonal gmin. */
  beginStamp(): void {
    this.a.fill(0);
    this.rhs.fill(0);
    if (this.nodeGmin > 0) {
      for (let i = 0; i < this.nodeCount; i++) {
        this.a[i * this.size + i] = this.nodeGmin;
      }
    }
    this.factored = false;
  }

  addA(row: number, col: number, value: number): void {
    const k = row * this.size + col;
    this.a[k] = (this.a[k] ?? 0) + value;
  }

  addRhs(row: number, value: number): void {
    this.rhs[row] = (this.rhs[row] ?? 0) + value;
  }

  /** Configure the per-device env for stamping device index `i`. */
  prepareEnv(i: number, time: number): void {
    const d = this.devices[i] as Device;
    this.envNodes.length = 0;
    for (const v of this.deviceNodes[i] as number[]) {
      this.envNodes.push(v);
    }
    this.envBranches.length = 0;
    for (const v of this.deviceBranches[i] as number[]) {
      this.envBranches.push(v);
    }
    this.env.stateBase = this.stateBaseOf(d.name);
    this.env.time = time;
  }

  /** The shared DeviceEnv (devices stamp through it). */
  envRef(): DeviceEnv {
    return this.env;
  }

  /** Factor the assembled matrix. Throws E_SINGULAR_MATRIX with a hint. */
  factor(): void {
    this.work.set(this.a);
    const bad = luFactor(this.work, this.size, this.piv);
    if (bad >= 0) {
      throw new EngineError({
        code: "E_SINGULAR_MATRIX",
        message: `Singular matrix at unknown ${describeUnknown(bad, this.nodeNames, this.branchOwners)}`,
        location: singularLocation(bad, this.nodeNames, this.branchOwners),
      });
    }
    this.factored = true;
  }

  /** Solve using current factors into x. */
  solve(): void {
    if (!this.factored) {
      throw new EngineError({ code: "E_SINGULAR_MATRIX", message: "solve() before factor()" });
    }
    this.x.set(this.rhs);
    luSolve(this.work, this.size, this.piv, this.x, this.scratch);
  }

  /** Solve without refactorization (matrix unchanged — DC sweeps). */
  solveOnly(): void {
    this.solve();
  }
}

function describeUnknown(k: number, nodeNames: string[], branchOwners: string[]): string {
  return k < nodeNames.length
    ? `node "${nodeNames[k]}"`
    : `branch current of ${branchOwners[k - nodeNames.length] ?? "?"}`;
}

function singularLocation(
  k: number,
  nodeNames: string[],
  branchOwners: string[],
): { node?: string; elementName?: string } {
  if (k < nodeNames.length) {
    const node = nodeNames[k];
    return node !== undefined ? { node } : {};
  }
  const owner = branchOwners[k - nodeNames.length];
  return owner !== undefined ? { elementName: owner } : {};
}
