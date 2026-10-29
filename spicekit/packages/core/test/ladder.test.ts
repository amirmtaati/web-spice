/**
 * Fallback-ladder hard tests (SPEC §5.5, E2 acceptance). The OP ladder is
 *
 *   direct Newton → gmin stepping → source stepping → pseudo-transient
 *
 * and every rung must be reachable, agree on the answer, and exhaust cleanly
 * when no DC solution exists. The scenarios:
 *
 *  - A symmetric CMOS latch (two cross-coupled inverters) is bistable: the
 *    DC solution set is {n1=n2=VDD/2 (metastable), (0,VDD), (VDD,0)}. Newton
 *    from x=0 lands on the mid-rail branch — every rung must find the same
 *    operating point, which is the cross-rung consistency contract.
 *  - The ngspice-compatible knobs route the ladder: `.options noopiter=1`
 *    skips the direct attempt, `gminsteps`/`srcsteps` size or skip rungs.
 *  - An astable switch relaxation circuit (a divider sitting exactly at the
 *    switch threshold with the switch shunting its own control node) has NO
 *    DC fixed point: the switch flips every Newton iteration, so direct,
 *    gmin, source and pseudo-transient all fail — the ladder must exhaust
 *    with E_NO_CONVERGENCE, naming every rung.
 */
import { describe, expect, test } from "bun:test";
import { EngineError } from "@spicekit/protocol";
import { compile } from "../src/compiler/index.ts";
import { runOp, runOpWarm } from "../src/analyses/op.ts";
import { Workspace } from "../src/analyses/workspace.ts";
import { parseNetlist } from "../src/parser/index.ts";

const LATCH = `CMOS latch (bistable ring of two inverters)
VDD dd 0 5
MN1 n1 n2 0 0 cmn W=20u L=1u
MP1 n1 n2 dd dd cmp W=20u L=1u
MN2 n2 n1 0 0 cmn W=20u L=1u
MP2 n2 n1 dd dd cmp W=20u L=1u
.model cmn nmos(vto=0.8 kp=2e-4)
.model cmp pmos(vto=-0.8 kp=2e-4)
.end`;

const ASTABLE = `Switch relaxation circuit with no DC fixed point
V1 cc 0 5
R1 cc n1 1k
R2 n1 0 1k
S1 n1 0 n1 0 sw
.model sw sw(vt=2.4 ron=1 roff=1e9)
.end`;

function opMethodAndNodes(
  netlist: string,
): { method: string; n1: number; n2: number; iterations: number } {
  const compiled = compile(parseNetlist(netlist));
  const ws = new Workspace(compiled);
  const out = runOp(ws, compiled.options, 0);
  const i1 = ws.nodeIndexOf("n1");
  const i2 = ws.nodeIndexOf("n2");
  return { method: out.method, n1: ws.x[i1] as number, n2: ws.x[i2] as number, iterations: out.iterations };
}

describe("ladder routing (ngspice-compatible knobs)", () => {
  test("direct Newton is the first rung on a convergent circuit", () => {
    const r = opMethodAndNodes(LATCH);
    expect(r.method).toBe("direct");
    expect(r.iterations).toBeGreaterThan(0);
    // Mid-rail metastable branch: both inverters sit at VDD/2 within reltol.
    expect(r.n1).toBeCloseTo(2.5, 3);
    expect(r.n2).toBeCloseTo(2.5, 3);
  });

  test("noopiter=1 enters the ladder at gmin stepping and finds the same point", () => {
    const direct = opMethodAndNodes(LATCH);
    const r = opMethodAndNodes(LATCH.replace(".end", ".options noopiter=1\n.end"));
    expect(r.method).toBe("gmin");
    // Cross-rung consistency: gmin stepping must land on the same branch.
    expect(r.n1).toBeCloseTo(direct.n1, 6);
    expect(r.n2).toBeCloseTo(direct.n2, 6);
  });

  test("gminsteps=0 routes to the source rung", () => {
    const direct = opMethodAndNodes(LATCH);
    const r = opMethodAndNodes(
      LATCH.replace(".end", ".options noopiter=1 gminsteps=0\n.end"),
    );
    expect(r.method).toBe("source");
    expect(r.n1).toBeCloseTo(direct.n1, 6);
    expect(r.n2).toBeCloseTo(direct.n2, 6);
  });

  test("srcsteps=0 routes to the pseudo-transient rung", () => {
    const direct = opMethodAndNodes(LATCH);
    const r = opMethodAndNodes(
      LATCH.replace(".end", ".options noopiter=1 gminsteps=0 srcsteps=0\n.end"),
    );
    expect(r.method).toBe("pseudo");
    // The homotopy flow must end on the same branch, within the looser
    // steady-state tolerance of the pseudo-time march.
    expect(r.n1).toBeCloseTo(direct.n1, 3);
    expect(r.n2).toBeCloseTo(direct.n2, 3);
  });

  test("pseudo-transient rescues a circuit whose direct Newton needs the cap flow", () => {
    // gmin rung disabled, source rung disabled: from noopiter the ONLY rung
    // is pseudo-transient, and it must converge the full nonlinear circuit.
    const netlist = `Diode-resistor bias via pseudo-transient only
V1 cc 0 5
D1 cc mid DN
R1 mid 0 1k
.model DN D(is=1e-14)
.options noopiter=1 gminsteps=0 srcsteps=0
.end`;
    const compiled = compile(parseNetlist(netlist));
    const ws = new Workspace(compiled);
    const out = runOp(ws, compiled.options, 0);
    expect(out.method).toBe("pseudo");
    const vm = ws.x[ws.nodeIndexOf("mid")] as number;
    // D1 conducts cc → mid: mid ≈ VDD − vD ≈ 5 − 0.7 = 4.3 V, remainder
    // across R1.
    expect(vm).toBeGreaterThan(4.0);
    expect(vm).toBeLessThan(4.6);
    const iR = vm / 1e3;
    const vd = 5 - vm;
    const iD = 1e-14 * (Math.exp(vd / 0.02585) - 1);
    // KCL residual at mid, relative — bounded by the Newton reltol contract
    // (a 4 mV iterate slip at the diode knee is ~reltol-scale in current).
    expect(Math.abs(iD - iR) / iR).toBeLessThan(0.02);
  });

  test("knob values parse into compiled options", () => {
    const compiled = compile(
      parseNetlist(LATCH.replace(".end", ".options noopiter=1 gminsteps=5 srcsteps=7\n.end")),
    );
    expect(compiled.options.noopiter).toBe(1);
    expect(compiled.options.gminsteps).toBe(5);
    expect(compiled.options.srcsteps).toBe(7);
  });
});

describe("ladder exhaustion on a circuit with no DC solution", () => {
  test("astable switch circuit exhausts every rung with E_NO_CONVERGENCE", () => {
    const compiled = compile(parseNetlist(ASTABLE));
    const ws = new Workspace(compiled);
    let err: EngineError | undefined;
    try {
      runOp(ws, compiled.options, 0);
    } catch (e) {
      err = e as EngineError;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect(err?.code).toBe("E_NO_CONVERGENCE");
    // The diagnostic names each rung so the user knows what was tried.
    expect(err?.message).toContain("gmin stepping (10 steps)");
    expect(err?.message).toContain("source stepping (10 steps)");
    expect(err?.message).toContain("pseudo-transient");
  });

  test("custom step counts are reported in the exhaustion diagnostic", () => {
    const compiled = compile(
      parseNetlist(ASTABLE.replace(".end", ".options gminsteps=3 srcsteps=4\n.end")),
    );
    const ws = new Workspace(compiled);
    expect(() => runOp(ws, compiled.options, 0)).toThrow(/gmin stepping \(3 steps\).*source stepping \(4 steps\)/s);
  });

  test("the astable is hard for the direct rung specifically (state flip-flop)", () => {
    // Sanity on WHY the astable is hard: with the switch always OFF the
    // divider sits above vt and with it ON below — Newton has no fixed
    // point to settle on. runOpWarm (direct-only Newton, the DC-sweep
    // hot path) must fail with the same diagnostic.
    const compiled = compile(parseNetlist(ASTABLE));
    const ws = new Workspace(compiled);
    expect(() => runOpWarm(ws, compiled.options, 0)).toThrow(/Newton did not converge/);
  });
});
