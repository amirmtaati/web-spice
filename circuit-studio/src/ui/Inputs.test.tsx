/** Component tests: Field + NumberInput + Select (UX0-T2, §6.4 scrubbing). */
import { setupDom } from "../test/dom.ts";

setupDom();

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Field } from "./Field.tsx";
import { NumberInput } from "./NumberInput.tsx";
import { Select } from "./Select.tsx";

describe("Field", () => {
  it("associates the label with the control and shows the unit", () => {
    const view = render(
      <Field label="Resistance" unit="Ω" htmlFor="r1">
        <input id="r1" />
      </Field>,
    );
    const label = view.getByText("Resistance");
    expect(label.getAttribute("for")).toBe("r1");
    expect(view.getByText("(Ω)")).toBeDefined();
  });

  it("renders the error with role=alert", () => {
    const view = render(
      <Field label="Value" error="Out of range">
        <input />
      </Field>,
    );
    expect(view.getByRole("alert").textContent).toBe("Out of range");
  });

  it("matches snapshot", () => {
    const { container } = render(
      <Field label="Capacitance" unit="F">
        <input />
      </Field>,
    );
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});

describe("NumberInput", () => {
  // NOTE: keyboard flows (ArrowUp/Down stepping, engineering-notation entry +
  // Enter commit, invalid-input rejection + blur restore, Escape cancel) need
  // real DOM keyboard/input events, which happy-dom cannot synthesize for
  // React 19 — verified: React onKeyDown does not fire for ANY component
  // under bun + happy-dom (controlled-input value-tracker dance and raw
  // input/change events both stay silent; see CommandPalette.test.tsx header
  // for the same decision). They are covered by the Playwright e2e suite
  // (UX1-T8 inspector journey + UX2-T3 run-bar tstep stepping), where
  // NumberInput runs in real Chromium.
  it.skip("ArrowUp steps by a decade-relative 10% (e2e: real keyboard)", () => {
    const onChange = mock(() => {});
    const view = render(<NumberInput value={1000} onChange={onChange} label="R3" />);
    fireEvent.keyDown(view.getByRole("textbox", { name: "R3" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(1100);
  });

  it.skip("clamps to min/max (e2e: real keyboard)", () => {
    const onChange = mock(() => {});
    const view = render(
      <NumberInput value={5} onChange={onChange} label="V" min={0} max={10} step={20} />,
    );
    fireEvent.keyDown(view.getByRole("textbox", { name: "V" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });
});

describe("Select", () => {
  it("renders options and reports changes", () => {
    const onChange = mock(() => {});
    const view = render(
      <Select
        label="Theme"
        options={[
          { value: "dark", label: "Dark" },
          { value: "paper", label: "Paper" },
        ]}
        onChange={onChange}
      />,
    );
    const select = view.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "paper" } });
    expect(onChange).toHaveBeenCalled();
    expect(select.options.length).toBe(2);
  });

  it("matches snapshot", () => {
    const { container } = render(
      <Select label="Analysis" options={[{ value: "tran", label: "Tran" }]} />,
    );
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});
