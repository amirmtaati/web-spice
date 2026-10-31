/**
 * Experiment recipes (UI-UX-SPEC §6.7.4 table): RC charge, RC discharge,
 * RLC step, integrator ramp, LC resonance, diode IV. Each recipe is fully
 * declarative and engine-parsed in tests.
 */
import type { ExperimentRecipe } from "./schema.ts";

export const RC_CHARGE: ExperimentRecipe = {
  id: "rc-charge",
  title: "RC charging",
  explanation:
    "A capacitor charges through a resistor with time constant τ = R·C: v(t) = V·(1 − e^(−t/τ)).",
  lookFor: "63.2 % of V at t = τ; visually flat (steady state) after ≈ 3τ…5τ.",
  netlist: `* RC charging (tau = R*C)
V1 in 0 DC 0 PULSE(0 {V} 0 1n 1n {WIDTH} {WIDTH2})
R1 in out {R}
C1 out 0 {C}
.end
`,
  params: { V: "5", R: "1k", C: "1u", WIDTH: "10m", WIDTH2: "20m" },
  analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 },
  probes: ["v(out)", "i(C1)"],
  annotations: [
    { kind: "hline", fraction: 0.632, label: "63.2 % of V" },
    { kind: "vline", at: "tau", label: "τ = R·C" },
    { kind: "band", from: "3tau", to: "5tau", label: "steady state (±1 %)" },
  ],
  tau: { r: 1000, c: 1e-6 },
};

export const RC_DISCHARGE: ExperimentRecipe = {
  id: "rc-discharge",
  title: "RC discharging",
  explanation:
    "A charged capacitor discharges through a resistor: v(t) = V₀·e^(−t/τ), losing 63.2 % after τ.",
  lookFor: "36.8 % of V₀ left at t = τ; the current reverses direction vs. charging.",
  netlist: `* RC discharging (source steps V0 -> 0 at t=0)
V1 in 0 DC 0 PULSE({V} 0 0 1n 1n {WIDTH} {WIDTH2})
R1 in out {R}
C1 out 0 {C}
.end
`,
  params: { V: "5", R: "1k", C: "1u", WIDTH: "1n", WIDTH2: "10m" },
  analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 },
  probes: ["v(out)", "i(C1)"],
  annotations: [
    { kind: "hline", fraction: 0.368, label: "36.8 % of V₀" },
    { kind: "vline", at: "tau", label: "τ = R·C" },
  ],
  tau: { r: 1000, c: 1e-6 },
};

export const RLC_STEP: ExperimentRecipe = {
  id: "rlc-step",
  title: "RLC step response",
  explanation: "A series RLC sees damped oscillation: ζ = (R/2)·√(C/L), ringing at ωd = ω₀√(1−ζ²).",
  lookFor:
    "Overshoot past the final value, exponential decay of the envelope, settling in the ±2 % band.",
  netlist: `* Series RLC step (underdamped)
V1 in 0 DC 0 PULSE(0 {V} 0 1n 1n {WIDTH} {WIDTH2})
R1 in n1 {R}
L1 n1 out {L}
C1 out 0 {C}
.end
`,
  params: { V: "5", R: "100", L: "10m", C: "100n", WIDTH: "10m", WIDTH2: "20m" },
  analysis: { kind: "tran", tstep: 2e-6, tstop: 1e-3 },
  probes: ["v(out)"],
  annotations: [
    { kind: "hline", fraction: 1, label: "final value V" },
    { kind: "vline", at: "tau", label: "ζ/ω₀ envelope" },
  ],
};

export const INTEGRATOR: ExperimentRecipe = {
  id: "integrator-ramp",
  title: "Integrator ramp",
  explanation:
    "For t ≪ R·C the capacitor integrates the input: v(t) ≈ (V_in/RC)·t — a linear ramp.",
  lookFor: "Constant slope ≈ V_in/(R·C) volts per second before the curve rolls off.",
  netlist: `* Passive integrator (square in, ramp out while t << R*C)
V1 in 0 DC 0 PULSE(-{V} {V} 0 1u 1u {WIDTH} {WIDTH2})
R1 in out {R}
C1 out 0 {C}
.end
`,
  params: { V: "1", R: "100k", C: "1u", WIDTH: "1m", WIDTH2: "2m" },
  analysis: { kind: "tran", tstep: 2e-6, tstop: 2e-3 },
  probes: ["v(out)"],
  annotations: [{ kind: "vline", at: 0, label: "square edge" }],
  tau: { r: 100000, c: 1e-6 },
};

export const LC_RESONANCE: ExperimentRecipe = {
  id: "lc-resonance",
  title: "LC resonance",
  explanation: "A parallel LC tank peaks at f₀ = 1/(2π√(LC)); Q = (1/R)·√(L/C) sets the sharpness.",
  lookFor: "Magnitude peak at f₀; bandwidth narrows as Q rises.",
  netlist: `* Parallel LC tank driven through a source resistor
V1 in 0 AC 1
R1 in out 1k
L1 out 0 {L}
C1 out 0 {C}
.end
`,
  params: { L: "10m", C: "100n" },
  analysis: { kind: "ac", sweep: "dec", points: 200, fstart: 1e4, fstop: 1e6 },
  probes: ["vm(out)"],
  annotations: [{ kind: "vline", at: 159155, label: "f₀ ≈ 159.15 kHz" }],
};

export const DIODE_IV: ExperimentRecipe = {
  id: "diode-iv",
  title: "Diode I–V curve",
  explanation:
    "A diode conducts exponentially: I = I_s·(e^(V/nV_T) − 1); the knee sits near 0.7 V for silicon.",
  lookFor: "The exponential knee; forward voltage where current reaches 1 mA and 10 mA.",
  netlist: `* Diode forward characteristics
V1 a 0 0
D1 a out D1N
R1 out 0 1
.model D1N diode(is=1e-14)
.end
`,
  params: {},
  analysis: { kind: "dc", source: "V1", start: 0, stop: 1, step: 0.005 },
  probes: ["i(V1)"],
  annotations: [{ kind: "vline", at: 0.7, label: "knee ≈ 0.7 V" }],
};

export const RECIPES: readonly ExperimentRecipe[] = [
  RC_CHARGE,
  RC_DISCHARGE,
  RLC_STEP,
  INTEGRATOR,
  LC_RESONANCE,
  DIODE_IV,
];
