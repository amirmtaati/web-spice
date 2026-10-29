# @spicekit/cli

`spicekit` command (SPEC §7.2). Subcommands: `run`, `check`, `convert`, `serve`,
`--json-lines`. The P0 scaffold commits the surface and exits with a clear
"not implemented" for each; implementations land with E1/E4. Single-file
executables via `bun build --compile` are attached to releases from E4.

Try it: `bun spicekit/packages/cli/src/index.ts --help`
