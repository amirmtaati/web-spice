/**
 * Bundle-size budgets (SPEC §15.1): `@spicekit/core` ≤ 120 kB gzip; UI initial
 * JS ≤ 350 kB gzip (excluding lazy instruments); each instrument chunk
 * ≤ 120 kB gzip. Wired into CI when real builds exist (E1/U1).
 */
const BUDGETS_KB = { core: 120, uiInitial: 350, instrumentChunk: 120 } as const;

function main(): number {
  console.log("check-size: budgets (gzip):", BUDGETS_KB);
  console.log("No dist artifacts yet — measurement lands with E1 (core bundle) and U1 (UI build).");
  return 0;
}

process.exitCode = main();
