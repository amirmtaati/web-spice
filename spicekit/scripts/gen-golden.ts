/**
 * Golden-fixture generator (SPEC §13.2): runs ngspice over fixture netlists
 * and writes text golden outputs to fixtures/golden/, recording the ngspice
 * version in each header. CI consumes the goldens but never needs ngspice.
 * Lands with E1 alongside the parser — the scaffold only checks availability.
 */
const NGSPICE_HINT = "Install ngspice (apt install ngspice / brew install ngspice), then re-run.";

function main(): number {
  try {
    const proc = Bun.spawnSync(["ngspice", "--version"]);
    const out = new TextDecoder().decode(proc.stdout);
    console.log(`ngspice detected:\n${out.split("\n")[0] ?? "(no version output)"}`);
    console.log("Generation itself lands with E1 (parser + analyses).");
    return 0;
  } catch {
    console.error(`ngspice not found. ${NGSPICE_HINT}`);
    return 1;
  }
}

process.exitCode = main();
