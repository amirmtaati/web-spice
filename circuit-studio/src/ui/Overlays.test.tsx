/** Component tests: Tooltip + Popover + Menu (Radix overlays, UX0-T2). */
import "../test/dom.ts";
import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, within } from "@testing-library/react";
import { Menu, MenuItem, MenuLabel } from "./Menu.tsx";
import { Popover } from "./Popover.tsx";
import { Tooltip, TooltipProvider } from "./Tooltip.tsx";

describe("Tooltip", () => {
  it("shows content on hover (zero delay in test provider)", async () => {
    const view = render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Run simulation" shortcut="F5">
          <button type="button">Run</button>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = view.getByRole("button", { name: "Run" });
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseMove(trigger);
    // Tooltip portals to document.body — query the live document.
    const body = within(document.body);
    const tip = await body.findByText("Run simulation", {}, { timeout: 2000 });
    expect(tip).toBeDefined();
    expect(body.getByText("F5")).toBeDefined();
  });
});

describe("Popover", () => {
  it("opens on trigger click, closes on Escape", () => {
    const view = render(
      <Popover trigger={<button type="button">Experiments ▾</button>}>
        <div>RC charging</div>
      </Popover>,
    );
    fireEvent.click(view.getByRole("button", { name: "Experiments ▾" }));
    const body = within(document.body);
    expect(body.getByText("RC charging")).toBeDefined();
    fireEvent.keyDown(body.getByText("RC charging"), { key: "Escape" });
    expect(body.queryByText("RC charging")).toBeNull();
  });

  it("matches snapshot (closed state)", () => {
    const { container } = render(
      <Popover trigger={<button type="button">Menu</button>}>
        <div>x</div>
      </Popover>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("Menu", () => {
  it("opens, labels, and selects items", () => {
    const onSelect = mock(() => {});
    const view = render(
      <Menu trigger={<button type="button">Export</button>}>
        <MenuLabel>Export as</MenuLabel>
        <MenuItem shortcut="Ctrl+Alt+E" onSelect={onSelect}>
          SPICE netlist
        </MenuItem>
      </Menu>,
    );
    fireEvent.click(view.getByRole("button", { name: "Export" }));
    const body = within(document.body);
    const item = body.getByText("SPICE netlist");
    expect(body.getByText("Export as")).toBeDefined();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("disabled items do not select", () => {
    const onSelect = mock(() => {});
    const view = render(
      <Menu trigger={<button type="button">File</button>}>
        <MenuItem disabled onSelect={onSelect}>
          Locked
        </MenuItem>
      </Menu>,
    );
    fireEvent.click(view.getByRole("button", { name: "File" }));
    fireEvent.click(within(document.body).getByText("Locked"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
