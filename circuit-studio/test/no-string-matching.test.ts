/**
 * UI error-surface policy check (UX2-T5): culprit resolution never
 * string-matches engine error messages — codes/locations come from the
 * typed EngineError surface and Circuit.sourceMap (AGENTS.md §7.2/§7.3).
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
/** Directories where typed error handling lives (scan target). */
const SCAN_DIRS = [join(SRC, "sim"), join(SRC, "console"), join(SRC, "shell")];
const BANNED =
  /message\.(includes|startsWith|endsWith|match|matchAll|replace|toLowerCase|toUpperCase)\(|\.match\(\s*["'`]E_|startsWith\(\s*["'`]E_|includes\(\s*["'`]E_/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|e2e)\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("no string matching on engine errors", () => {
  it("src/sim + error surfaces never parse error messages to find culprits", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir)) {
        if (BANNED.test(readFileSync(file, "utf8"))) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
