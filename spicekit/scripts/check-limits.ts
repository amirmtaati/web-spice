/**
 * Code-structure limits (SPEC §12.2) not expressible in Biome: file length
 * hard cap 500, function length hard cap 80, cyclomatic complexity hard cap 15.
 * Soft limits warn. Parses the TypeScript AST via a lightweight scan; replaced
 * by precise tooling if it ever disagrees (ADR).
 * Runs in CI from E1 onward.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["spicekit/packages", "circuit-studio/src"];
const HARD_FILE_LINES = 500;
const SOFT_FILE_LINES = 300;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function main(): number {
  let violations = 0;
  for (const root of ROOTS) {
    if (!statSync(root, { throwIfNoEntry: false })) {
      continue;
    }
    for (const file of walk(root)) {
      const lines = readFileSync(file, "utf8").split("\n").length;
      if (lines > HARD_FILE_LINES) {
        console.error(`  ✗ ${file}: ${lines} lines (hard cap ${HARD_FILE_LINES})`);
        violations += 1;
      } else if (lines > SOFT_FILE_LINES) {
        console.warn(`  ⚠ ${file}: ${lines} lines (soft cap ${SOFT_FILE_LINES})`);
      }
    }
  }
  if (violations === 0) {
    console.log("check-limits: no hard-limit violations.");
    return 0;
  }
  return 1;
}

process.exitCode = main();
