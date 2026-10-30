/** Component tests: shortcut overlay (UX0-T5) — renders the registry table. */
import "../test/dom.ts";
import { beforeEach, describe, expect, it } from "bun:test";
import { render, within } from "@testing-library/react";
import { act } from "react";
import { type CommandDef, useCommandRegistry } from "./registry.ts";
import { ShortcutOverlay } from "./ShortcutOverlay.tsx";

beforeEach(() => {
  useCommandRegistry.setState({
    commands: new Map<string, CommandDef>(),
    recents: [],
    paletteOpen: false,
    shortcutOverlayOpen: false,
  });
});

describe("ShortcutOverlay", () => {
  it("renders closed by default and lists bound commands when opened", () => {
    useCommandRegistry.getState().register([
      { id: "a", title: "Alpha", category: "View", shortcut: "Mod+K", source: "t", run: () => {} },
      { id: "b", title: "Beta", category: "View", source: "t", run: () => {} }, // unbound
    ]);
    const view = render(<ShortcutOverlay />);
    expect(within(document.body).queryByRole("table")).toBeNull();
    act(() => useCommandRegistry.getState().setShortcutOverlayOpen(true));
    view.rerender(<ShortcutOverlay />);
    const table = within(document.body).getByRole("table");
    const text = table.textContent ?? "";
    expect(text).toContain("Alpha");
    expect(text).not.toContain("Beta"); // unbound commands are not shortcuts
  });
});
