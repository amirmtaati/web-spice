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
