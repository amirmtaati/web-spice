/** Shortcut grammar tests (UX0-T5): normalization, display, matching. */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it } from "bun:test";
import { eventMatches, formatShortcut, isTextEntryTarget, normalizeShortcut } from "./shortcut.ts";

const KEY = (over: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key: "k",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  }) as KeyboardEvent;

describe("normalizeShortcut", () => {
  it("sorts modifiers canonically and upper-cases single letters", () => {
    expect(normalizeShortcut("Shift+Ctrl+V")).toBe("Ctrl+Shift+V");
    expect(normalizeShortcut("ctrl+alt+del")).toBe("Ctrl+Alt+Del");
    expect(normalizeShortcut("Mod+K")).toBe("Mod+K");
    expect(normalizeShortcut("?")).toBe("?");
    expect(normalizeShortcut("F5")).toBe("F5");
  });

  it("accepts mac aliases for Mod", () => {
    expect(normalizeShortcut("Cmd+K")).toBe("Mod+K");
    expect(normalizeShortcut("Meta+k")).toBe("Mod+K");
  });

  it("rejects garbage", () => {
    expect(() => normalizeShortcut("")).toThrow();
    expect(() => normalizeShortcut("Hyper+K")).toThrow();
  });
});

describe("formatShortcut", () => {
  it("renders mac glyphs on apple and Ctrl elsewhere", () => {
    expect(formatShortcut("Mod+K", "apple")).toBe("⌘K");
    expect(formatShortcut("Mod+K", "other")).toBe("Ctrl+K");
    expect(formatShortcut("Mod+Shift+V", "apple")).toBe("⌘⇧V");
    expect(formatShortcut("?", "other")).toBe("?");
  });
});

describe("eventMatches", () => {
  it("matches Mod with Ctrl or Cmd", () => {
    expect(eventMatches(KEY({ ctrlKey: true }), "Mod+K")).toBe(true);
    expect(eventMatches(KEY({ metaKey: true }), "Mod+K")).toBe(true);
    expect(eventMatches(KEY({}), "Mod+K")).toBe(false);
  });

  it("requires exact Ctrl when named", () => {
    expect(eventMatches(KEY({ ctrlKey: true }), "Ctrl+Shift+V")).toBe(false); // shift missing
    expect(eventMatches(KEY({ ctrlKey: true, shiftKey: true, key: "V" }), "Ctrl+Shift+V")).toBe(
      true,
    );
    expect(eventMatches(KEY({ metaKey: true, shiftKey: true, key: "V" }), "Ctrl+Shift+V")).toBe(
      false,
    );
  });

  it("matches function and navigation keys", () => {
    expect(eventMatches(KEY({ key: "F5" }), "F5")).toBe(true);
    expect(eventMatches(KEY({ key: "Home" }), "Home")).toBe(true);
    expect(eventMatches(KEY({ key: "Delete" }), "Del")).toBe(true);
    expect(eventMatches(KEY({ key: "Escape" }), "Esc")).toBe(true);
  });

  it("matches shift-implied punctuation without an explicit Shift modifier", () => {
    expect(eventMatches(KEY({ key: "?", shiftKey: true }), "?")).toBe(true);
    expect(eventMatches(KEY({ key: "`" }), "`")).toBe(true);
    expect(eventMatches(KEY({ key: "a" }), "?")).toBe(false);
  });

  it("distinguishes shifted letters from plain letters", () => {
    expect(eventMatches(KEY({ key: "v", shiftKey: true }), "V")).toBe(false);
    expect(eventMatches(KEY({ key: "v" }), "V")).toBe(true);
  });

  it("never fires plain keys when modifiers are held", () => {
    expect(eventMatches(KEY({ key: "W", ctrlKey: true }), "W")).toBe(false);
    expect(eventMatches(KEY({ key: "W", altKey: true }), "W")).toBe(false);
  });
});

describe("isTextEntryTarget", () => {
  it("flags inputs, textareas, and contentEditable", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(area)).toBe(true);
    expect(isTextEntryTarget(editable)).toBe(true);
    expect(isTextEntryTarget(div)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
