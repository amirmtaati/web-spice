/**
 * Browser suite harness (SPEC §13.8): bundles engine test entry points with
 * `bun build --target browser`, serves them from a Bun static server, drives
 * Playwright across Chromium/Firefox/WebKit, and aggregates results in the
 * same format as `bun test`. P0 acceptance requires a trivial suite running in
 * all three browsers — implementation lands next on the P0 completion list.
 */
function main(): number {
  console.log("browser-suite: not implemented yet.");
  console.log("Plan: bun build (browser target) → static server → Playwright 3 engines → report.");
  console.log("Track in docs/progress.md under 'P0 completion'.");
  return 0;
}

process.exitCode = main();
