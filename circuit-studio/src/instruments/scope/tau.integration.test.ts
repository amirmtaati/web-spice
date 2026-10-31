/**
 * UX3-T7 engine integration: run the RC charging circuit through the REAL
 * engine (in-process client — the same code path the worker transport
 * wraps), then fit τ over the transient the way the scope's "Estimate τ"
 * does. Acceptance gate: fit within 5 % of R·C = 1 ms; 63.2 %·V at t = τ
 * within 2 %.
 */
import { describe, expect, test } from "bun:test";
import { RC_EXAMPLE } from "../../netlist/examples.ts";
import { createInProcessClient } from "../../sim/client.ts";
import { fitTau } from "./tau.ts";

describe("τ estimation against the real engine (RC charging)", () => {
  test("fit τ ≈ R·C within 5 %; v(τ) = 63.2 %·V within 2 %", async () => {
    const client = createInProcessClient();
    await client.connect();
    // Probe v(out) explicitly (the UI appends .probe cards the same way).
    const netlist = RC_EXAMPLE.replace(".end", ".probe v(out)\n.end");
    await client.loadSpice(netlist);
    const handle = client.run({
      analysis: { kind: "tran", tstep: 1e-5, tstop: 5e-3 },
    });
    const chunks: { tStart: number; values: number[] }[] = [];
    handle.onData((chunk) => {
      const col = chunk.chunk.find((c) => c.name === "v(out)");
      if (col !== undefined) {
        chunks.push({ tStart: chunk.tStart, values: [...col.samples] });
      }
    });
    await handle.done;

    // Reconstruct the uniform grid (AGENTS.md §5.2): contiguous chunks on a
    // 10 µs grid starting at t = 0.
    const dt = 1e-5;
    const values: number[] = [];
    for (const c of chunks) {
      values.push(...c.values);
    }
    expect(values.length).toBeGreaterThan(300);

    // 63.2 % gate: v(t = τ) ≈ 5·(1 − e⁻¹) ±2 %.
    const vTau = values[Math.round(1e-3 / dt)];
    expect(vTau).toBeGreaterThan(5 * (1 - Math.E ** -1) * 0.98);
    expect(vTau).toBeLessThan(5 * (1 - Math.E ** -1) * 1.02);

    // τ fit over the transient span [0, 5τ] — the scope's cursor flow.
    const axis = new Float64Array(values.length);
    for (let k = 0; k < axis.length; k++) {
      axis[k] = k * dt;
    }
    const fit = fitTau(axis, Float64Array.from(values), 0, values.length);
    expect(fit).not.toBeNull();
    if (fit === null) {
      return;
    }
    expect(fit.direction).toBe("rise");
    expect(fit.firstOrder).toBe(true);
    expect(fit.tau / 1e-3).toBeGreaterThan(0.95);
    expect(fit.tau / 1e-3).toBeLessThan(1.05);
  });
});
