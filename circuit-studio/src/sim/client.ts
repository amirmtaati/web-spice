/**
 * sim/ — the ONLY module in circuit-studio that imports @spicekit/client
 * (SPEC §3.2 architecture rule, enforced by dependency-cruiser).
 *
 * The UI obtains the engine exclusively through `getSimulatorClient()`.
 * The default transport switches to the Web Worker when E4 lands; the
 * in-process stub keeps the shell honest until then.
 */
import { createInProcessClient, type SimulatorClient } from "@spicekit/client";

let instance: SimulatorClient | null = null;

export function getSimulatorClient(): SimulatorClient {
  if (instance === null) {
    // TODO(E4): default to createWorkerClient(); keep in-process for tests.
    instance = createInProcessClient();
  }
  return instance;
}
