/** Component tests: Button + IconButton (UX0-T2). */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Button } from "./Button.tsx";
import { IconButton } from "./IconButton.tsx";

describe("Button", () => {
  it("renders its label and fires onClick", () => {
    const onClick = mock(() => {});
    const view = render(<Button onClick={onClick}>Run</Button>);
    const button = view.getByRole("button", { name: "Run" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("primary variant carries the accent token class", () => {
    const view = render(<Button variant="primary">Go</Button>);
    expect(view.getByRole("button", { name: "Go" }).className).toContain("bg-accent");
  });

  it("disabled buttons do not fire", () => {
    const onClick = mock(() => {});
    const view = render(
      <Button disabled onClick={onClick}>
        Stop
      </Button>,
    );
    fireEvent.click(view.getByRole("button", { name: "Stop" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("matches snapshot", () => {
    const { container } = render(
      <Button variant="primary" size="sm">
        Snapshot
      </Button>,
    );
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});

describe("IconButton", () => {
  it("exposes an accessible name from the label prop", () => {
    const view = render(
      <IconButton label="Zoom to fit">
        <span aria-hidden="true">⤢</span>
      </IconButton>,
    );
    expect(view.getByRole("button", { name: "Zoom to fit" })).toBeDefined();
  });

  it("aria-pressed reflects active state", () => {
    const view = render(
      <IconButton label="Snap" active>
        S
      </IconButton>,
    );
    expect(view.getByRole("button", { name: "Snap" }).getAttribute("aria-pressed")).toBe("true");
  });
});
