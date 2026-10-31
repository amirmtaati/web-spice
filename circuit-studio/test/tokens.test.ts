/**
 * Chart/signal palette token check (UX2-T6): probe channels resolve against
 * the `--sig-N` theme tokens (§4.1). The token contract is asserted here
 * (DOM-free) so probes never hardcode hexes.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS = readFileSync(join(import.meta.dir, "..", "src", "app", "tokens.css"), "utf8");

describe("signal palette tokens", () => {
  it("defines --sig-1 … --sig-8 (probe channel colors)", () => {
    for (let n = 1; n <= 8; n++) {
      expect(TOKENS).toContain(`--sig-${n}:`);
    }
  });
});
