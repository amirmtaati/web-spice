/** Component tests: Tabs (Radix wrapper, UX0-T2). */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Tabs } from "./Tabs.tsx";

describe("Tabs", () => {
  it("renders tabs with ARIA roles and switches on click", () => {
    const view = render(
      <Tabs
        ariaLabel="Instrument dock"
        items={[
          { id: "scope", label: "Scope", content: <div>scope body</div> },
          { id: "console", label: "Console", content: <div>console body</div> },
        ]}
      />,
    );
    expect(view.getByRole("tablist", { name: "Instrument dock" })).toBeDefined();
    const consoleTab = view.getByRole("tab", { name: "Console" });
    // Radix activates tabs on mousedown, not click.
    fireEvent.mouseDown(consoleTab);
    fireEvent.click(consoleTab);
    expect(consoleTab.getAttribute("aria-selected")).toBe("true");
    expect(view.getByText("console body")).toBeDefined();
  });

  it("supports controlled selection", () => {
    let current = "b";
    const { rerender, getByRole } = render(
      <Tabs
        ariaLabel="Inspector"
        value={current}
        onValueChange={(id) => {
          current = id;
        }}
        items={[
          { id: "a", label: "A", content: <div>a</div> },
          { id: "b", label: "B", content: <div>b</div> },
        ]}
      />,
    );
    fireEvent.mouseDown(getByRole("tab", { name: "A" }));
    expect(current).toBe("a");
    rerender(
      <Tabs
        ariaLabel="Inspector"
        value={current}
        items={[
          { id: "a", label: "A", content: <div>a</div> },
          { id: "b", label: "B", content: <div>b</div> },
        ]}
      />,
    );
    expect(getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
  });

  it("matches snapshot", () => {
    const { container } = render(
      <Tabs ariaLabel="Snapshot" items={[{ id: "one", label: "One", content: <div>1</div> }]} />,
    );
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});
