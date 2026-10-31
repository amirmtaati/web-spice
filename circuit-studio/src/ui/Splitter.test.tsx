/** Component tests: Splitter keyboard/pointer resize (UX0-T2). */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Splitter } from "./Splitter.tsx";

describe("Splitter", () => {
  it("is a focusable separator with ARIA value semantics", () => {
    const view = render(
      <Splitter
        label="Instrument dock"
        orientation="vertical"
        fraction={0.34}
        onFractionChange={() => {}}
      />,
    );
    const separator = view.getByRole("separator", { name: "Instrument dock" });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuenow")).toBe("34");
  });

  it("ArrowDown/ArrowUp change the fraction", () => {
    const onChange = mock(() => {});
    const view = render(
      <Splitter
        label="dock"
        orientation="vertical"
        fraction={0.5}
        onFractionChange={onChange}
        minFraction={0.2}
      />,
    );
    const separator = view.getByRole("separator", { name: "dock" });
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
  });

  it("Home recenters to 50%", () => {
    const onChange = mock(() => {});
    const view = render(
      <Splitter label="dock" orientation="horizontal" fraction={0.8} onFractionChange={onChange} />,
    );
    fireEvent.keyDown(view.getByRole("separator", { name: "dock" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });
});
