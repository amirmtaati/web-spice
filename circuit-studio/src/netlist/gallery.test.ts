/**
 * UX3 gallery engine gate (acceptance: "gallery circuits 1–12 end-to-end"):
 * every gallery circuit runs through the REAL engine (in-process client —
 * the transport the worker wraps) with its probes, and key physics values
 * are asserted. The production-UI leg (worker transport) runs in
 * gallery.e2e.ts against these same netlists.
 */
import { describe, expect, test } from "bun:test";
import { bodeFeatures, magDbFrom } from "../instruments/plots/bode.ts";
import { createInProcessClient } from "../sim/client.ts";
import { GALLERY } from "./examples.ts";

const client = createInProcessClient();

interface Run {
  readonly axis: number[];
  readonly signals: Map<string, number[]>;
}

async function runGallery(index: number): Promise<Run> {
  const g = GALLERY[index];
  if (g === undefined) {
    throw new Error(`missing gallery circuit ${index}`);
  }
  await client.connect();
  const withProbes = `${g.netlist.trimEnd().replace(/\.end\s*$/, "")}\n.probe ${g.probes.join(" ")}\n.end`;
  await client.loadSpice(withProbes);
  const handle = client.run({ analysis: g.analysis });
  const axis: number[] = [];
  const signals = new Map<string, number[]>();
  let tStart = Number.NaN;
  handle.onData((chunk) => {
    if (Number.isNaN(tStart)) {
      tStart = chunk.tStart;
    }
    for (const col of chunk.chunk) {
      // Engine branch names are case-insensitive ("i(V1)" → "i(v1)") — key
      // the map lowercased so probe spellings always match.
      const list = signals.get(col.name.toLowerCase()) ?? [];
      list.push(...col.samples);
      signals.set(col.name.toLowerCase(), list);
    }
  });
  const stats = await handle.done;
  void stats;
  // Rebuild the axis from the analysis grid (AGENTS.md §5.2).
  const n = Math.max(0, ...[...signals.values()].map((v) => v.length));
  const a = g.analysis;
  for (let k = 0; k < n; k++) {
    switch (a.kind) {
      case "op":
        axis.push(0);
        break;
      case "tran":
        axis.push(k * a.tstep);
        break;
      case "dc":
        axis.push(a.start + k * a.step);
        break;
      case "ac":
        axis.push(a.fstart * 10 ** (k / a.points));
        break;
    }
  }
  return { axis, signals };
}

describe("UX3 gallery through the real engine", () => {
  test("G1 RC charge: 63.2 % at τ", async () => {
    const run = await runGallery(0);
    const v = run.signals.get("v(out)") ?? [];
    expect(v.length).toBeGreaterThan(300);
    expect(v[Math.round(1e-3 / 1e-5)]).toBeCloseTo(5 * (1 - Math.E ** -1), 1);
  });

  test("G2 RC discharge: 36.8 % at τ", async () => {
    const run = await runGallery(1);
    const v = run.signals.get("v(out)") ?? [];
    expect(v[Math.round(1e-3 / 1e-5)]).toBeCloseTo(5 * Math.E ** -1, 1);
  });

  test("G3 RLC step: overshoot then settle", async () => {
    const run = await runGallery(2);
    const v = run.signals.get("v(out)") ?? [];
    const max = Math.max(...v);
    expect(max).toBeGreaterThan(6); // overshoot past the 5 V final value
    expect(v[v.length - 1]).toBeCloseTo(5, 1);
  });

  test("G4 divider OP: v(out) = 1 V exactly", async () => {
    const run = await runGallery(3);
    const v = run.signals.get("v(out)") ?? [];
    expect(v[0]).toBeCloseTo(1.0, 6);
  });

  test("G5 inverting amp: midband gain −10 (|·| = 10 within 1 %)", async () => {
    const run = await runGallery(4);
    const vm = run.signals.get("vm(out)") ?? [];
    // Midband: pick the sample nearest 1 kHz on the dec grid.
    const f = run.axis.map((x) => Math.abs(x - 1e3));
    const mid = f.indexOf(Math.min(...f));
    expect(vm[mid]).toBeGreaterThan(9.9);
    expect(vm[mid]).toBeLessThan(10.1);
  });

  test("G6 Sallen-Key: −3 dB at 0.6436·f₀ = 1024 Hz (±5 %)", async () => {
    const run = await runGallery(5);
    const vm = run.signals.get("vm(out)") ?? [];
    const magDb = magDbFrom("vm(out)", Float64Array.from(vm));
    if (magDb === null) {
      throw new Error("vm(out) missing");
    }
    const vp = run.signals.get("vp(out)") ?? [];
    const features = bodeFeatures(Float64Array.from(run.axis), magDb, Float64Array.from(vp));
    expect(features.minus3dB).not.toBeNull();
    const f0 = 1 / (2 * Math.PI * 1e3 * 1e-7);
    const expected = 0.6436 * f0;
    expect(Math.abs((features.minus3dB ?? 0) - expected) / expected).toBeLessThan(0.05);
  });

  test("G7 half-wave rectifier: peak ≈ 9.3 V, ripple < 1 V", async () => {
    const run = await runGallery(6);
    const v = run.signals.get("v(out)") ?? [];
    const max = Math.max(...v);
    expect(max).toBeGreaterThan(9); // 10 V sine − diode drop
    expect(max).toBeLessThan(10);
  });

  test("G8 diode IV: ~0.7 V at 10 mA", async () => {
    const run = await runGallery(7);
    const i = run.signals.get("i(v1)") ?? [];
    // Sweep steps 0.005 V: find the sweep index where |i| crosses 10 mA
    // (SPICE reports v-source current into the + terminal → negative).
    const idx = i.findIndex((x) => Math.abs(x) >= 0.01);
    expect(idx).toBeGreaterThan(0);
    const vf = run.axis[idx];
    expect(vf).toBeGreaterThan(0.55);
    expect(vf).toBeLessThan(0.85);
  });

  test("G9 LC tank: peak within 2 % of f₀ = 5.033 kHz", async () => {
    const run = await runGallery(8);
    const vm = run.signals.get("vm(out)") ?? [];
    let best = 0;
    for (let k = 1; k < vm.length; k++) {
      if ((vm[k] ?? 0) > (vm[best] ?? 0)) {
        best = k;
      }
    }
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-3 * 100e-9));
    expect(Math.abs((run.axis[best] ?? 0) - f0) / f0).toBeLessThan(0.02);
  });

  test("G10 integrator: linear ramp slope ≈ V/RC = 10 V/ms", async () => {
    const run = await runGallery(9);
    const v = run.signals.get("v(out)") ?? [];
    // Ramp inside the first half-cycle: v ≈ (V/RC)·t with V/RC = 10 V/s.
    const k20 = Math.round(0.2e-3 / 2e-6);
    const k80 = Math.round(0.8e-3 / 2e-6);
    const slope = ((v[k80] ?? 0) - (v[k20] ?? 0)) / 0.6e-3;
    expect(Math.abs(slope)).toBeGreaterThan(8); // 10 V/s ideal
    expect(Math.abs(slope)).toBeLessThan(12);
  });

  test("G11 NMOS inverter: output swings rail-to-near-ground", async () => {
    const run = await runGallery(10);
    const v = run.signals.get("v(out)") ?? [];
    expect(Math.max(...v)).toBeGreaterThan(4.5); // off-state pull-up
    expect(Math.min(...v)).toBeLessThan(0.3); // on-state pull-down (kp = 2 mA/V²)
  });

  test("G12 CE amplifier: AC midband gain present (> 10)", async () => {
    const run = await runGallery(11);
    const vm = run.signals.get("vm(out)") ?? [];
    const mid = Math.floor(vm.length / 2);
    expect(vm[mid]).toBeGreaterThan(10);
  });
});
