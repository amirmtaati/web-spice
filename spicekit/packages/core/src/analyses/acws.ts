/**
 * Complex MNA workspace for AC small-signal analysis (E3, SPEC §5.5): owns
 * the interleaved complex matrix, RHS, solution, and LU factors. The DC
 * operating point stays in the real `Workspace.x` so devices can linearize
 * against their bias while stamping complex admittances. All buffers are
 * preallocated once per run; per-frequency stamping never allocates.
 */

import { EngineError } from "@spicekit/protocol";
import type { AcStamp, Device } from "../devices/index.ts";
import { luFactorC, luSolveC } from "../solver/complex.ts";
import type { Workspace } from "./workspace.ts";

export class AcWorkspace implements AcStamp {
  readonly size: number;
  readonly a: Float64Array; // interleaved re/im, n×n complex
  readonly rhs: Float64Array; // interleaved, n complex
  readonly xc: Float64Array; // interleaved solution, n complex
  readonly ws: Workspace; // real workspace holding the OP solution

  private readonly work: Float64Array;
  private readonly piv: Int32Array;
  private readonly scratch: Float64Array;
  private factored = false;

  constructor(ws: Workspace) {
    this.ws = ws;
    const n = ws.size;
    this.size = n;
    this.a = new Float64Array(2 * n * n);
    this.work = new Float64Array(2 * n * n);
    this.rhs = new Float64Array(2 * n);
    this.xc = new Float64Array(2 * n);
    this.piv = new Int32Array(n);
    this.scratch = new Float64Array(2 * n);
  }

  /** Begin a fresh complex stamp: zero the matrix and RHS. */
  beginStamp(): void {
    this.a.fill(0);
    this.rhs.fill(0);
    this.factored = false;
  }

  addAc(row: number, col: number, re: number, im: number): void {
    const k = 2 * (row * this.size + col);
    this.a[k] = (this.a[k] ?? 0) + re;
    this.a[k + 1] = (this.a[k + 1] ?? 0) + im;
  }

  addRhsAc(row: number, re: number, im: number): void {
    this.rhs[2 * row] = (this.rhs[2 * row] ?? 0) + re;
    this.rhs[2 * row + 1] = (this.rhs[2 * row + 1] ?? 0) + im;
  }

  /** Stamp every device's small-signal model at angular frequency ω. */
  stampAll(omega: number): void {
    const ws = this.ws;
    for (let i = 0; i < ws.devices.length; i++) {
      const d = ws.devices[i] as Device;
      if (d.stampAc === undefined) {
        continue;
      }
      ws.prepareEnv(i, 0);
      d.stampAc(this, ws.envRef(), omega);
    }
  }

  /** Factor the assembled matrix. Throws E_SINGULAR_MATRIX with a hint. */
  factor(): void {
    this.work.set(this.a);
    const bad = luFactorC(this.work, this.size, this.piv);
    if (bad >= 0) {
      const ws = this.ws;
      const nodeNames = ws.compiled.nodeNames;
      const branchOwners = ws.compiled.branchOwners;
      const what =
        bad < nodeNames.length
          ? `node "${nodeNames[bad]}"`
          : `branch current of ${branchOwners[bad - nodeNames.length] ?? "?"}`;
      throw new EngineError({
        code: "E_SINGULAR_MATRIX",
        message: `Singular AC matrix at frequency-dependent unknown ${what}`,
      });
    }
    this.factored = true;
  }

  /** Solve using current factors into xc. */
  solve(): void {
    if (!this.factored) {
      throw new EngineError({ code: "E_SINGULAR_MATRIX", message: "solve() before factor()" });
    }
    this.xc.set(this.rhs);
    luSolveC(this.work, this.size, this.piv, this.xc, this.scratch);
  }
}
