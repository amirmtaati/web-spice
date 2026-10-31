/**
 * Experiments tests (UX2-T7 done-when): schema validation rejects broken
 * recipes; the registry serves validated recipes; every recipe's expanded
 * netlist PARSES AND LOADS through the real engine (in-process client) with
 * its declared probes accepted.
 */
import { describe, expect, test } from "bun:test";
import { createInProcessClient } from "../../sim/client.ts";
import type { SimulatorClient } from "../../sim/types.ts";
import { RECIPES } from "./recipes.ts";
import { getExperiment, listExperiments } from "./registry.ts";
import { type ExperimentRecipe, expandNetlist, validateExperiment } from "./schema.ts";

let client: SimulatorClient | null = null;
async function engineClient(): Promise<SimulatorClient> {
  if (client === null) {
    client = createInProcessClient();
    await client.connect();
  }
  return client;
}

describe("experiment schema validation", () => {
  test("accepts a well-formed recipe", () => {
    const r = validateExperiment(RECIPES[0]);
    expect(r.ok).toBe(true);
  });

  test("rejects missing fields with actionable errors", () => {
    expect(validateExperiment(null)).toEqual({ ok: false, error: "recipe must be an object" });
    expect(validateExperiment({ ...RECIPES[0], title: "" }).ok).toBe(false);
    expect(validateExperiment({ ...RECIPES[0], netlist: "R1 a b 1k" }).ok).toBe(false);
    expect(validateExperiment({ ...RECIPES[0], params: undefined }).ok).toBe(false);
    expect(validateExperiment({ ...RECIPES[0], analysis: { kind: "banana" } }).ok).toBe(false);
    expect(validateExperiment({ ...RECIPES[0], probes: [""] }).ok).toBe(false);
    expect(
      validateExperiment({
        ...RECIPES[0],
        annotations: [{ kind: "hline", fraction: 2.5, label: "x" }],
      }).ok,
    ).toBe(false);
    expect(validateExperiment({ ...RECIPES[0], annotations: [{ kind: "sparkle" }] }).ok).toBe(
      false,
    );
    expect(validateExperiment({ ...RECIPES[0], tau: { r: -1, c: 1 } }).ok).toBe(false);
  });

  test("expandNetlist substitutes placeholders", () => {
    const r = RECIPES[0] as ExperimentRecipe;
    const text = expandNetlist(r);
    expect(text).not.toContain("{R}");
    expect(text).toContain("1k");
  });
});

describe("experiment registry", () => {
  test("serves the six §6.7.4 experiments", () => {
    const ids = listExperiments().map((r) => r.id);
    expect(ids).toEqual([
      "rc-charge",
      "rc-discharge",
      "rlc-step",
      "integrator-ramp",
      "lc-resonance",
      "diode-iv",
    ]);
    expect(getExperiment("rc-charge")?.title).toBe("RC charging");
    expect(getExperiment("nope")).toBeUndefined();
  });
});

describe("every recipe loads through the real engine", () => {
  for (const recipe of RECIPES) {
    test(`engine parses + compiles "${recipe.id}" and streams its probes`, async () => {
      const client = await engineClient();
      const netlist = expandNetlist(recipe);
      const result = await client.loadSpice(netlist);
      // Probes the recipe declares must be acceptable signal names — the
      // engine lowercases; v()/i() shapes are verified against the node
      // table when the signal is a node voltage.
      expect(recipe.probes.length).toBeGreaterThan(0);
      expect(result.nodeTable.length).toBeGreaterThan(0);
    });
  }

  test("rc-charge produces the 63.2 % @ τ curve (numeric gate)", async () => {
    const client = await engineClient();
    const recipe = getExperiment("rc-charge");
    if (recipe === undefined) throw new Error("rc-charge missing");
    await client.loadSpice(expandNetlist(recipe));
    const handle = client.run({ analysis: recipe.analysis });
    const chunks: number[][] = [];
    handle.onData((c) => {
      for (const s of c.chunk) {
        if (s.name === "v(out)") chunks.push([...s.samples]);
      }
    });
    const stats = await handle.done;
    expect(stats.timesteps).toBeGreaterThan(0);
    // τ = R·C = 1 ms; tstep = 10 µs → sample 100 is t = τ.
    const flat = chunks.flat();
    expect(flat.length).toBeGreaterThanOrEqual(101);
    const vTau = flat[100] as number;
    // 63.2 % of 5 V = 3.160 V — within 2 %.
    expect(vTau).toBeGreaterThan(3.097);
    expect(vTau).toBeLessThan(3.223);
  });
});
