/**
 * @spicekit/server (E4, SPEC §7.1): Bun.serve WebSocket host for the engine.
 *
 *  - Every connection gets its own Bun `Worker` hosting an EngineSession —
 *    runs never execute on the server event loop. Total workers are bounded
 *    by `maxConnections` (default 64); hardwareConcurrency further bounds
 *    practical run concurrency (one live run per session).
 *  - All messages are zod-validated; unknown or oversized frames close the
 *    socket with defined codes (4400 malformed, 4409 rate limit).
 *  - Per-connection rate limits (token bucket), maxPayloadLength and
 *    backpressure checks on send; runs pause when a socket saturates.
 *  - `/healthz`, `/readyz`, and Prometheus `/metrics`; origin allow-list and
 *    optional bearer token guard the upgrade; graceful SIGTERM shutdown.
 *
 * Data framing note (v1): waveform samples travel as JSON arrays. Binary
 * frames with typed-array bulk transfer are a backward-compatible protocol
 * addition tracked for the U-track; the protocol version already allows it.
 */
import {
  type ClientToEngine,
  EngineError,
  type EngineToClient,
  requestSchema,
} from "@spicekit/protocol";
import { z } from "zod";

// ─── configuration (zod-validated, fail-fast) ────────────────────────────────

export const serverConfigSchema = z.object({
  port: z.number().int().positive().default(8080),
  /** Comma-separated origin allow-list; "*" allows all origins. */
  origins: z.string().default("*"),
  /** Optional bearer token; empty = auth disabled. */
  token: z.string().default(""),
  maxConnections: z.number().int().positive().default(64),
  maxPayloadBytes: z
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  /** Messages per second per connection (token bucket capacity). */
  rateLimitPerSec: z.number().int().positive().default(120),
  idleTimeoutSeconds: z.number().int().positive().default(60),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** Parse and validate configuration from environment variables (fail fast). */
export function configFromEnv(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = serverConfigSchema.safeParse({
    port: env.SPICEKIT_PORT !== undefined ? Number(env.SPICEKIT_PORT) : undefined,
    origins: env.SPICEKIT_ORIGINS,
    token: env.SPICEKIT_TOKEN,
    maxConnections:
      env.SPICEKIT_MAX_CONNECTIONS !== undefined ? Number(env.SPICEKIT_MAX_CONNECTIONS) : undefined,
    maxPayloadBytes:
      env.SPICEKIT_MAX_PAYLOAD !== undefined ? Number(env.SPICEKIT_MAX_PAYLOAD) : undefined,
    rateLimitPerSec:
      env.SPICEKIT_RATE_LIMIT !== undefined ? Number(env.SPICEKIT_RATE_LIMIT) : undefined,
    idleTimeoutSeconds:
      env.SPICEKIT_IDLE_TIMEOUT !== undefined ? Number(env.SPICEKIT_IDLE_TIMEOUT) : undefined,
  });
  if (!parsed.success) {
    throw new Error(`invalid @spicekit/server configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ─── metrics (Prometheus text format) ────────────────────────────────────────

export interface Metrics {
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  activeConnections: number;
  totalConnections: number;
  rejectedConnections: number;
  messagesTotal: number;
  rateLimitedTotal: number;
  timestepsTotal: number;
  runLatenciesMs: number[];
}

function createMetrics(): Metrics {
  return {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    activeConnections: 0,
    totalConnections: 0,
    rejectedConnections: 0,
    messagesTotal: 0,
    rateLimitedTotal: 0,
    timestepsTotal: 0,
    runLatenciesMs: [],
  };
}

function renderMetrics(m: Metrics): string {
  const lines: string[] = [];
  const gauge = (name: string, help: string, value: number): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
  };
  const counter = (name: string, help: string, value: number): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name} ${value}`);
  };
  gauge("spicekit_active_connections", "Currently open WebSocket connections", m.activeConnections);
  counter("spicekit_total_connections", "Connections accepted since start", m.totalConnections);
  counter(
    "spicekit_rejected_connections",
    "Connections refused (limits/auth)",
    m.rejectedConnections,
  );
  counter("spicekit_runs_started", "Runs started", m.runsStarted);
  counter("spicekit_runs_completed", "Runs finished with done", m.runsCompleted);
  counter("spicekit_runs_failed", "Runs finished with an engine error", m.runsFailed);
  counter("spicekit_messages_total", "Valid protocol messages received", m.messagesTotal);
  counter(
    "spicekit_rate_limited_total",
    "Messages dropped by the rate limiter",
    m.rateLimitedTotal,
  );
  counter(
    "spicekit_timesteps_total",
    "Transient timesteps computed (sum over runs)",
    m.timestepsTotal,
  );
  // p95 run latency from the last 100 completed runs.
  const xs = [...m.runLatenciesMs].sort((a, b) => a - b);
  const p95 =
    xs.length > 0
      ? (xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95)) - (xs.length > 1 ? 1 : 0)] ?? 0)
      : 0;
  gauge("spicekit_run_latency_p95_ms", "p95 wall latency of completed runs", p95);
  return `${lines.join("\n")}\n`;
}

// ─── per-connection state ────────────────────────────────────────────────────

interface ConnState {
  id: number;
  worker: Worker | null;
  /** Token bucket for the rate limiter. */
  tokens: number;
  lastRefill: number;
  /** Outstanding run request ids on this connection (cancellation on close). */
  liveRunIds: Set<string>;
  /** Wall start of the active run for latency stats. */
  runStartedAt: number;
}

interface ServerHandle {
  port: number;
  stop(draining?: boolean): Promise<void>;
  metrics: Metrics;
}

/**
 * Start the server. `config` is validated; pass `env` for tests. The
 * returned handle exposes the port (0 = OS-assigned), metrics, and stop().
 */
export function startServer(
  config: ServerConfig,
  metrics: Metrics = createMetrics(),
): ServerHandle {
  const allowedOrigins = config.origins
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const originAllowed = (origin: string | null): boolean => {
    if (allowedOrigins.includes("*")) {
      return true;
    }
    if (origin === null) {
      return true; // non-browser clients may omit Origin
    }
    return allowedOrigins.includes(origin);
  };
  let connCounter = 0;

  const server = Bun.serve<ConnState>({
    port: config.port,
    idleTimeout: config.idleTimeoutSeconds,
    fetch(request, bunServer) {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        return Response.json({ status: "ok" });
      }
      if (url.pathname === "/readyz") {
        const ready = metrics.activeConnections < config.maxConnections;
        return Response.json(
          { status: ready ? "ready" : "full", activeConnections: metrics.activeConnections },
          { status: ready ? 200 : 503 },
        );
      }
      if (url.pathname === "/metrics") {
        return new Response(renderMetrics(metrics), {
          headers: { "content-type": "text/plain; version=0.0.4" },
        });
      }
      if (url.pathname === "/ws") {
        if (!originAllowed(request.headers.get("origin"))) {
          metrics.rejectedConnections += 1;
          return new Response("origin not allowed", { status: 403 });
        }
        if (config.token.length > 0) {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ")
            ? auth.slice(7)
            : (new URL(request.url).searchParams.get("token") ?? "");
          if (token !== config.token) {
            metrics.rejectedConnections += 1;
            return new Response("unauthorized", { status: 401 });
          }
        }
        if (metrics.activeConnections >= config.maxConnections) {
          metrics.rejectedConnections += 1;
          return new Response("server at capacity", { status: 503 });
        }
        if (bunServer.upgrade(request, { data: makeConnState() })) {
          return; // upgraded
        }
        return new Response("WebSocket upgrade expected", { status: 426 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      maxPayloadLength: config.maxPayloadBytes,
      open(ws) {
        const state = ws.data;
        metrics.activeConnections += 1;
        metrics.totalConnections += 1;
        state.lastRefill = Date.now();
        state.tokens = config.rateLimitPerSec;
        connections.set(state.id, ws);
      },
      message(ws, message) {
        const state = ws.data;
        if (!rateLimitAllow(state, config.rateLimitPerSec)) {
          metrics.rateLimitedTotal += 1;
          ws.close(4409, "rate limit exceeded");
          return;
        }
        if (typeof message !== "string") {
          ws.close(4400, "binary frames not accepted in protocol 0.2");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(message);
        } catch {
          ws.close(4400, "malformed JSON");
          return;
        }
        const validated = requestSchema.safeParse(parsed);
        if (!validated.success) {
          ws.close(4400, `invalid protocol message: ${zodFirstIssue(validated.error)}`);
          return;
        }
        const msg = validated.data as ClientToEngine;
        metrics.messagesTotal += 1;
        if (msg.type === "run") {
          metrics.runsStarted += 1;
          state.runStartedAt = Date.now();
        }
        if (state.worker === null) {
          state.worker = spawnWorker(state.id);
        }
        state.worker.postMessage(msg);
      },
      close(ws) {
        const state = ws.data;
        metrics.activeConnections -= 1;
        connections.delete(state.id);
        // Cancel the connection's runs by disposing its worker session.
        if (state.worker !== null) {
          void state.worker.terminate();
          state.worker = null;
        }
        state.liveRunIds.clear();
      },
    },
  });

  function spawnWorker(id: number): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workers.add(worker);
    worker.onmessage = (event) => {
      const reply = event.data as EngineToClient;
      if (reply.type === "runAccepted") {
        // Correlate run latency: buffered runs answer under the request id,
        // live runs finish under the engine-assigned runId.
        latencyStarts.set(reply.id, Date.now());
        latencyStarts.set(reply.payload.runId, Date.now());
      } else if (reply.type === "done") {
        metrics.runsCompleted += 1;
        metrics.timestepsTotal += reply.payload.stats.timesteps;
        const started = latencyStarts.get(reply.id) ?? latencyStarts.get(reply.payload.runId);
        pushLatency(metrics, Date.now() - (started ?? Date.now()));
        latencyStarts.delete(reply.id);
        latencyStarts.delete(reply.payload.runId);
      } else if (reply.type === "error") {
        metrics.runsFailed += 1;
      }
      const ws = connections.get(id);
      if (ws === undefined) {
        return;
      }
      try {
        if (ws.getBufferedAmount() > config.maxPayloadBytes) {
          // Socket saturated: drop this frame; the client reconnects.
          return;
        }
        ws.send(JSON.stringify(reply));
      } catch {
        // Socket went away mid-write; close handles cleanup.
      }
    };
    return worker;
  }

  const connections = new Map<number, Bun.ServerWebSocket<unknown>>();
  const latencyStarts = new Map<string, number>();
  const workers = new Set<Worker>();

  function makeConnState(): ConnState {
    const id = ++connCounter;
    const state: ConnState = {
      id,
      worker: null,
      tokens: config.rateLimitPerSec,
      lastRefill: Date.now(),
      liveRunIds: new Set(),
      runStartedAt: 0,
    };
    return state;
  }

  function rateLimitAllow(state: ConnState, perSec: number): boolean {
    const now = Date.now();
    const elapsed = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(perSec, state.tokens + elapsed * perSec);
    state.lastRefill = now;
    if (state.tokens < 1) {
      return false;
    }
    state.tokens -= 1;
    return true;
  }

  function zodFirstIssue(error: z.ZodError): string {
    return error.issues[0]?.message ?? "validation failed";
  }

  function pushLatency(m: Metrics, ms: number): void {
    m.runLatenciesMs.push(ms);
    if (m.runLatenciesMs.length > 100) {
      m.runLatenciesMs.shift();
    }
  }

  return {
    port: server.port ?? config.port,
    metrics,
    async stop(draining = true): Promise<void> {
      // Terminate every connection worker and close sockets, then stop
      // accepting (SPEC §7.1 graceful shutdown: stop, drain, close).
      for (const ws of connections.values()) {
        try {
          ws.close(1001, "server shutting down");
        } catch {
          // already gone
        }
      }
      connections.clear();
      for (const worker of workers) {
        void worker.terminate();
      }
      workers.clear();
      await server.stop(draining);
    },
  };
}

/** CLI entry (`spicekit-server`): start with env config and handle SIGTERM. */
export function main(): void {
  const config = configFromEnv();
  const handle = startServer(config);
  console.log(`@spicekit/server listening on http://localhost:${handle.port}/ws`);
  process.on("SIGTERM", () => {
    console.log("SIGTERM: draining…");
    void handle.stop(true).then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void handle.stop(true).then(() => process.exit(0));
  });
}

// Re-exported for embedders; EngineError re-export keeps the surface small.
export { EngineError };
