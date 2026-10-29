/**
 * .measure cards (E3, "basic .measure"): FIND AT / FIND WHEN with edges,
 * MAX/MIN/AVG/RMS/PP/INTEG with windows — evaluated on synthetic RC tran
 * data and AC Bode data with hand-derived expectations.
 */
import { describe, expect, test } from "bun:test";

import { runAnalysis } from "../src/analyses/index.ts";
import { compile } from "../src/compiler/index.ts";
import { parseNetlist } from "../src/parser/index.ts";

/** RC discharge: v(out) = V0·e^(−t/τ), τ = 1 ms, driven by a PWL source. */
const RC_NETLIST = `rc discharge measures
V1 in 0 DC 5 PWL(0 5 1m 5 1.001m 0 10m 0)
R1 in out 1k
C1 out 0 1u
.tran 10u 6m
.measure tran vstart FIND v(out) AT=0.5m
.measure tran tend FIND v(out) WHEN v(out)=1.839397
.measure tran vpk MAX v(out) FROM=0 TO=1m
.measure tran vmin MIN v(out)
.measure tran tstart FIND v(out) WHEN v(out)=2.5 FALL=1
.measure tran vavg AVG v(out) FROM=2m TO=3m
.measure tran vrms RMS v(out) FROM=2m TO=3m
.measure tran vpp PP v(out)
.end
`;

describe(".measure — tran", () => {
  // Source holds 5 V to 1 ms then ramps to 0 in 1 µs; the OP charges the cap
  // to 5 V, so the output decays as v(t) = 5·e^(−(t − 1.001 ms)/τ), τ = 1 ms.
  test("FIND AT, FIND WHEN, MAX/MIN, FALL crossing, AVG/RMS on an RC decay", () => {
    const ir = parseNetlist(RC_NETLIST);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "tran" });
    const byName = new Map((r.measures ?? []).map((m) => [m.name, m]));

    // v(0.5 ms) while the source still holds 5 V: exactly 5 (charged cap).
    const vstart = byName.get("vstart");
    expect(vstart?.found).toBe(true);
    expect(vstart?.value).toBeCloseTo(5, 3);

    // 5·e^(−Δ/1m) = 1.839397 → Δ = 1.00002 ms after the 1.001 ms ramp.
    const tend = byName.get("tend");
    expect(tend?.found).toBe(true);
    expect(tend?.value).toBeCloseTo(1.001e-3 + 1e-3 * Math.log(5 / 1.839397), 4);

    // Peak in [0, 1 ms] is the held 5 V; min is the tail at 6 ms.
    expect(byName.get("vpk")?.value).toBeCloseTo(5, 3);
    expect(byName.get("vmin")?.value).toBeCloseTo(5 * Math.exp(-4.999), 3);

    // First falling crossing of 2.5 V: Δ = τ·ln 2 after 1.001 ms.
    const tstart = byName.get("tstart");
    expect(tstart?.found).toBe(true);
    expect(tstart?.value).toBeCloseTo(1.001e-3 + 1e-3 * Math.LN2, 3);

    // AVG/RMS over [2, 3] ms on the exact exponential.
    const a = 2e-3;
    const b = 3e-3;
    const avg = 5 * (Math.exp(-(a - 1.001e-3) / 1e-3) - Math.exp(-(b - 1.001e-3) / 1e-3));
    expect(byName.get("vavg")?.value).toBeCloseTo(avg, 3); // sampled mean
    const sq =
      25 * 5e-4 * (Math.exp((-2 * (a - 1.001e-3)) / 1e-3) - Math.exp((-2 * (b - 1.001e-3)) / 1e-3));
    expect(byName.get("vrms")?.value).toBeCloseTo(Math.sqrt(sq / 1e-3), 2); // sampled RMS on the grid

    // PP over the whole run: 5 − tail.
    expect(byName.get("vpp")?.value).toBeCloseTo(5 - 5 * Math.exp(-4.999), 3);
  });

  test("missing crossing reports found=false", () => {
    const netlist = `never crosses
V1 in 0 1
R1 in out 1k
.tran 1m 2m
.measure tran tnever FIND v(out) WHEN v(out)=100
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "tran" });
    const m = (r.measures ?? []).find((x) => x.name === "tnever");
    expect(m?.found).toBe(false);
    expect(Number.isNaN(m?.value ?? 0)).toBe(true);
  });
});

describe(".measure — ac", () => {
  test("FIND AT on the RC low-pass Bode plot", () => {
    const netlist = `ac measures
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac lin 201 79.57747 238.73241
.measure ac gcorner FIND v(out) AT=159.15494
.measure ac gmid FIND vm(out) AT=119.36621
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "ac" });
    const byName = new Map((r.measures ?? []).map((m) => [m.name, m]));
    // Sweep centered on fc: fc/2 → 3fc/2 with 200 steps of fc/200, so fc
    // is exactly point k=100 and fc·1.5−... every AT lands on the grid.
    expect(byName.get("gcorner")?.found).toBe(true);
    expect(byName.get("gcorner")?.value).toBeCloseTo(1 / Math.SQRT2, 6);
    // |H(0.75·fc)|: 1/√(1 + 0.75²·... f=0.75fc → |H| = 1/√(1+0.5625) = 0.8
    expect(byName.get("gmid")?.value).toBeCloseTo(1 / Math.sqrt(1 + 0.75 ** 2), 6);
  });

  test("FIND WHEN locates the −3 dB frequency", () => {
    const netlist = `ac when measure
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 20 100 100k
.measure ac fc FIND vdb(out) WHEN vdb(out)=-3.0103
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "ac" });
    const m = (r.measures ?? []).find((x) => x.name === "fc");
    expect(m?.found).toBe(true);
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    // dec-20 grid: the crossing interpolates to within one grid step.
    const step = (m?.value ?? 0) * (10 ** (1 / 20) - 1);
    expect(Math.abs((m?.value ?? 0) - fc)).toBeLessThan(Math.max(step, 1e-6));
  });
});

describe(".measure — dc", () => {
  test("MAX over a DC sweep", () => {
    const netlist = `dc measure
V1 in 0 0
R1 in out 1k
.dc V1 0 10 1
.measure dc vmax MAX v(out)
.end
`;
    const ir = parseNetlist(netlist);
    const r = runAnalysis(compile(ir), ir.analyses[0] as { kind: "dc" });
    const m = (r.measures ?? []).find((x) => x.name === "vmax");
    expect(m?.found).toBe(true);
    expect(m?.value).toBeCloseTo(10, 6);
  });
});
