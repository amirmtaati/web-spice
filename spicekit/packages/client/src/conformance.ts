/**
 * Conformance suite (SPEC §6): every transport must pass the same checks.
 * Returns a report instead of throwing, so hosts can aggregate results across
 * transports (and, in CI, across browsers).
 */
import { EngineError } from "@spicekit/protocol";
import type { SimulatorClient } from "./client.ts";
import { stubCircuit } from "./stub-engine.ts";

export interface ConformanceReport {
  passed: boolean;
  failures: { check: string; error: string }[];
}

interface Check {
  name: string;
  run: (client: SimulatorClient) => Promise<void>;
}

const CHECKS: readonly Check[] = [
  {
    name: "handshake",
    run: async (client) => {
      const info = await client.connect();
      if (info.engineVersion.length === 0) {
        throw new Error("empty engineVersion");
      }
      if (info.limits.maxElements <= 0) {
        throw new Error("engine must advertise resource limits");
      }
    },
  },
  {
    name: "loadCircuit returns node table",
    run: async (client) => {
      const result = await client.loadCircuit({ ...stubCircuit() });
      if (!result.nodeTable.some((n) => n.name === "in")) {
        throw new Error("node table missing 'in'");
      }
    },
  },
  {
    name: "loadSpice rejects invalid/unparsed input with a typed error",
    run: async (client) => {
      try {
        await client.loadSpice("* not parseable by the stub engine\n");
        throw new Error("expected loadSpice to reject");
      } catch (err) {
        if (!(err instanceof EngineError)) {
          throw new Error(`expected EngineError, got ${String(err)}`);
        }
      }
    },
  },
  {
    name: "run op completes with stats",
    run: async (client) => {
      const handle = client.run({ analysis: { kind: "op" } });
      const stats = await handle.done;
      if (stats.timesteps < 0) {
        throw new Error("negative timestep count");
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
