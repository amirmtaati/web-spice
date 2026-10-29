/**
 * Device unit tests (SPEC §5.3/§5.7): stamp algebra for R/C/L/K/V/I/E/G/F/H,
 * companion models for BE/trap/Gear-2, and waveform evaluation with
 * breakpoints. Stamps are checked against hand-derived MNA entries.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_SIM_OPTIONS, type Element } from "@spicekit/protocol";
import type { CompiledCircuit, CompiledElement } from "../src/compiler/index.ts";
import { capacitorDevice } from "../src/devices/capacitor.ts";
import { dependentDevice } from "../src/devices/dependent.ts";
import {
  buildDevices,
  type Device,
  type DeviceEnv,
  type MatrixStamp,
} from "../src/devices/index.ts";
import { inductorDevice } from "../src/devices/inductor.ts";
import { resistorDevice } from "../src/devices/resistor.ts";
import { createWaveEval, resolveWave } from "../src/devices/waveform.ts";
import { ParamScope } from "../src/eval/index.ts";

/** Deterministic stamp recorder implementing MatrixStamp. */
class Recorder implements MatrixStamp {
  readonly a: Float64Array;
  readonly rhs: Float64Array;
  constructor(readonly size: number) {
    this.a = new Float64Array(size * size);
    this.rhs = new Float64Array(size);
  }
  addA(row: number, col: number, value: number): void {
    const k = row * this.size + col;
    this.a[k] = (this.a[k] ?? 0) + value;
  }
  addRhs(row: number, value: number): void {
    this.rhs[row] = (this.rhs[row] ?? 0) + value;
  }
  at(row: number, col: number): number {
    return this.a[row * this.size + col] ?? 0;
  }
}

function testEnv(nodes: number[], branches: number[] = []): DeviceEnv {
  return {
    nodes,
    branches,
    x: new Float64Array(Math.max(4, nodes.length + branches.length)),
    state: new Float64Array(16),
    stateBase: 0,
    stateBases: new Map(),
    time: 0,
  };
}

const BRANCH_TYPES = new Set(["V", "L", "E", "H"]);

/**
 * Build a device from one element with a hand-rolled single-element
 * CompiledCircuit: nodes indexed in appearance order ("0" = ground),
 * a branch unknown after the nodes when the type owns one.
 */
function deviceFor(el: Element): Device {
  const names = (el.n ?? []) as readonly string[];
  const index = new Map<string, number>();
  const nodes = names.map((nm) => {
    const lower = nm.toLowerCase();
    if (lower === "0") {
      return -1;
    }
    if (!index.has(lower)) {
      index.set(lower, index.size);
    }
    return index.get(lower) as number;
  });
  const ownsBranch = BRANCH_TYPES.has(el.type);
  const branch = ownsBranch ? index.size : undefined;
  const extra = el as unknown as Record<string, unknown>;
  const ce: CompiledElement = {
    element: el,
    type: el.type,
    name: el.name,
    nodes,
    ...(branch !== undefined ? { branch } : {}),
    value: numericValue(el),
    ...(["V", "I"].includes(el.type) ? { dc: (extra.dc as number) ?? 0 } : {}),
  };
  const compiled: CompiledCircuit = {
    nodeNames: [...index.keys()],
    probes: [],
    nodeCount: index.size,
    branchCount: ownsBranch ? 1 : 0,
    branchOwners: ownsBranch ? [el.name] : [],
    branchByName: new Map(),
    elements: [ce],
    options: { ...DEFAULT_SIM_OPTIONS },
    params: {},
    warnings: [],
  };
  const devices = buildDevices(compiled);
  expect(devices).toHaveLength(1);
  return devices[0] as Device;
}

function numericValue(el: Element): number | undefined {
  const extra = el as unknown as Record<string, unknown>;
  switch (el.type) {
    case "R":
    case "C":
    case "L":
      return el.value as number;
    case "E":
      return extra.gain as number;
    case "G":
      return extra.gm as number;
    case "F":
    case "H":
      return extra.gain as number;
    default:
      return undefined;
  }
}

describe("resistor", () => {
  test("stamps 1/R symmetrically", () => {
    const d = deviceFor({ type: "R", name: "R1", n: ["a", "b"], value: 1000 });
    const rec = new Recorder(2);
    d.stampDC(rec, testEnv([0, 1]));
    expect(rec.at(0, 0)).toBeCloseTo(1e-3, 18);
    expect(rec.at(0, 1)).toBeCloseTo(-1e-3, 18);
    expect(rec.at(1, 0)).toBeCloseTo(-1e-3, 18);
    expect(rec.at(1, 1)).toBeCloseTo(1e-3, 18);
  });

  test("no temp shift at reference temperature", () => {
    const d = deviceFor({ type: "R", name: "R1", n: ["a", "b"], value: 1000, tc1: 0.01 });
    const rec = new Recorder(2);
    d.stampDC(rec, testEnv([0, 1]));
    expect(rec.at(0, 0)).toBeCloseTo(1e-3, 18);
  });

  test("temperature coefficients apply (temp ≠ tnom)", () => {
    const d = resistorDevice(
      {
        type: "R",
        name: "R1",
        n: ["a", "b"],
        value: 1000,
        tc1: 0.01,
        nodes: [0, 1],
        element: { type: "R", name: "R1", n: ["a", "b"], value: 1000 },
      } as never,
      { ...DEFAULT_SIM_OPTIONS, temp: 47, tnom: 27 },
    );
    const rec = new Recorder(2);
    d.stampDC(rec, testEnv([0, 1]));
    // R(47) = 1000·(1 + 0.01·20) = 1200 → G = 1/1200
    expect(rec.at(0, 0)).toBeCloseTo(1 / 1200, 15);
  });
});

describe("capacitor companion models", () => {
  const C = 1e-6;
  const h = 1e-6;
  const mk = () =>
    capacitorDevice({
      type: "C",
      name: "C1",
      n: ["a", "b"],
      value: C,
      nodes: [0, 1],
      element: { type: "C", name: "C1", n: ["a", "b"], value: C },
    } as never);

  test("BE: G = C/h, J = G·v_n", () => {
    const d = mk();
    const rec = new Recorder(2);
    const env = testEnv([0, 1]);
    env.state[0] = 2.5; // v_n
    d.stampTran?.(rec, env, h, "be");
    expect(rec.at(0, 0)).toBeCloseTo(C / h, 15);
    expect(rec.rhs[0]).toBeCloseTo((C / h) * 2.5, 15);
    expect(rec.rhs[1]).toBeCloseTo(-(C / h) * 2.5, 15);
  });

  test("trap: G = 2C/h, J = G·v_n + i_n", () => {
    const d = mk();
    const rec = new Recorder(2);
    const env = testEnv([0, 1]);
    env.state[0] = 2.5;
    env.state[3] = 0.001; // i_n
    d.stampTran?.(rec, env, h, "trap");
    expect(rec.at(0, 0)).toBeCloseTo((2 * C) / h, 15);
    expect(rec.rhs[0]).toBeCloseTo(((2 * C) / h) * 2.5 + 0.001, 15);
  });

  test("gear2: G = 1.5C/h, J = (C/h)(2v_n − v_{n−1}/2)", () => {
    const d = mk();
    const rec = new Recorder(2);
    const env = testEnv([0, 1]);
    env.state[0] = 2.5;
    env.state[1] = 1.5;
    d.stampTran?.(rec, env, h, "gear2");
    expect(rec.at(0, 0)).toBeCloseTo((1.5 * C) / h, 15);
    expect(rec.rhs[0]).toBeCloseTo((C / h) * (2 * 2.5 - 0.5 * 1.5), 15);
  });

  test("accept shifts history and commits current", () => {
    const d = mk();
    const env = testEnv([0, 1]);
    env.x[0] = 3; // node a at 3V, node b ground → v_new = 3
    env.state[0] = 2.5;
    env.state[1] = 1.5;
    env.state[4] = 2 / 1e-6; // last G (trap)
    env.state[5] = 0; // last J
    d.accept?.(env);
    expect(env.state[0]).toBe(3);
    expect(env.state[1]).toBe(2.5);
    expect(env.state[3]).toBeCloseTo((2 / 1e-6) * 3, 12);
  });
});

describe("inductor companion models", () => {
  const L = 1e-3;
  const h = 1e-6;
  const mk = () =>
    inductorDevice({
      type: "L",
      name: "L1",
      n: ["a", "b"],
      value: L,
      nodes: [0, 1],
      branch: 2,
      element: { type: "L", name: "L1", n: ["a", "b"], value: L },
    } as never);

  test("DC short: branch row v_p − v_n = 0", () => {
    const d = mk();
    const rec = new Recorder(3); // 2 nodes + 1 branch
    d.stampDC(rec, testEnv([0, 1], [2]));
    expect(rec.at(0, 2)).toBe(1);
    expect(rec.at(1, 2)).toBe(-1);
    expect(rec.at(2, 0)).toBe(1);
    expect(rec.at(2, 1)).toBe(-1);
    expect(rec.at(2, 2)).toBe(0);
  });

  test("BE: A[br,br] −= L/h, rhs = −(L/h)·i_n", () => {
    const d = mk();
    const rec = new Recorder(3);
    const env = testEnv([0, 1], [2]);
    env.state[0] = 0.5; // i_n
    d.stampTran?.(rec, env, h, "be");
    expect(rec.at(2, 2)).toBeCloseTo(-L / h, 15);
    expect(rec.rhs[2]).toBeCloseTo(-(L / h) * 0.5, 15);
  });

  test("trap: A[br,br] −= 2L/h, rhs = −(2L/h)i_n − v_n", () => {
    const d = mk();
    const rec = new Recorder(3);
    const env = testEnv([0, 1], [2]);
    env.state[0] = 0.5;
    env.state[3] = 1.0; // v_n
    d.stampTran?.(rec, env, h, "trap");
    expect(rec.at(2, 2)).toBeCloseTo((-2 * L) / h, 15);
    expect(rec.rhs[2]).toBeCloseTo(((-2 * L) / h) * 0.5 - 1.0, 15);
  });
});

describe("dependent sources", () => {
  test("E: branch row v_p − v_n − gain(v_cp − v_cn) = 0", () => {
    const d = deviceFor({ type: "E", name: "E1", n: ["p", "n", "cp", "cn"], gain: 100 });
    const rec = new Recorder(5);
    d.stampDC(rec, testEnv([0, 1, 2, 3], [4]));
    expect(rec.at(4, 0)).toBe(1);
    expect(rec.at(4, 1)).toBe(-1);
    expect(rec.at(4, 2)).toBe(-100);
    expect(rec.at(4, 3)).toBe(100);
    expect(rec.at(0, 4)).toBe(1);
    expect(rec.at(1, 4)).toBe(-1);
  });

  test("G: transconductance block", () => {
    const d = deviceFor({ type: "G", name: "G1", n: ["p", "n", "cp", "cn"], gm: 1e-3 });
    const rec = new Recorder(4);
    d.stampDC(rec, testEnv([0, 1, 2, 3]));
    // Current leaves p: +gm on (p,cp), −gm on (p,cn); mirrored at n.
    expect(rec.at(0, 2)).toBeCloseTo(1e-3, 18);
    expect(rec.at(0, 3)).toBeCloseTo(-1e-3, 18);
    expect(rec.at(1, 2)).toBeCloseTo(-1e-3, 18);
    expect(rec.at(1, 3)).toBeCloseTo(1e-3, 18);
  });

  test("F: current controlled by V branch", () => {
    const d = dependentDevice({
      type: "F",
      name: "F1",
      n: ["p", "n"],
      control: "V1",
      gain: 2,
      nodes: [0, 1],
      controlBranch: 3,
      value: 2,
      element: { type: "F", name: "F1", n: ["p", "n"], control: "V1", gain: 2 },
    } as never);
    const rec = new Recorder(4);
    d.stampDC(rec, testEnv([0, 1], [3]));
    expect(rec.at(0, 3)).toBe(2);
    expect(rec.at(1, 3)).toBe(-2);
  });

  test("H: branch voltage controlled by V branch current", () => {
    const d = dependentDevice({
      type: "H",
      name: "H1",
      n: ["p", "n"],
      control: "V1",
      gain: 1000,
      nodes: [0, 1],
      branch: 4,
      controlBranch: 3,
      value: 1000,
      element: { type: "H", name: "H1", n: ["p", "n"], control: "V1", gain: 1000 },
    } as never);
    const rec = new Recorder(5);
    d.stampDC(rec, testEnv([0, 1], [4]));
    expect(rec.at(4, 3)).toBe(-1000);
    expect(rec.at(0, 4)).toBe(1);
    expect(rec.at(1, 4)).toBe(-1);
    expect(rec.at(4, 0)).toBe(1);
  });
});

describe("sources", () => {
  test("V source branch row and RHS", () => {
    const d = deviceFor({ type: "V", name: "V1", n: ["p", "0"], dc: 5 });
    const rec = new Recorder(2);
    d.stampDC(rec, testEnv([0, -1], [1]));
    // KCL column +1 at (0,br); branch row v_p; RHS carries the source value.
    // The n-side −1 entries are skipped because n is ground.
    expect(rec.at(0, 1)).toBe(1);
    expect(rec.at(1, 0)).toBe(1);
    expect(rec.at(1, 1)).toBe(0);
    expect(rec.rhs[1]).toBe(5);
  });

  test("I source injects current out of + node", () => {
    const d = deviceFor({ type: "I", name: "I1", n: ["p", "0"], dc: 0.001 });
    const rec = new Recorder(1);
    d.stampDC(rec, testEnv([0, -1]));
    expect(rec.rhs[0]).toBeCloseTo(-0.001, 20);
  });

  test("I source evaluates waveform in transient", () => {
    const d = deviceFor({
      type: "I",
      name: "I1",
      n: ["p", "0"],
      wave: {
        kind: "PULSE",
        v1: 0,
        v2: 0.002,
        delay: 1e-6,
        rise: 1e-9,
        fall: 1e-9,
        width: 1e-6,
        period: 4e-6,
      },
    });
    const rec = new Recorder(1);
    const env = testEnv([0, -1]);
    env.time = 2e-6; // high phase
    d.stampTran?.(rec, env, 1e-7, "trap");
    expect(rec.rhs[0]).toBeCloseTo(-0.002, 20);
  });
});

describe("waveform evaluation", () => {
  const scope = new ParamScope({});

  test("SIN: offset before delay, damped sine after", () => {
    const w = resolveWave({ kind: "SIN", offset: 1, amp: 2, freq: 1000, delay: 1e-3 }, scope);
    const ev = createWaveEval(w);
    expect(ev.valueAt(0)).toBe(1);
    expect(ev.valueAt(0.5e-3)).toBe(1);
    expect(ev.valueAt(1e-3)).toBeCloseTo(1, 12);
    expect(ev.valueAt(1e-3 + 0.25e-3)).toBeCloseTo(3, 2); // quarter period peak
    expect(ev.nextBreakpoint(0)).toBe(1e-3);
    expect(ev.nextBreakpoint(2e-3)).toBeUndefined();
  });

  test("PULSE: shape and breakpoints", () => {
    const w = resolveWave(
      {
        kind: "PULSE",
        v1: 0,
        v2: 5,
        delay: 1e-6,
        rise: 1e-6,
        fall: 1e-6,
        width: 2e-6,
        period: 8e-6,
      },
      scope,
    );
    const ev = createWaveEval(w);
    expect(ev.valueAt(0)).toBe(0);
    expect(ev.valueAt(0.5e-6)).toBe(0);
    expect(ev.valueAt(1.5e-6)).toBeCloseTo(2.5, 12); // mid-rise
    expect(ev.valueAt(3e-6)).toBe(5); // high plateau (2..4µ)
    expect(ev.valueAt(4.5e-6)).toBeCloseTo(2.5, 12); // mid-fall (4..5µ)
    expect(ev.valueAt(6e-6)).toBe(0);
    expect(ev.valueAt(9.5e-6)).toBeCloseTo(2.5, 12); // second cycle rise
    expect(ev.nextBreakpoint(0)).toBe(1e-6);
    expect(ev.nextBreakpoint(1e-6 + 1e-9)).toBe(2e-6); // top of rise
    expect(ev.nextBreakpoint(7e-6)).toBe(9e-6); // next cycle start
  });

  test("PWL: interpolation, clamping, REPEAT, breakpoints", () => {
    const w = resolveWave(
      {
        kind: "PWL",
        points: [
          [0, 0],
          [1e-3, 2],
        ],
        repeat: false,
      },
      scope,
    );
    const ev = createWaveEval(w);
    expect(ev.valueAt(0.5e-3)).toBeCloseTo(1, 12);
    expect(ev.valueAt(5e-3)).toBe(2);
    expect(ev.nextBreakpoint(0)).toBe(1e-3);
    expect(ev.nextBreakpoint(2e-3)).toBeUndefined();

    const wr = resolveWave(
      {
        kind: "PWL",
        points: [
          [0, 0],
          [1e-3, 2],
        ],
        repeat: true,
      },
      scope,
    );
    const evr = createWaveEval(wr);
    expect(evr.valueAt(1.5e-3)).toBeCloseTo(1, 12);
    expect(evr.nextBreakpoint(1.2e-3)).toBeCloseTo(2e-3, 12);
    expect(evr.nextBreakpoint(2.5e-3)).toBeCloseTo(3e-3, 12);
  });
});
