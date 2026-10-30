/**
 * sim/ — the ONLY module in circuit-studio that imports @spicekit/client
 * (SPEC §3.2 architecture rule, enforced by dependency-cruiser).
 *
 * The UI obtains the engine exclusively through `getSimulatorClient()`.
 * Default transport: Web Worker (UX0-T6, AGENTS.md W0) — parsing, compile,
 * and solve run off the UI thread. `?transport=in-process` overrides for
 * tests and debugging.
 */
import { createInProcessClient, createWorkerClient, type SimulatorClient } from "@spicekit/client";
// Vite's `?worker` import is the lexical `new Worker` the bundler needs to
// emit the engine worker chunk (the transport's default spawn is dynamic).
import EngineWorker from "./engine.worker.ts?worker";

let instance: SimulatorClient | null = null;

type TransportChoice = "worker" | "in-process";

export function resolveTransport(
  search: string = globalThis.location?.search ?? "",
): TransportChoice {
  return new URLSearchParams(search).get("transport") === "in-process" ? "in-process" : "worker";
}

export function getSimulatorClient(): SimulatorClient {
  if (instance === null) {
    instance =
      resolveTransport() === "in-process"
        ? createInProcessClient()
        : createWorkerClient(new URL("./engine.worker.ts", import.meta.url), {
            workerFactory: () => new EngineWorker(),
          });
  }
  return instance;
}

/** Test seam: inject a client (e.g. conformance in-process stub) and reset. */
export function setSimulatorClientForTests(client: SimulatorClient | null): void {
  instance = client;
}
