/**
 * `bun run doctor` — environment sanity check (SPEC §18.4): verifies the Bun
 * version matches `.bun-version`, that the lockfile exists, workspaces resolve,
 * and (optionally) reports on Playwright browsers + ngspice availability.
 * Prints actionable fixes; exit code 1 on hard failures.
 */
import { $ } from "bun";

const ROOT = new URL("../../", import.meta.url).pathname;

async function main(): Promise<number> {
  let hardFail = false;
  const problems: string[] = [];
  const notes: string[] = [];

  // 1. Bun version pin (SPEC §3.4)
  const bunVersion = Bun.version ?? "unknown";
  const pin = (await Bun.file(ROOT + ".bun-version").text()).trim();
  if (bunVersion !== pin) {
    hardFail = true;
    problems.push(
      `Bun ${bunVersion} != pinned ${pin}. Install the pinned version: bun upgrade --to ${pin} (or use your version manager).`,
    );
  } else {
    notes.push(`Bun ${bunVersion} matches .bun-version ✓`);
  }

  // 2. Lockfile present
  const lock = Bun.file(ROOT + "bun.lock");
  if (!(await lock.exists())) {
    notes.push(
      "bun.lock missing — run `bun install` (CI requires it: bun install --frozen-lockfile).",
    );
  } else {
    notes.push("bun.lock present ✓");
  }

  // 3. Workspaces resolve
  try {
    await $`bun pm ls`.quiet().cwd(ROOT);
    notes.push("workspaces resolve ✓");
  } catch {
    hardFail = true;
    problems.push("bun pm ls failed — run `bun install`.");
  }

  // 4. Optional tools (informational)
  for (const [tool, why] of [
    ["ngspice", "generating golden reference outputs (scripts/gen-golden.ts)"],
    ["playwright", "browser suites + e2e (bunx playwright install)"],
  ] as const) {
    try {
      await $`which ${tool}`.quiet();
      notes.push(`${tool} found ✓ (${why})`);
    } catch {
      notes.push(`${tool} not installed — only needed for ${why}.`);
    }
  }

  console.log("doctor:");
  for (const n of notes) {
    console.log(`  • ${n}`);
  }
  for (const p of problems) {
    console.error(`  ✗ ${p}`);
  }
  return hardFail ? 1 : 0;
}

process.exitCode = await main();
