# @spicekit/server — multi-stage build on the official Bun image (SPEC §7.3).
# The engine stack is pure TypeScript over Bun primitives; production deps
# only, non-root user, healthcheck.

FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY spicekit/package.json spicekit/package.json
COPY spicekit/packages/protocol/package.json spicekit/packages/protocol/package.json
COPY spicekit/packages/core/package.json spicekit/packages/core/package.json
COPY spicekit/packages/client/package.json spicekit/packages/client/package.json
COPY spicekit/packages/server/package.json spicekit/packages/server/package.json
COPY spicekit/packages/cli/package.json spicekit/packages/cli/package.json
COPY spicekit/packages/testing/package.json spicekit/packages/testing/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runner
LABEL org.opencontainers.image.title="spicekit-server"
LABEL org.opencontainers.image.description="SPICE-class circuit engine WebSocket host"
# Read-only root filesystem compatibility: nothing is written at runtime.
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY spicekit ./spicekit

# Non-root user; the server binds a high port and needs no privileges.
USER bun

ENV SPICEKIT_PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${SPICEKIT_PORT}/healthz || exit 1

# One worker per connection (SPEC §7.1); SIGTERM drains gracefully.
STOPSIGNAL SIGTERM
CMD ["bun", "spicekit/packages/server/src/main.ts"]
