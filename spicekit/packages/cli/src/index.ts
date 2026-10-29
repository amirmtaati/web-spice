#!/usr/bin/env bun
/**
 * `spicekit` CLI (SPEC §7.2). Subcommand surface is committed at P0;
 * implementations arrive with E1 (`run`, `check` over the in-process
 * transport) and E4 (`serve`, `convert`, `--json-lines`, compiled
 * single-file executables).
 */

function usage(): string {
  return `spicekit — SPICE-class circuit simulation

Usage:
  spicekit run <netlist> [--csv|--json|--raw]   Run analyses in a netlist
  spicekit check <netlist>                      Parse + pre-flight checks
  spicekit convert <in> <out>                   Convert between formats
  spicekit serve [--port N]                     Start the engine server
  spicekit --json-lines                         Machine mode (stdin/stdout)

Options are stubs until milestone E1 (SPEC §22).`;
}

function main(): number {
  const args = Bun.argv.slice(2);
  const command = args[0];
  switch (command) {
    case "run":
    case "check":
    case "convert":
    case "serve": {
      console.error(`spicekit ${command}: not implemented yet (lands with E1/E4 — SPEC §22).`);
      return 2;
    }
    case "--help":
    case "-h":
    case undefined: {
      console.log(usage());
      return 0;
    }
    default: {
      console.error(`Unknown command: ${command}\n\n${usage()}`);
      return 1;
    }
  }
}

process.exitCode = main();

export {}; // module marker (top-level await requires a module)
