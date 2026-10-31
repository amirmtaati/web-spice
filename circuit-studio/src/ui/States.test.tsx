/** Component tests: state chrome — Panel, EmptyState, ErrorState, misc (UX0-T2). */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Badge } from "./Badge.tsx";
import { Chip } from "./Chip.tsx";
import { ColorDot } from "./ColorDot.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorState } from "./ErrorState.tsx";
import { Kbd } from "./Kbd.tsx";
import { Panel } from "./Panel.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { Skeleton } from "./Skeleton.tsx";

describe("Panel", () => {
  it("renders title, aria-label, actions, and body", () => {
    const view = render(
      <Panel title="Oscilloscope" actions={<button type="button">Export</button>}>
        <div>plot area</div>
      </Panel>,
    );
    expect(view.getByRole("region", { name: "Oscilloscope" })).toBeDefined();
    expect(view.getByText("plot area")).toBeDefined();
    expect(view.getByRole("button", { name: "Export" })).toBeDefined();
  });

  it("matches snapshot", () => {
    const { container } = render(<Panel title="Console">body</Panel>);
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});

describe("EmptyState / ErrorState", () => {
  it("EmptyState fires its action", () => {
    const onAction = mock(() => {});
    const view = render(
      <EmptyState
        title="No probes"
        hint="Press P to place one"
        actionLabel="Place probe"
        onAction={onAction}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Place probe" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("ErrorState shows detail and retries", () => {
    const onRetry = mock(() => {});
    const view = render(<ErrorState detail="E_NO_CONVERGENCE" onRetry={onRetry} />);
    expect(view.getByRole("alert").textContent).toContain("E_NO_CONVERGENCE");
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("small primitives", () => {
  it("Badge tones render with text content", () => {
    const view = render(<Badge tone="ok">converged</Badge>);
    expect(view.getByText("converged")).toBeDefined();
  });

  it("Chip renders a state dot (aria-hidden) plus label", () => {
    const { container, getByText } = render(<Chip state="ok">engine 0.2.0</Chip>);
    expect(getByText("engine 0.2.0")).toBeDefined();
    expect(container.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("Kbd renders a kbd element", () => {
    const view = render(<Kbd>Ctrl</Kbd>);
    expect(view.getByText("Ctrl").tagName).toBe("KBD");
  });

  it("ColorDot maps index to --sig-N", () => {
    const { container } = render(<ColorDot index={3} label="V(out)" />);
    const dot = container.querySelector("span") as HTMLElement;
    expect(dot.style.background).toBe("var(--sig-3)");
    expect(dot.getAttribute("aria-label")).toBe("V(out)");
  });

  it("ProgressBar exposes ARIA value semantics", () => {
    const { container, rerender } = render(<ProgressBar value={0.42} label="Run" />);
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    rerender(<ProgressBar label="Run" indeterminate />);
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("Skeleton is decorative", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });
});
