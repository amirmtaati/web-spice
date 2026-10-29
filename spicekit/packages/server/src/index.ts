/**
 * @spicekit/server skeleton (SPEC §7.1). Bun-only.
 *
 * P0 scaffold: health endpoints + a placeholder WebSocket upgrade that
 * handshakes the protocol. Runs in Bun `Worker`s, zod-validated messages,
 * origin allow-list, bearer token, rate limits, backpressure-aware binary
 * streaming, Prometheus metrics, graceful shutdown — land with E4.
 */

const PORT = Number(process.env.SPICEKIT_PORT ?? 8080);

interface HelloProbe {
  id?: unknown;
  type?: unknown;
}

const server = Bun.serve({
  port: PORT,
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/readyz") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/ws") {
      // TODO(E4): verify Origin allow-list + bearer token before upgrading.
      if (bunServer.upgrade(request)) {
        return; // upgraded
      }
      return new Response("WebSocket upgrade expected", { status: 426 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(_ws) {
      // TODO(E4): send ready after capability negotiation; enforce per-connection
      // concurrency/rate limits and message size caps (SPEC §7.1).
    },
    message(ws, message) {
      // TODO(E4): zod-validate, then dispatch through a per-connection engine
      // Worker. The scaffold accepts only the handshake probe.
      if (typeof message !== "string") {
        return; // binary frames arrive with E4 bulk-data streaming
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        return; // malformed JSON is dropped until the zod gate lands (E4)
      }
      if (typeof parsed !== "object" || parsed === null) {
        return;
      }
      const probe = parsed as HelloProbe;
      if (probe.type !== "hello") {
        return;
      }
      ws.send(
        JSON.stringify({
          id: typeof probe.id === "string" ? probe.id : "0",
          type: "ready",
          payload: { engineVersion: "0.1.0+stub", capabilities: {}, limits: {} },
        }),
      );
    },
    close(_ws) {
      // TODO(E4): cancel runs owned by this socket.
    },
  },
  idleTimeout: 30,
});

process.on("SIGTERM", () => {
  // TODO(E4): stop accepting, drain runs, close sockets gracefully.
  void server.stop(true);
});

console.log(`@spicekit/server (scaffold) listening on http://localhost:${server.port}`);
