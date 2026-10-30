/**
 * Shortcut grammar and matching (UI-UX-SPEC §9.2). Canonical form:
 * `Mod+Shift+V`, `F5`, `?`, `` ` `` — modifiers ascending
 * (Mod, Ctrl, Alt, Shift) then a key. `Mod` means Cmd on macOS and Ctrl
 * elsewhere (display) and matches either at runtime so both keyboard
 * conventions work everywhere. Single-key commands (V, W, P, ?) never fire
 * while typing in an input or with any modifier held.
 */

export type ShortcutPlatform = "apple" | "other";

export function detectPlatform(
  nav: Navigator | undefined = globalThis.navigator,
): ShortcutPlatform {
  return /mac|iphone|ipad/i.test(nav?.userAgent ?? "") ? "apple" : "other";
}

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;

/** Canonicalize a chord: modifiers in canonical order, single-letter key upper-cased. */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) {
    throw new Error(`invalid shortcut: ${JSON.stringify(shortcut)}`);
  }
  const key = parts[parts.length - 1];
  if (key === undefined) {
    throw new Error(`invalid shortcut: ${JSON.stringify(shortcut)}`);
  }
  const mods = parts.slice(0, -1).map(canonicalModifier).sort(byCanonicalOrder);
  const normalizedKey = /^[a-z]$/i.test(key)
    ? key.toUpperCase()
    : /^[a-z]+$/i.test(key)
      ? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
      : key;
  return [...mods, normalizedKey].join("+");
}

function canonicalModifier(mod: string): string {
  switch (mod.toLowerCase()) {
    case "mod":
    case "cmd":
    case "meta":
    case "cmdorctrl":
      return "Mod";
    case "ctrl":
    case "control":
      return "Ctrl";
    case "alt":
    case "option":
      return "Alt";
    case "shift":
      return "Shift";
    default:
      throw new Error(`unknown modifier: ${mod}`);
  }
}

function byCanonicalOrder(a: string, b: string): number {
  return (
    MODIFIER_ORDER.indexOf(a as (typeof MODIFIER_ORDER)[number]) -
    MODIFIER_ORDER.indexOf(b as (typeof MODIFIER_ORDER)[number])
  );
}

/** Human display: ⌘/⌃ on apple platforms, Ctrl elsewhere. */
export function formatShortcut(
  shortcut: string,
  platform: ShortcutPlatform = detectPlatform(),
): string {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1);
  if (platform === "apple") {
    const glyphs: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
    return mods.map((m) => glyphs[m] ?? m).join("") + key;
  }
  const names: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  return mods.map((m) => names[m] ?? m).join("+") + (mods.length > 0 ? "+" : "") + key;
}

interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const NAMED_KEY_ALIASES: Record<string, string> = {
  Del: "Delete",
  Esc: "Escape",
  Return: "Enter",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

function eventKeyForMatch(event: KeyEventLike): string {
  // Ctrl+Shift+V produces "V" with shift; Ctrl+K produces "k". Use the
  // un-shifted letter when modifiers are held so chords match canonically.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return event.key.length === 1 ? event.key.toUpperCase() : event.key;
  }
  return event.key;
}

/** True when the keyboard event should trigger this canonical chord. */
export function eventMatches(event: KeyEventLike, shortcut: string): boolean {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = new Set(parts.slice(0, -1));

  const wantsAlt = mods.has("Alt");
  const wantsShift = mods.has("Shift");

  // `Mod` matches Cmd OR Ctrl so a Ctrl+K habit works on macOS too; when the
  // chord names Ctrl explicitly (rare), require exactly Ctrl.
  if (mods.has("Ctrl")) {
    if (!event.ctrlKey || event.metaKey) {
      return false;
    }
  } else if (mods.has("Mod")) {
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }
  } else if (event.ctrlKey || event.metaKey) {
    return false;
  }
  if (event.altKey !== wantsAlt) {
    return false;
  }
  const expected = NAMED_KEY_ALIASES[key] ?? key;
  const printablePunct = expected.length === 1 && !/[a-zA-Z0-9]/.test(expected);
  if (wantsShift) {
    if (!event.shiftKey) {
      return false;
    }
  } else if (!printablePunct && event.shiftKey) {
    // "?" and "`" imply Shift on US layouts — match them without Shift.
    return false;
  }
  const actual = eventKeyForMatch(event);
  return actual === expected || actual.toLowerCase() === expected.toLowerCase();
}

/** Typing contexts where single-key (no-modifier) commands must not fire. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
