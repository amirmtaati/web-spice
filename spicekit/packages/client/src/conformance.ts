/**
 * Conformance suite (SPEC §6): every transport must pass the same checks —
 * handshake, loading, buffered runs with correct values, live streaming with
 * control + setParam, evaluate, exportSpice, and typed error surfaces.
 * Returns a report instead of throwing, so hosts can aggregate results
 * across transports (and, in CI, across browsers).
 */

import type { Circuit } from "@spicekit/protocol";
import { DEFAULT_SIM_OPTIONS, EngineError } from "@spicekit/protocol";
import type { SimulatorClient } from "./client.ts";

export interface ConformanceReport {
  passed: boolean;
  failures: { check: string; error: string }[];
}

/** Minimal resistive-divider circuit IR used by the checks. */
export function basicCircuit(): Circuit {
  return {
    title: "Conformance divider",
    elements: [
      { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
      { type: "R", name: "R1", n: ["in", "out"], value: "1k" },
      { type: "R", name: "Rl", n: ["out", "0"], value: "1k" },
    ],
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [{ kind: "op" }],
    probes: [],
  };
}

const LIVE_NETLIST = `conformance live
V1 in 0 SIN(0 1 1k)
R1 in out 10k
C1 out 0 1u
.tran 100u 1
.end
`;

interface Check {
  name: string;
  run: (client: SimulatorClient) => Promise<void>;
}

const CHECKS: readonly Check[] = [
  {
    name: "handshake advertises engine version and limits",
    run: async (client) => {
      const info = await client.connect();
      if (info.engineVersion.length === 0) {
        throw new Error("empty engineVersion");
      }
      if (info.limits.maxElements <= 0) {
        throw new Error("engine must advertise resource limits");
      }
      if (!info.capabilities.analyses.includes("op")) {
        throw new Error("capabilities must list analyses");
      }
    },
  },
  {
    name: "loadCircuit returns the node table",
    run: async (client) => {
      const result = await client.loadCircuit({ ...basicCircuit() });
      if (!result.nodeTable.some((n) => n.name === "in")) {
        throw new Error("node table missing 'in'");
      }
      if (!result.nodeTable.some((n) => n.name === "out")) {
        throw new Error("node table missing 'out'");
      }
    },
  },
  {
    name: "loadSpice compiles a netlist and surfaces node/branch tables",
    run: async (client) => {
      const result = await client.loadSpice(
        "conf load\nV1 in 0 5\nR1 in out 1k\nRl out 0 1k\n.end\n",
      );
      if (!result.nodeTable.some((n) => n.name === "out")) {
        throw new Error("node table missing 'out'");
      }
      if (!result.branchTable.some((b) => b.name.toLowerCase() === "v1")) {
        throw new Error("branch table missing V1");
      }
    },
  },
  {
    name: "invalid netlist is a typed EngineError",
    run: async (client) => {
      try {
        await client.loadSpice("R1 a\n");
        throw new Error("expected loadSpice to reject");
      } catch (err) {
        if (!(err instanceof EngineError)) {
          throw new Error(`expected EngineError, got ${String(err)}`);
        }
      }
    },
  },
  {
    name: "buffered op run completes with stats and correct divider value",
    run: async (client) => {
      await client.loadCircuit({ ...basicCircuit() });
      const handle = client.run({ analysis: { kind: "op" } });
      let got = Number.NaN;
      handle.onData((chunk) => {
        const vout = chunk.chunk.find((c) => c.name === "v(out)");
        if (vout !== undefined && typeof vout.samples[0] === "number") {
          got = vout.samples[0];
        }
      });
      const stats = await handle.done;
      if (stats.timesteps < 0) {
        throw new Error("negative timestep count");
      }
      if (Math.abs(got - 2.5) > 1e-9) {
        throw new Error(`op v(out) = ${got}, expected 2.5`);
      }
    },
  },
  {
    name: "buffered tran run streams samples ending near the settled value",
    run: async (client) => {
      await client.loadSpice("conf tran\nV1 in 0 DC 5\nR1 in out 1k\nC1 out 0 1u\n.end\n");
      const handle = client.run({
        analysis: { kind: "tran", tstep: 1e-4, tstop: 5e-3 },
      });
      const chunkPromise = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no tran data chunk")), 3000);
        void timer;
        handle.onData((chunk) => {
          const vout = chunk.chunk.find((c) => c.name === "v(out)");
          const last = vout?.samples[vout.samples.length - 1];
          if (typeof last === "number") {
            clearTimeout(timer);
            resolve(last);
          }
        });
      });
      await handle.done;
      const last = await chunkPromise;
      // Default initial condition = DC OP → cap starts at 5 V and stays.
      if (Math.abs(last - 5) > 1e-6) {
        throw new Error(`tran v(out) ended at ${last}, expected 5 (DC steady state)`);
      }
    },
  },
  {
    name: "live run streams chunks, setParam acks, stop resolves done",
    run: async (client) => {
      await client.loadSpice(LIVE_NETLIST);
      const handle = client.run({
        analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 },
        stream: { mode: "live", realtimeFactor: 1 },
      });
      let chunks = 0;
      handle.onData(() => {
        chunks += 1;
      });
      // Let the engine tick a few times.
      await sleep(60);
      await handle.setParam({ elementName: "V1", property: "frequency" }, 500);
      await sleep(30);
      handle.stop();
      const stats = await handle.done;
      if (chunks < 1) {
        throw new Error("live run produced no data chunks");
      }
      if (stats.timesteps <= 0) {
        throw new Error("live run recorded no timesteps");
      }
    },
  },
  {
    name: "evaluate computes over a caller context",
    run: async (client) => {
      const value = await client.evaluate("v(out) * 2 + gain", { "v(out)": 1.5, gain: 0.5 });
      if (Math.abs(value - 3.5) > 1e-12) {
        throw new Error(`evaluate returned ${value}, expected 3.5`);
      }
    },
  },
  {
    name: "exportSpice round-trips the loaded circuit",
    run: async (client) => {
      await client.loadCircuit({ ...basicCircuit() });
      const text = await client.exportSpice();
      if (!text.toLowerCase().includes("r1")) {
        throw new Error("exportSpice lost R1");
      }
    },
  },
  {
    name: "second handshake on a live client is refused or idempotent-safe",
    run: async (client) => {
      // Must not crash the engine; either resolves again or throws EngineError.
      try {
        await client.connect();
      } catch (err) {
        if (!(err instanceof EngineError)) {
          throw err;
        }
      }
    },
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Run all conformance checks against a freshly created client. */
export async function runClientConformance(
  create: () => SimulatorClient,
): Promise<ConformanceReport> {
  const failures: ConformanceReport["failures"] = [];
  const client = create();
  try {
    for (const check of CHECKS) {
      try {
        await check.run(client);
      } catch (err) {
        failures.push({
          check: check.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    client.dispose();
  }
  return { passed: failures.length === 0, failures };
}
