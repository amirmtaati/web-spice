/**
 * Worker transport (SPEC §2.1 default, E4). The engine runs inside a Web
 * Worker (browser or Bun); messages cross via postMessage — structured
 * clone carries typed arrays, and large samples are transferred zero-copy
 * by listing their buffers in the transfer list.
 *
 * Crash handling (SPEC §6): an `error` or abnormal `exit` event rejects all
 * in-flight requests with a typed error within one event-loop turn (< 1 s)
 * and transparently respawns the worker, so the transport stays usable —
 * hosts re-run `connect()` (and reload the circuit) on the fresh instance.
 */

import type { ClientToEngine, EngineToClient } from "@spicekit/protocol";
import { EngineError } from "@spicekit/protocol";
import type { Transport } from "../transport.ts";

interface MinimalWorker {
  postMessage(message: ClientToEngine, transfer?: Transferable[]): void;
  terminate(): void | Promise<void>;
  addEventListener(type: "message", cb: (event: MessageEvent<EngineToClient>) => void): void;
  addEventListener(type: "error", cb: (event: unknown) => void): void;
  addEventListener(type: "exit", cb: (event: unknown) => void): void;
}

export interface WorkerTransportOptions {
  /** Called when the worker crashed and was respawned (reconnect hint). */
  onCrash?: () => void;
  /**
   * Custom spawn hook for bundlers that need a lexical `new Worker` to emit a
   * worker chunk (e.g. Vite `?worker` imports). When provided, `workerUrl` is
   * only a label/fallback. Optional for backward compatibility.
   */
  workerFactory?: () => MinimalWorker;
}

export function createWorkerTransport(
  workerUrl: URL | string,
  options: WorkerTransportOptions = {},
): Transport {
  return new WorkerTransport(workerUrl, options);
}

class WorkerTransport implements Transport {
  private worker: MinimalWorker | null = null;
  private handler: ((message: EngineToClient) => void) | null = null;
  private readonly onCrash: (() => void) | undefined;
  private readonly workerFactory: (() => MinimalWorker) | undefined;

  constructor(
    private readonly workerUrl: URL | string,
    options: WorkerTransportOptions = {},
  ) {
    this.onCrash = options.onCrash;
    this.workerFactory = options.workerFactory;
  }

  start(): Promise<void> {
    this.spawn();
    return Promise.resolve();
  }

  send(message: ClientToEngine): void {
    if (this.worker === null) {
      this.spawn();
    }
    // Transfer large typed-array buffers zero-copy when present.
    const transfer = collectTransferables(message);
    if (transfer.length > 0) {
      this.worker?.postMessage(message, transfer);
    } else {
      this.worker?.postMessage(message);
    }
  }

  onMessage(handler: (message: EngineToClient) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.handler = null;
    void this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): void {
    const worker =
      this.workerFactory !== undefined
        ? this.workerFactory()
        : new (
            globalThis as unknown as {
              Worker: new (url: URL | string, opts: { type: "module" }) => MinimalWorker;
            }
          ).Worker(this.workerUrl, { type: "module" });
    this.worker = worker;
    worker.addEventListener("message", (event) => {
      this.handler?.(event.data);
    });
    const crashed = (): void => {
      if (this.worker !== worker) {
        return; // already respawned
      }
      this.worker = null;
      // Reject in-flight work on the client side with a typed error.
      this.handler?.({
        id: "*",
        type: "error",
        payload: new EngineError({
          code: "E_PROTOCOL_VERSION",
          message: "worker crashed; a fresh worker has been spawned — reconnect and reload",
        }).toJSON(),
      });
      this.onCrash?.();
    };
    worker.addEventListener("error", crashed);
    worker.addEventListener("exit", (event) => {
      // Normal termination (terminate()) resolves exit with code 0 in some
      // runtimes; treat nonzero/unknown exits as crashes.
      const code = (event as { code?: number } | undefined)?.code;
      if (code === undefined || code !== 0) {
        crashed();
      }
    });
  }
}

/** Buffers of large Float64Array samples in a message, for zero-copy transfer. */
function collectTransferables(message: ClientToEngine): Transferable[] {
  const transfer: Transferable[] = [];
  if (message.type !== "run" && message.type !== "setExternal") {
    return transfer;
  }
  const payload = message.payload as {
    probes?: unknown;
  } & Record<string, unknown>;
  const scan = (value: unknown): void => {
    if (value instanceof Float64Array && value.byteLength >= 4096) {
      transfer.push(value.buffer);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        scan(v);
      }
    } else if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) {
        scan(v);
      }
    }
  };
  scan(payload);
  return transfer;
}
