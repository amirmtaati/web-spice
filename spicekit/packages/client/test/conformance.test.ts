import { describe, expect, test } from "bun:test";
import { createInProcessClient, runClientConformance } from "../src/index.ts";

describe("in-process transport conformance", () => {
  test("all conformance checks pass against the real engine session", async () => {
    const report = await runClientConformance(() => createInProcessClient());
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("run handle exposes events and done", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      await client.loadCircuit({
        title: "t",
        elements: [
          { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
          { type: "R", name: "R1", n: ["in", "out"], value: "1k" },
        ],
        models: {},
        subcircuits: {},
        params: {},
        options: {
          reltol: 1e-3,
          abstol: 1e-12,
          vntol: 1e-6,
          gmin: 1e-12,
          itl1: 100,
          itl4: 10,
          trtol: 7,
          method: "trap",
          temp: 27,
          tnom: 27,
        },
        analyses: [{ kind: "op" }],
        probes: [],
      });
      const handle = client.run({ analysis: { kind: "op" } });
      let dataCalls = 0;
      handle.onData(() => {
        dataCalls += 1;
      });
      const stats = await handle.done;
      expect(stats.timesteps).toBeGreaterThanOrEqual(0);
      expect(dataCalls).toBe(1); // buffered op emits exactly one chunk
    } finally {
      client.dispose();
    }
  });

  test("loadSpice surfaces a typed EngineError for malformed netlists", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      // A floating node fails pre-flight with a typed error.
      await expect(client.loadSpice("R1 a\n")).rejects.toMatchObject({ name: "EngineError" });
    } finally {
      client.dispose();
    }
  });
});

describe("evaluate message (E3)", () => {
  test("evaluate returns the computed value over the supplied context", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      const value = await client.evaluate("v(out) * 2 + gain", { "v(out)": 1.5, gain: 0.5 });
      expect(value).toBeCloseTo(3.5, 12);
    } finally {
      client.dispose();
    }
  });

  test("evaluate surfaces typed engine errors for bad expressions", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      await expect(client.evaluate("v(nowhere)", {})).rejects.toMatchObject({
        name: "EngineError",
      });
    } finally {
      client.dispose();
    }
  });
});
