/**
 * Architecture rules (SPEC §12.4). Layering:
 *   spicekit:  protocol <- core <- client <- server/cli (nothing imports server or cli)
 *   studio:    only `sim` imports @spicekit/client
 * Also: runtime-agnostic packages must not use bun/node modules.
 */
module.exports = {
  forbidden: [
    {
      name: "core-cannot-depend-on-client-or-higher",
      severity: "error",
      comment: "core is the innermost engine package; it may depend only on protocol.",
      from: { path: "^spicekit/packages/core" },
      to: {
        path: "^spicekit/packages/(client|server|cli|testing)",
        dependencyTypes: ["local", "npm"],
      },
    },
    {
      name: "protocol-is-leaf",
      severity: "error",
      comment: "protocol defines the contract; it depends on nothing internal.",
      from: { path: "^spicekit/packages/protocol" },
      to: { path: "^spicekit/packages/(core|client|server|cli|testing)" },
    },
    {
      name: "nothing-imports-server-or-cli",
      severity: "error",
      comment: "server and cli are executable endpoints, never libraries.",
      from: { path: "^(?!spicekit/packages/(server|cli))" },
      to: { path: "^spicekit/packages/(server|cli)" },
    },
    {
      name: "only-sim-imports-spicekit-client",
      severity: "error",
      comment: "circuit-studio touches the engine exclusively through src/sim (SPEC §3.2).",
      from: { path: "^circuit-studio/src/(?!sim/)" },
      to: { path: "@spicekit/client" },
    },
    {
      name: "runtime-agnostic-no-bun-node",
      severity: "error",
      comment:
        "protocol/core/client and UI code are browser-target (SPEC §2.2); test files run under bun:test and are exempt.",
      from: {
        path: "^(spicekit/packages/(protocol|core|client)/src|circuit-studio/src)",
      },
      to: { path: "^(bun|node):" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Zero circular dependencies (SPEC §12.2).",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
