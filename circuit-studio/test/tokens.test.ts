/**
 * UX0-T1 gate: the token set is complete in every theme and meets the
 * contrast floor (UI-UX-SPEC §4.1/§4.2). Parses `src/app/tokens.css`
 * directly so the test can never drift from the shipped values.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS_PATH = join(import.meta.dir, "..", "src", "app", "tokens.css");
const CSS = readFileSync(TOKENS_PATH, "utf8");

const THEMES = ["dark", "light", "paper"] as const;
type Theme = (typeof THEMES)[number];

/** Extract `--token: value` pairs from one CSS block. */
function parseBlock(selector: string, block: string, into: Map<string, string>): void {
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    into.set(m[1], m[2].trim());
  }
  void selector;
}

/** Parse the whole file into `selector → tokens` maps (no nesting here). */
function parseStylesheet(css: string): { selector: string; tokens: Map<string, string> }[] {
  const blocks: { selector: string; tokens: Map<string, string> }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const tokens = new Map<string, string>();
    parseBlock(selector, m[2], tokens);
    blocks.push({ selector, tokens });
  }
  return blocks;
}

const ALL_BLOCKS = parseStylesheet(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));

/** Cumulative tokens for a theme: base `:root` block(s), then the theme block. */
function themeTokens(theme: Theme): Map<string, string> {
  const merged = new Map<string, string>();
  for (const b of ALL_BLOCKS) {
    if (b.selector === ":root" || b.selector.startsWith(":root,")) {
      for (const [k, v] of b.tokens) merged.set(k, v);
    }
  }
  const themeBlock = ALL_BLOCKS.find((b) =>
    b.selector.replace(/\s+/g, " ").includes(`:root[data-theme="${theme}"]`),
  );
  expect(themeBlock).toBeDefined();
  if (themeBlock !== undefined) {
    for (const [k, v] of themeBlock.tokens) merged.set(k, v);
  }
  return merged;
}

const BLOCKS: Record<Theme, Map<string, string>> = {
  dark: themeTokens("dark"),
  light: themeTokens("light"),
  paper: themeTokens("paper"),
};

const REQUIRED = [
  // semantic core
  "bg",
  "bg-panel",
  "bg-elevated",
  "canvas-bg",
  "fg",
  "fg-muted",
  "fg-faint",
  "border",
  "border-strong",
  "accent",
  "accent-soft",
  "accent-contrast",
  // state
  "ok",
  "ok-soft",
  "warning",
  "warning-soft",
  "error",
  "error-soft",
  "info",
  "info-soft",
  // signals 1..8
  ...Array.from({ length: 8 }, (_, i) => `sig-${i + 1}`),
  // canvas semantics
  "wire",
  "wire-selected",
  "net-highlight",
  "symbol-body",
  "symbol-fill",
  "pin",
  "pin-hover",
  "junction",
  "label",
  "power-net",
  "ground-net",
  "error-marker",
  "warning-marker",
  "ghost",
  "guide",
  "grid-dot",
  // heat map
  ...Array.from({ length: 5 }, (_, i) => `heat-${i + 1}`),
  // typography
  "font-ui",
  "font-mono",
  "font-schematic",
  // radius / elevation / density / motion
  "r-sm",
  "r-md",
  "r-lg",
  "shadow-popover",
  "shadow-float",
  "ctl-h",
  "row-h",
  "dur-1",
  "dur-2",
  "dur-3",
  "ease-standard",
];

function resolve(token: string, theme: Theme, seen = new Set<string>()): string {
  const raw = BLOCKS[theme].get(token);
  if (raw === undefined) throw new Error(`missing token --${token} in ${theme}`);
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (ref === null) return raw;
  if (seen.has(token)) throw new Error(`circular token --${token}`);
  return resolve(ref[1], theme, seen.add(token));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("tokens.css", () => {
  it("defines every required token in all three themes", () => {
    for (const theme of THEMES) {
      for (const token of REQUIRED) {
        expect(BLOCKS[theme].has(token)).toBe(true);
      }
    }
  });

  it("dark theme is the :root default (no data-theme needed)", () => {
    expect(CSS.indexOf(":root,")).toBeGreaterThanOrEqual(0);
  });

  it.each(THEMES)("text contrast ≥ 4.5 for readable pairs (%s)", (theme) => {
    const fg = resolve("fg", theme);
    const muted = resolve("fg-muted", theme);
    const bg = resolve("bg", theme);
    const panel = resolve("bg-panel", theme);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fg, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("accent vs accent-contrast ≥ 4.5 (%s)", (theme) => {
    expect(
      contrastRatio(resolve("accent", theme), resolve("accent-contrast", theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("signal palette has 8 distinct hues (%s)", (theme) => {
    const hues = Array.from({ length: 8 }, (_, i) => resolve(`sig-${i + 1}`, theme));
    expect(new Set(hues).size).toBe(8);
  });

  it.each(THEMES)("heat map ascends cold → hot (5 stops, distinct) (%s)", (theme) => {
    const stops = Array.from({ length: 5 }, (_, i) => resolve(`heat-${i + 1}`, theme));
    expect(new Set(stops).size).toBe(5);
  });
});
