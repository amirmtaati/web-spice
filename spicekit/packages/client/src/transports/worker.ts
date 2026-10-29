/**
 * Worker transport (SPEC §2.1 default). The engine is bundled into a Web
 * Worker; messages cross via postMessage with transferable typed arrays for
 * bulk data. Full implementation (worker entry, crash detection < 1 s with
 * restart, transferable streaming) lands with E4 — SPEC §22.
 */
import { EngineError } from "@spicekit/protocol";
import type { Transport } from "../transport.ts";

export function createWorkerTransport(_workerUrl: URL | string): Transport {
  void _workerUrl;
  throw new EngineError({
    code: "E_NOT_IMPLEMENTED",
    message: "Worker transport lands with milestone E4 (SPEC §22).",
  });
}
