/**
 * @spicekit/server tests (E4, SPEC §7.1): conformance over a real
 * `Bun.serve` WebSocket, plus chaos — malformed frames, oversized payloads,
 * rate-limit bursts, abrupt disconnects mid-live-run, auth, and origin
 * enforcement. Uses OS-assigned ports (port 0).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createWebSocketClient, runClientConformance } from "@spicekit/client";
import { configFromEnv, type ServerConfig, type ServerHandle, startServer } from "../src/index.ts";

let server: ServerHandle;
let url: string;

beforeAll(() => {
  const config: ServerConfig = {
    port: 0,
    origins: "*",
    token: "",
    maxConnections: 8,
    maxPayloadBytes: 64 * 1024,
    rateLimitPerSec: 200,
    idleTimeoutSeconds: 60,
  };
  server = startServer(config);
  url = `ws://localhost:${server.port}/ws`;
});

afterAll(async () => {
  // Guard against a hung stop(): Bun's stop waits on lingering sockets;
  // tests close everything, so a 2s cap is generous.
  await Promise.race([
    server.stop(true),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    }),
  ]);
});

function rawSocket(): WebSocket {
  return new WebSocket(url);
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("open failed")), { once: true });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 0, reason: "" });
      return;
    }
    ws.addEventListener(
      "close",
      (event) => {
        const e = event as CloseEvent;
        resolve({ code: e.code, reason: e.reason });
      },
      { once: true },
    );
  });
}

describe("server endpoints", () => {
  test("/healthz and /readyz report status", async () => {
    const health = await fetch(`http://localhost:${server.port}/healthz`);
    expect(health.status).toBe(200);
    const ready = await fetch(`http://localhost:${server.port}/readyz`);
    expect(ready.status).toBe(200);
  });

  test("/metrics exposes Prometheus counters", async () => {
    const res = await fetch(`http://localhost:${server.port}/metrics`);
    const text = await res.text();
    expect(text).toContain("spicekit_active_connections");
    expect(text).toContain("spicekit_runs_started");
    expect(text).toContain("spicekit_run_latency_p95_ms");
  });
});

describe("WebSocket conformance (real Bun.serve)", () => {
  test("all conformance checks pass over WebSocket", async () => {
    const report = await runClientConformance(() => createWebSocketClient(url));
    expect(report.failures).toEqual([]);
  }, 30_000);
});

describe("server chaos and limits", () => {
  test("malformed JSON closes with 4400", async () => {
    const ws = rawSocket();
    await waitForOpen(ws);
    ws.send("{not json");
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(4400);
  });

  test("invalid protocol message closes with 4400", async () => {
    const ws = rawSocket();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ id: "1", type: "timeTravel" }));
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(4400);
  });

  test("oversized frame is rejected by maxPayloadLength", async () => {
    const ws = rawSocket();
    await waitForOpen(ws);
    ws.send("x".repeat(128 * 1024)); // maxPayloadBytes is 64 KiB
    const closed = await waitForClose(ws);
    // Bun may drop the connection abruptly (1006) or emit a proper close.
    expect([4400, 1009, 1006]).toContain(closed.code);
  });

  test("rate-limit burst closes with 4409", async () => {
    const ws = rawSocket();
    await waitForOpen(ws);
    // Config allows 200/s; fire 400 tiny valid messages instantly.
    const msg = JSON.stringify({ id: "rl", type: "exportSpice" });
    for (let i = 0; i < 400; i++) {
      try {
        ws.send(msg);
      } catch {
        break;
      }
    }
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(4409);
  });

  test("abrupt disconnect mid-live-run keeps the server healthy", async () => {
    // Start a live run, then vanish.
    const ws = rawSocket();
    await waitForOpen(ws);
    const load = {
      id: "l1",
      type: "loadSpice",
      payload: { text: "chaos\nV1 a 0 1\nR1 a 0 1k\n.end\n" },
    };
    ws.send(JSON.stringify(load));
    ws.send(
      JSON.stringify({
        id: "r1",
        type: "run",
        payload: {
          analysis: { kind: "tran", tstep: 1e-4, tstop: 1e9 },
          stream: { mode: "live", realtimeFactor: 1 },
        },
      }),
    );
    await sleep(60);
    ws.close(1006, "client vanished");
    await waitForClose(ws);
    // Give the server a beat to tear down the worker, then verify health.
    await sleep(60);
    const health = await fetch(`http://localhost:${server.port}/healthz`);
    expect(health.status).toBe(200);
    const metrics = await (await fetch(`http://localhost:${server.port}/metrics`)).text();
    expect(metrics).toMatch(/spicekit_active_connections 0/);
    // A fresh connection still works end-to-end.
    const client = createWebSocketClient(url);
    try {
      await client.connect();
      await client.loadSpice("fresh\nV1 a 0 1\nR1 a 0 1k\n.end\n");
      const handle = client.run({ analysis: { kind: "op" } });
      const stats = await handle.done;
      expect(stats.timesteps).toBeGreaterThanOrEqual(0);
    } finally {
      client.dispose();
    }
  }, 15_000);

  test("origin allow-list rejects foreign origins with 403", async () => {
    const s = startServer({ ...baseConfig(), origins: "https://trusted.example" });
    try {
      const res = await fetch(`http://localhost:${s.port}/ws`, {
        headers: { origin: "https://evil.example" },
      });
      expect(res.status).toBe(403);
    } finally {
      await s.stop(true);
    }
  });

  test("bearer token mismatch rejects with 401", async () => {
    const s = startServer({ ...baseConfig(), token: "s3cret" });
    try {
      const res = await fetch(`http://localhost:${s.port}/ws`);
      expect(res.status).toBe(401);
      const ok = await fetch(`http://localhost:${s.port}/ws`, {
        headers: { authorization: "Bearer s3cret" },
      });
      // 426 = upgrade required (auth passed, but this is a plain fetch)
      expect(ok.status).toBe(426);
    } finally {
      await s.stop(true);
    }
  });

  test("configFromEnv fails fast on invalid values", () => {
    expect(() => configFromEnv({ SPICEKIT_PORT: "not-a-port" })).toThrow();
    expect(() => configFromEnv({ SPICEKIT_MAX_CONNECTIONS: "-3" })).toThrow();
  });
});

function baseConfig(): ServerConfig {
  return {
    port: 0,
    origins: "*",
    token: "",
    maxConnections: 8,
    maxPayloadBytes: 65536,
    rateLimitPerSec: 200,
    idleTimeoutSeconds: 60,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
