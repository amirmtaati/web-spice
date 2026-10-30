/**
 * SimulatorClient (SPEC §6): request/response correlation, timeouts, typed
 * errors, and run-handle event routing. The UI never touches the transport.
 *
 * Routing invariant: engine replies carry the originating request id, so a
 * run is tracked from the moment `run()` is called (by request id) and is
 * addressable by its engine-assigned runId once accepted — whichever routing
 * key an event uses, the same entry is found.
 */
import {
  type AnalysisRequest,
  type Circuit,
  type EngineCapabilities,
  EngineError,
  type EngineLimits,
  type EngineToClient,
  isCompatibleProtocol,
  type ParamTarget,
  PROTOCOL_VERSION,
  type ProbeSpec,
  type RunStats,
  type SignalInfo,
} from "@spicekit/protocol";
import type { Transport, Unsubscribe } from "./transport.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface EngineInfo {
  engineVersion: string;
  capabilities: EngineCapabilities;
  limits: EngineLimits;
}

export interface LoadResult {
  nodeTable: { name: string; index: number }[];
  branchTable: { name: string; index: number }[];
  warnings: { code: string; message: string; line?: number }[];
}

export interface StreamOptions {
  mode: "buffered" | "live";
  realtimeFactor?: number;
}

export interface RunRequest {
  analysis: AnalysisRequest;
  stream?: StreamOptions;
  probes?: ProbeSpec[];
}

export interface DataChunk {
  runId: string;
  signals: SignalInfo[];
  tStart: number;
  chunk: { name: string; samples: number[] | Float64Array }[];
}

export interface Progress {
  runId: string;
  fraction: number;
  simTime: number;
}

export interface RunHandle {
  readonly id: string;
  readonly signals: SignalInfo[];
  onData(cb: (chunk: DataChunk) => void): Unsubscribe;
  onProgress(cb: (p: Progress) => void): Unsubscribe;
  pause(): void;
  resume(): void;
  stop(): void;
  step(): void;
  /** Live parameter change (SPEC §4.4); applies at the next accepted step. */
  setParam(target: ParamTarget, value: number): Promise<void>;
  /** Feed an EXTERNAL channel (SPEC §4.4). */
  setExternal(channel: string, v: number | number[]): Promise<void>;
  done: Promise<RunStats>;
}

export interface SimulatorClient {
  /** Handshake; refuses incompatible protocol majors. */
  connect(): Promise<EngineInfo>;
  loadCircuit(circuit: Circuit): Promise<LoadResult>;
  loadSpice(text: string): Promise<LoadResult>;
  run(req: RunRequest): RunHandle;
  /**
   * Evaluate an expression against a math-channel context (E3, SPEC §4.3).
   * Context keys: "v(node)", "i(elem)", or bare parameter names.
   */
  evaluate(expr: string, context?: Record<string, number>): Promise<number>;
  /** Export the loaded circuit back to SPICE text (SPEC §4.3). */
  exportSpice(): Promise<string>;
  dispose(): void;
}

type RunControlOp = "pause" | "resume" | "stop" | "step";

interface Pending {
  resolve: (value: EngineToClient) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RunEntry {
  requestId: string;
  acceptedRunId?: string;
  signals: SignalInfo[];
  dataSubs: Set<(chunk: DataChunk) => void>;
  progressSubs: Set<(p: Progress) => void>;
  resolveDone?: (stats: RunStats) => void;
  rejectDone?: (err: Error) => void;
}

export class SimulatorClientImpl implements SimulatorClient {
  private readonly transport: Transport;
  private readonly pending = new Map<string, Pending>();
  private readonly runsByRunId = new Map<string, RunEntry>();
  private readonly runsByRequestId = new Map<string, RunEntry>();
  private nextId = 1;
  private disposed = false;

  constructor(transport: Transport) {
    this.transport = transport;
    this.transport.onMessage((message) => this.handleMessage(message));
  }

  async connect(): Promise<EngineInfo> {
    // Open the underlying transport (worker spawn / WebSocket handshake).
    await this.transport.start();
    const reply = await this.request({
      id: this.nextRequestId(),
      type: "hello",
      payload: { protocol: PROTOCOL_VERSION },
    });
    if (reply.type !== "ready") {
      throw new EngineError({
        code: "E_PROTOCOL_VERSION",
        message: `Unexpected handshake reply: ${reply.type}`,
      });
    }
    const { engineVersion, capabilities, limits } = reply.payload;
    const wireProtocol = engineVersion.split("+")[0] ?? engineVersion;
    if (!isCompatibleProtocol(wireProtocol)) {
      throw new EngineError({
        code: "E_PROTOCOL_VERSION",
        message: `Engine protocol ${wireProtocol} is incompatible with client protocol ${PROTOCOL_VERSION}`,
      });
    }
    return { engineVersion, capabilities, limits };
  }

  async loadCircuit(circuit: Circuit): Promise<LoadResult> {
    const reply = await this.request({
      id: this.nextRequestId(),
      type: "loadCircuit",
      payload: { circuit },
    });
    return this.expectLoadResult(reply);
  }

  async loadSpice(text: string): Promise<LoadResult> {
    const reply = await this.request({
      id: this.nextRequestId(),
      type: "loadSpice",
      payload: { text },
    });
    return this.expectLoadResult(reply);
  }

  async evaluate(expr: string, context?: Record<string, number>): Promise<number> {
    const payload: { expr: string; context?: Record<string, number> } = { expr };
    if (context !== undefined) {
      payload.context = context;
    }
    const reply = await this.request({ id: this.nextRequestId(), type: "evaluate", payload });
    if (reply.type !== "evaluateResult") {
      throw reply.type === "error"
        ? new EngineError({
            code: reply.payload.code,
            message: reply.payload.message,
          })
        : new EngineError({
            code: "E_PROTOCOL_VERSION",
            message: `Unexpected evaluate reply: ${reply.type}`,
          });
    }
    return reply.payload.value;
  }

  async exportSpice(): Promise<string> {
    const reply = await this.request({ id: this.nextRequestId(), type: "exportSpice" });
    if (reply.type !== "spice") {
      throw reply.type === "error"
        ? new EngineError({
            code: reply.payload.code,
            message: reply.payload.message,
          })
        : new EngineError({
            code: "E_PROTOCOL_VERSION",
            message: `Unexpected exportSpice reply: ${reply.type}`,
          });
    }
    return reply.payload.text;
  }

  run(req: RunRequest): RunHandle {
    const requestId = this.nextRequestId();
    const entry: RunEntry = {
      requestId,
      signals: [],
      dataSubs: new Set(),
      progressSubs: new Set(),
    };
    this.runsByRequestId.set(requestId, entry);
    const handle = this.createHandle(entry);

    const payload: { analysis: AnalysisRequest; stream?: StreamOptions; probes?: ProbeSpec[] } = {
      analysis: req.analysis,
    };
    if (req.stream !== undefined) {
      payload.stream = req.stream;
    }
    if (req.probes !== undefined) {
      payload.probes = req.probes;
    }
    void this.request({ id: requestId, type: "run", payload }).catch((err: unknown) => {
      // The request itself failed (timeout/dispose): fail the run handle.
      this.finishRun(entry, err instanceof Error ? err : new Error(String(err)));
    });
    return handle;
  }

  dispose(): void {
    this.disposed = true;
    const err = new EngineError({ code: "E_PROTOCOL_VERSION", message: "Client disposed" });
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    for (const entry of this.runsByRequestId.values()) {
      entry.rejectDone?.(err);
    }
    this.runsByRequestId.clear();
    this.runsByRunId.clear();
    this.transport.close();
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private nextRequestId(): string {
    const id = `req-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private request(message: ClientRequestMessage): Promise<EngineToClient> {
    if (this.disposed) {
      return Promise.reject(
        new EngineError({ code: "E_PROTOCOL_VERSION", message: "Client disposed" }),
      );
    }
    return new Promise<EngineToClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(
          new EngineError({
            code: "E_LIMIT_EXCEEDED",
            message: `Request ${message.type} timed out`,
          }),
        );
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(message.id, { resolve, reject, timer });
      this.transport.send(message);
    });
  }

  private createHandle(entry: RunEntry): RunHandle {
    // Arrow-function properties capture `this` lexically from createHandle;
    // getters preserve the readonly surface of RunHandle.
    return {
      get id(): string {
        return entry.acceptedRunId ?? entry.requestId;
      },
      get signals(): SignalInfo[] {
        return entry.signals;
      },
      onData: (cb: (chunk: DataChunk) => void): Unsubscribe => {
        entry.dataSubs.add(cb);
        return () => {
          entry.dataSubs.delete(cb);
        };
      },
      onProgress: (cb: (p: Progress) => void): Unsubscribe => {
        entry.progressSubs.add(cb);
        return () => {
          entry.progressSubs.delete(cb);
        };
      },
      pause: () => this.sendControl(entry, "pause"),
      resume: () => this.sendControl(entry, "resume"),
      stop: () => this.sendControl(entry, "stop"),
      step: () => this.sendControl(entry, "step"),
      setParam: async (target: ParamTarget, value: number): Promise<void> => {
        await this.runRequest({
          type: "setParam",
          payload: { runId: entry.acceptedRunId ?? "", target, value },
        });
      },
      setExternal: async (channel: string, v: number | number[]): Promise<void> => {
        await this.runRequest({
          type: "setExternal",
          payload: { runId: entry.acceptedRunId ?? "", channel, value: v },
        });
      },
      get done(): Promise<RunStats> {
        return new Promise<RunStats>((resolve, reject) => {
          entry.resolveDone = resolve;
          entry.rejectDone = reject;
        });
      },
    };
  }

  /** Fire-and-forget run control (failures surface through `done`). */
  private sendControl(entry: RunEntry, op: RunControlOp): void {
    void this.runRequest({
      type: "control",
      payload: { runId: entry.acceptedRunId ?? "", op },
    }).catch(() => {});
  }

  /** Correlated request inside a run; resolves on the ack/reply. */
  private runRequest(part: {
    type: "control" | "setParam" | "setExternal";
    payload: unknown;
  }): Promise<EngineToClient> {
    const id = this.nextRequestId();
    return this.request({ id, ...part } as ClientRequestMessage).then((reply) => {
      if (reply.type === "error") {
        throw new EngineError(reply.payload);
      }
      return reply;
    });
  }

  private finishRun(entry: RunEntry, err?: Error): void {
    this.runsByRequestId.delete(entry.requestId);
    if (entry.acceptedRunId !== undefined) {
      this.runsByRunId.delete(entry.acceptedRunId);
    }
    if (err !== undefined) {
      entry.rejectDone?.(err);
    }
  }

  private expectLoadResult(reply: EngineToClient): LoadResult {
    if (reply.type === "loadResult") {
      return reply.payload;
    }
    if (reply.type === "error") {
      throw new EngineError(reply.payload);
    }
    throw new EngineError({
      code: "E_PROTOCOL_VERSION",
      message: `Unexpected load reply: ${reply.type}`,
    });
  }

  private handleMessage(message: EngineToClient): void {
    // 1) Correlated replies (ready, loadResult, runAccepted, spice, errors…).
    const pending = this.pending.get(message.id);
    if (pending !== undefined) {
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.type === "error") {
        pending.reject(new EngineError(message.payload));
      } else {
        pending.resolve(message);
      }
      // A runAccepted reply also promotes its run entry to the runId index.
      if (message.type === "runAccepted") {
        const entry = this.runsByRequestId.get(message.id);
        if (entry !== undefined) {
          entry.acceptedRunId = message.payload.runId;
          this.runsByRunId.set(message.payload.runId, entry);
        }
      }
      return;
    }

    // 2) Run lifecycle events (data, progress, done, run errors). These may
    //    arrive before the runAccepted continuation runs, so fall back to the
    //    request-id index. Non-run messages here are ignored safely.
    const isRunEvent =
      message.type === "data" ||
      message.type === "progress" ||
      message.type === "done" ||
      message.type === "error";
    if (!isRunEvent) {
      return;
    }
    const runId = message.type === "error" ? undefined : message.payload.runId;
    const entry =
      (runId !== undefined ? this.runsByRunId.get(runId) : undefined) ??
      this.runsByRequestId.get(message.id);
    if (entry === undefined) {
      return; // late event after dispose, or unknown run — ignore safely
    }

    switch (message.type) {
      case "data": {
        const chunk = message.payload;
        entry.signals = chunk.signals;
        for (const cb of entry.dataSubs) {
          cb(chunk);
        }
        return;
      }
      case "progress": {
        for (const cb of entry.progressSubs) {
          cb(message.payload);
        }
        return;
      }
      case "done": {
        this.finishRun(entry);
        entry.resolveDone?.(message.payload.stats);
        return;
      }
      case "error": {
        this.finishRun(entry, new EngineError(message.payload));
        return;
      }
    }
  }
}

type ClientRequestMessage =
  | { id: string; type: "hello"; payload: { protocol: string } }
  | { id: string; type: "loadCircuit"; payload: { circuit: Circuit } }
  | { id: string; type: "loadSpice"; payload: { text: string } }
  | {
      id: string;
      type: "run";
      payload: { analysis: AnalysisRequest; stream?: StreamOptions; probes?: ProbeSpec[] };
    }
  | { id: string; type: "control"; payload: { runId: string; op: RunControlOp } }
  | {
      id: string;
      type: "setParam";
      payload: { runId: string; target: ParamTarget; value: number };
    }
  | {
      id: string;
      type: "setExternal";
      payload: { runId: string; channel: string; value: number | number[] };
    }
  | { id: string; type: "evaluate"; payload: { expr: string; context?: Record<string, number> } }
  | { id: string; type: "exportSpice" };
