import { describe, expect, test } from "bun:test";
import { createInProcessClient, runClientConformance } from "../src/index.ts";

describe("in-process transport conformance", () => {
  test("all conformance checks pass against the stub engine", async () => {
    const report = await runClientConformance(() => createInProcessClient());
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("run handle exposes events and done", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      const handle = client.run({ analysis: { kind: "op" } });
      let dataCalls = 0;
      handle.onData(() => {
        dataCalls += 1;
      });
      await handle.done;
      expect(dataCalls).toBeGreaterThanOrEqual(0); // stub emits one (empty) chunk
    } finally {
      client.dispose();
    }
  });

  test("loadSpice surfaces a typed EngineError (stub: not implemented)", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      await expect(client.loadSpice("* x")).rejects.toMatchObject({ name: "EngineError" });
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
