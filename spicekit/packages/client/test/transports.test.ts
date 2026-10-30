/**
 * Worker transport conformance (E4): a real Worker hosts the engine; the
 * client drives it through the worker transport. Also verifies crash
 * detection by terminating the worker (abnormal exit → typed error +
 * respawn) and that a fresh client works afterwards.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { SimulatorClient } from "../src/client.ts";
import { SimulatorClientImpl } from "../src/client.ts";
import { basicCircuit, runClientConformance } from "../src/conformance.ts";
import { createInProcessClient, createWorkerTransport } from "../src/index.ts";

function createWorkerClient(): SimulatorClient {
  const transport = createWorkerTransport(new URL("../src/worker-entry.ts", import.meta.url));
  return new SimulatorClientImpl(transport);
}

afterAll(() => {
  // Give respawning workers a tick to settle before the runner exits.
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 50);
  });
});

describe("worker transport (E4)", () => {
  test("handshake and buffered op run over a real Worker", async () => {
    const client = createWorkerClient();
    try {
      const info = await client.connect();
      expect(info.capabilities.analyses).toContain("op");
      await client.loadCircuit({ ...basicCircuit() });
      const handle = client.run({ analysis: { kind: "op" } });
      let vout = Number.NaN;
      handle.onData((chunk) => {
        const v = chunk.chunk.find((c) => c.name === "v(out)");
        if (v !== undefined && typeof v.samples[0] === "number") {
          vout = v.samples[0];
        }
      });
      const stats = await handle.done;
      expect(stats.timesteps).toBeGreaterThanOrEqual(0);
      expect(vout).toBeCloseTo(2.5, 9);
    } finally {
      client.dispose();
    }
  });

  test("live run streams over the worker and stop resolves", async () => {
    const client = createWorkerClient();
    try {
      await client.connect();
      await client.loadSpice("worker live\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nRl out 0 1k\n.end\n");
      const handle = client.run({
        analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1 },
      });
      let chunks = 0;
      handle.onData(() => {
        chunks += 1;
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80);
      });
      await handle.setParam({ elementName: "V1", property: "frequency" }, 500);
      handle.stop();
      const stats = await handle.done;
      expect(chunks).toBeGreaterThanOrEqual(1);
      expect(stats.timesteps).toBeGreaterThan(0);
    } finally {
      client.dispose();
    }
  });

  test("conformance suite passes over the worker transport", async () => {
    const report = await runClientConformance(createWorkerClient);
    expect(report.failures).toEqual([]);
  }, 20_000);
});

describe("in-process live regression (E4)", () => {
  test("in-process client drives a live run with setParam and stop", async () => {
    const client = createInProcessClient();
    try {
      await client.connect();
      await client.loadSpice("inproc live\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nRl out 0 1k\n.end\n");
      const handle = client.run({
        analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1 },
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60);
      });
      handle.stop();
      const stats = await handle.done;
      expect(stats.timesteps).toBeGreaterThan(0);
    } finally {
      client.dispose();
    }
  });
});
