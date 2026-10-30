/**
 * UX0-T1 gate: "Never hardcode a hex in a component" (UI-UX-SPEC §4.1).
 * Scans all UI sources for raw color literals; only tokens.css may define
 * colors. rgba()/hsl() literals are also banned outside tokens.css.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const ALLOWED = new Set([join(SRC, "app", "tokens.css")]);
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("no hardcoded colors outside tokens", () => {
  it("src/** references tokens only", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (ALLOWED.has(file)) continue;
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (COLOR_RE.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
