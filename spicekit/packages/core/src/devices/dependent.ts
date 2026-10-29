/**
 * Linear dependent sources (SPEC §5.7): E (VCVS), G (VCCS), F (CCCS),
 * H (CCVS). Branch unknowns follow the compiler allocation (E and H own
 * branches; F borrows the controlling V source's branch; G is matrix-only).
 */

import type { CompiledElement } from "../compiler/index.ts";
import type { Device, MatrixStamp } from "./base.ts";
import { stampVoltageBranch } from "./inductor.ts";

export function dependentDevice(ce: CompiledElement): Device {
  if (ce.type !== "E" && ce.type !== "G" && ce.type !== "F" && ce.type !== "H") {
    throw new Error(`dependentDevice: not a dependent source (${ce.type})`);
  }
  const gain = ce.value as number;
  const br = ce.branch ?? -1;
  const ctrlBr = ce.type === "F" || ce.type === "H" ? (ce.controlBranch ?? -1) : -1;
  const [p, n, cp, cn] = [
    ce.nodes[0] as number,
    ce.nodes[1] as number,
    ce.nodes[2] as number,
    ce.nodes[3] as number,
  ];

  switch (ce.type) {
    case "E":
      return {
        name: ce.name,
        stateSlots: 0,
        stampDC(stamp: MatrixStamp): void {
          stampVCVS(stamp, br, p, n, cp, cn, gain);
        },
        stampTran(stamp: MatrixStamp): void {
          stampVCVS(stamp, br, p, n, cp, cn, gain);
        },
      };
    case "G":
      return {
        name: ce.name,
        stateSlots: 0,
        stampDC(stamp: MatrixStamp): void {
          stampVCCS(stamp, p, n, cp, cn, gain);
        },
        stampTran(stamp: MatrixStamp): void {
          stampVCCS(stamp, p, n, cp, cn, gain);
        },
      };
    case "F":
      return {
        name: ce.name,
        stateSlots: 0,
        stampDC(stamp: MatrixStamp): void {
          stampCCCS(stamp, p, n, ctrlBr, gain);
        },
        stampTran(stamp: MatrixStamp): void {
          stampCCCS(stamp, p, n, ctrlBr, gain);
        },
      };
    case "H":
      return {
        name: ce.name,
        stateSlots: 0,
        stampDC(stamp: MatrixStamp): void {
          stampCCVS(stamp, br, p, n, ctrlBr, gain);
        },
        stampTran(stamp: MatrixStamp): void {
          stampCCVS(stamp, br, p, n, ctrlBr, gain);
        },
      };
  }
}

/** VCVS: v_p − v_n = gain·(v_cp − v_cn); branch row + KCL column. */
function stampVCVS(
  stamp: MatrixStamp,
  br: number,
  p: number,
  n: number,
  cp: number,
  cn: number,
  gain: number,
): void {
  stampVoltageBranch(stamp, br, p, n);
  if (cp >= 0) {
    stamp.addA(br, cp, -gain);
  }
  if (cn >= 0) {
    stamp.addA(br, cn, gain);
  }
}

/** VCCS: i leaves p→n with magnitude gm·(v_cp − v_cn) (SPICE convention). */
function stampVCCS(
  stamp: MatrixStamp,
  p: number,
  n: number,
  cp: number,
  cn: number,
  gain: number,
): void {
  if (p >= 0) {
    if (cp >= 0) stamp.addA(p, cp, gain);
    if (cn >= 0) stamp.addA(p, cn, -gain);
  }
  if (n >= 0) {
    if (cp >= 0) stamp.addA(n, cp, -gain);
    if (cn >= 0) stamp.addA(n, cn, gain);
  }
}

/** CCCS: i leaves p→n with magnitude gain·i_ctrl (i_ctrl into V's + node). */
function stampCCCS(stamp: MatrixStamp, p: number, n: number, ctrlBr: number, gain: number): void {
  if (p >= 0) {
    stamp.addA(p, ctrlBr, gain);
  }
  if (n >= 0) {
    stamp.addA(n, ctrlBr, -gain);
  }
}

/** CCVS: v_p − v_n = gain·i_ctrl; output branch row + KCL column. */
function stampCCVS(
  stamp: MatrixStamp,
  br: number,
  p: number,
  n: number,
  ctrlBr: number,
  gain: number,
): void {
  stampVoltageBranch(stamp, br, p, n);
  stamp.addA(br, ctrlBr, -gain);
}
