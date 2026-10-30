/**
 * Component tests: command palette (UX0-T5) — open, list, recents, disabled
 * marking. Typing/filter/run flows are covered by the Playwright e2e suite
 * (real Chromium: happy-dom cannot synthesize React 19's controlled-input
 * onChange); the fuzzy scoring itself is unit-tested below.
 */
import "../test/dom.ts";
import { beforeEach, describe, expect, it } from "bun:test";
import { render, within } from "@testing-library/react";
import { act } from "react";
import { CommandPalette, fuzzyScore } from "./CommandPalette.tsx";
import { type CommandDef, useCommandRegistry } from "./registry.ts";

function def(overrides: Partial<CommandDef> & { id: string }): CommandDef {
  return {
    title: overrides.id,
    category: "View",
    source: "test",
    run: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  useCommandRegistry.setState({
    commands: new Map<string, CommandDef>(),
    recents: [],
    paletteOpen: false,
    shortcutOverlayOpen: false,
  });
});

describe("fuzzyScore", () => {
  it("scores subsequence matches with contiguity and word-start bonuses", () => {
    expect(fuzzyScore("zoom", "Zoom to fit")).toBeGreaterThan(0);
    expect(fuzzyScore("ztf", "Zoom to fit")).toBeGreaterThan(0);
    expect(fuzzyScore("zoom", "Run analysis")).toBe(0);
    expect(fuzzyScore("", "anything")).toBe(1);
    expect(fuzzyScore("zoom", "Zoom to fit")).toBeGreaterThan(fuzzyScore("z", "Zoom to fit"));
  });
});

describe("CommandPalette", () => {
  it("renders closed by default and lists commands when opened", () => {
    useCommandRegistry
      .getState()
      .register([
        def({ id: "view.zoom", title: "Zoom to fit", category: "View" }),
        def({ id: "sim.run", title: "Run analysis", category: "Simulate" }),
      ]);
    const view = render(<CommandPalette />);
    expect(within(document.body).queryByTestId("palette-input")).toBeNull();
    act(() => useCommandRegistry.getState().setPaletteOpen(true));
    view.rerender(<CommandPalette />);
    const input = within(document.body).getByTestId("palette-input");
    expect(input).toBeDefined();
    const items = within(document.body).getAllByTestId("palette-item");
    expect(items.length).toBe(2);
  });

  it("promotes recent commands to the top of the empty-query list", () => {
    useCommandRegistry
      .getState()
      .register([
        def({ id: "a", title: "Alpha" }),
        def({ id: "b", title: "Beta" }),
        def({ id: "c", title: "Gamma" }),
      ]);
    act(() => {
      useCommandRegistry.getState().markRecent("c");
      useCommandRegistry.getState().setPaletteOpen(true);
    });
    render(<CommandPalette />);
    const items = within(document.body).getAllByTestId("palette-item");
    expect(items[0]?.textContent).toContain("Gamma");
  });

  it("shows disabled commands with a faint dot", () => {
    useCommandRegistry
      .getState()
      .register([def({ id: "off", title: "Wired later", isEnabled: () => false })]);
    act(() => useCommandRegistry.getState().setPaletteOpen(true));
    render(<CommandPalette />);
    const dot = within(document.body).getByTestId("palette-item").querySelector("span");
    expect(dot?.className).toContain("bg-faint");
  });

  it("palette open state is registry-hosted so shortcuts can toggle it", () => {
    const view = render(<CommandPalette />);
    act(() => useCommandRegistry.getState().setPaletteOpen(true));
    view.rerender(<CommandPalette />);
    expect(within(document.body).getByTestId("palette-input")).toBeDefined();
    act(() => useCommandRegistry.getState().setPaletteOpen(false));
    view.rerender(<CommandPalette />);
    expect(within(document.body).queryByTestId("palette-input")).toBeNull();
  });
});
