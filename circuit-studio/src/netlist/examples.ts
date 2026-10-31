/**
 * Example circuits (UX2-T3 e2e journey + UX3 gallery seeds). Deterministic
 * netlists with named nodes so journeys can assert numeric values. The RC
 * template: τ = R1·C1 = 1 ms, V1 = 5 V PULSE → v(out) reaches 63.2 %·5 V
 * ≈ 3.160 V at t = τ (§13.5 journey 1 numeric gate).
 */

export const RC_EXAMPLE = `* RC charging example (tau = R1*C1 = 1ms)
V1 in 0 DC 0 PULSE(0 5 0 1n 1n 10 20)
R1 in out 1k
C1 out 0 1u
.end
`;

export const RLC_EXAMPLE = `* Series RLC step response (underdamped, zeta ~ 0.25)
V1 in 0 PULSE(0 5 0 1n 1n 10 20)
R1 in n1 100
L1 n1 out 10m
C1 out 0 100n
.end
`;

export const DIVIDER_EXAMPLE = `* Resistive divider (OP smoke)
V1 in 0 10
R1 in out 9k
R2 out 0 1k
.end
`;

/**
 * Inverting amplifier (ideal op-amp): midband gain = −Rf/Rin = −10, flat
 * across AC. UX2 acceptance numeric gate: vm(out) = 10 ±1 % at 1 kHz
 * (§13.5 journey 2 "assert midband gain within tolerance").
 */
export const AMP_EXAMPLE = `* Inverting amplifier (ideal op-amp), midband gain = -10
V1 in 0 DC 0 AC 1
R1 in n1 1k
Rf n1 out 10k
X1 0 n1 out OPAMP_IDEAL
.end
`;

/** A deliberately broken netlist (UX2-T5: line-pinned error banner). */
export const BAD_NETLIST = `* broken on purpose: unknown element letter
V1 in 0 5
Z1 in out 1k
R1 out 0 1k
.end
`;

export interface ExampleCircuit {
  readonly id: string;
  readonly title: string;
  readonly netlist: string;
}

export const EXAMPLES: readonly ExampleCircuit[] = [
  { id: "rc", title: "RC charging (τ = 1 ms)", netlist: RC_EXAMPLE },
  { id: "rlc", title: "Series RLC step", netlist: RLC_EXAMPLE },
  { id: "divider", title: "Resistive divider (OP)", netlist: DIVIDER_EXAMPLE },
  { id: "amp", title: "Inverting amplifier (gain −10)", netlist: AMP_EXAMPLE },
];

/**
 * UX3 gallery (§13 UX3 accept: "gallery circuits 1–12 end-to-end through the
 * UI"). Twelve circuits spanning every analysis kind and the E2 device
 * library; each entry carries the analysis the e2e journey runs it with and
 * the signals it probes (asserted in gallery.test.ts through the real
 * engine, then driven through the production UI in gallery.e2e.ts).
 */
export interface GalleryCircuit extends ExampleCircuit {
  readonly kind: "op" | "dc" | "ac" | "tran";
  readonly analysis: GalleryAnalysis;
  readonly probes: readonly string[];
}

export type GalleryAnalysis =
  | { readonly kind: "op" }
  | { readonly kind: "tran"; readonly tstep: number; readonly tstop: number }
  | {
      readonly kind: "ac";
      readonly sweep: "dec";
      readonly points: number;
      readonly fstart: number;
      readonly fstop: number;
    }
  | {
      readonly kind: "dc";
      readonly source: string;
      readonly start: number;
      readonly stop: number;
      readonly step: number;
    };

export const GALLERY: readonly GalleryCircuit[] = [
  {
    id: "g1-rc-charge",
    title: "RC charging (τ = 1 ms)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 },
    probes: ["v(out)"],
    netlist: RC_EXAMPLE,
  },
  {
    id: "g2-rc-discharge",
    title: "RC discharging (τ = 1 ms)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 },
    probes: ["v(out)"],
    netlist: `* RC discharging (source steps 5V -> 0 at t=0)
V1 in 0 DC 5 PULSE(5 0 0 1n 1n 10 20)
R1 in out 1k
C1 out 0 1u
.end
`,
  },
  {
    id: "g3-rlc-step",
    title: "Series RLC step (underdamped)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 2e-6, tstop: 1e-3 },
    probes: ["v(out)"],
    netlist: RLC_EXAMPLE,
  },
  {
    id: "g4-divider-op",
    title: "Resistive divider (OP)",
    kind: "op",
    analysis: { kind: "op" },
    probes: ["v(out)"],
    netlist: DIVIDER_EXAMPLE,
  },
  {
    id: "g5-inverting-amp",
    title: "Inverting amplifier (gain −10)",
    kind: "ac",
    analysis: { kind: "ac", sweep: "dec", points: 40, fstart: 10, fstop: 1e6 },
    probes: ["vm(out)", "vp(out)"],
    netlist: AMP_EXAMPLE,
  },
  {
    id: "g6-sallen-key",
    title: "Sallen-Key low-pass (f₀ = 1.59 kHz)",
    kind: "ac",
    analysis: { kind: "ac", sweep: "dec", points: 60, fstart: 100, fstop: 1e5 },
    probes: ["vm(out)", "vp(out)"],
    netlist: `* Unity-gain Sallen-Key low-pass, Q = 0.5
V1 in 0 AC 1
R1 in a 1k
R2 a b 1k
C1 a out 100n
C2 b 0 100n
X1 b out out OPAMP_IDEAL
.end
`,
  },
  {
    id: "g7-halfwave-rect",
    title: "Half-wave rectifier (diode)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 2e-5, tstop: 4e-2 },
    probes: ["v(out)"],
    netlist: `* Half-wave rectifier: sine 10 V peak, 50 Hz
V1 in 0 SIN(0 10 50)
D1 in out D1N
RL out 0 10k
.model D1N diode(is=1e-14)
.end
`,
  },
  {
    id: "g8-diode-iv",
    title: "Diode I–V curve (DC sweep)",
    kind: "dc",
    analysis: { kind: "dc", source: "V1", start: 0, stop: 1, step: 0.005 },
    probes: ["i(V1)"],
    netlist: `* Diode forward characteristics
V1 a 0 0
D1 a out D1N
R1 out 0 1
.model D1N diode(is=1e-14)
.end
`,
  },
  {
    id: "g9-lc-tank",
    title: "LC tank resonance (f₀ ≈ 5.03 kHz)",
    kind: "ac",
    analysis: { kind: "ac", sweep: "dec", points: 80, fstart: 100, fstop: 1e6 },
    probes: ["vm(out)"],
    netlist: `* Parallel LC tank driven through a source resistor
V1 in 0 AC 1
R1 in out 1k
L1 out 0 10m
C2 out 0 100n
.end
`,
  },
  {
    id: "g10-integrator",
    title: "Integrator ramp (t ≪ R·C)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 2e-6, tstop: 2e-3 },
    probes: ["v(out)"],
    netlist: `* Passive integrator (square in, ramp out while t << R*C)
V1 in 0 PULSE(-1 1 0 1u 1u 1m 2m)
R1 in out 100k
C1 out 0 1u
.end
`,
  },
  {
    id: "g11-mos-inverter",
    title: "NMOS inverter (resistive load)",
    kind: "tran",
    analysis: { kind: "tran", tstep: 5e-7, tstop: 2e-4 },
    probes: ["v(out)"],
    netlist: `* NMOS inverter with resistive load
VDD vdd 0 5
RD vdd out 10k
M1 out in 0 0 cmn
VIN in 0 PULSE(0 5 0 1n 1n 100u 200u)
.model cmn nmos(vto=0.8 kp=2e-3)
.end
`,
  },
  {
    id: "g12-ce-amp",
    title: "BJT CE amplifier (AC midband)",
    kind: "ac",
    analysis: { kind: "ac", sweep: "dec", points: 40, fstart: 10, fstop: 1e7 },
    probes: ["vm(out)"],
    netlist: `* Common-emitter amplifier (bypassed emitter)
VCC vcc 0 12
VIN in 0 DC 0 AC 1
R1 vcc b 180k
R2 b 0 20k
RC vcc c 2.2k
RE e 0 1k
CE e 0 100u
CIN in b 10u
COUT c out 10u
Q1 c b e qn
RL out 0 47k
.model qn npn(is=1e-14 bf=200 br=3)
.end
`,
  },
];
