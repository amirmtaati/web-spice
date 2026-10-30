/** Component tests: Field + NumberInput + Select (UX0-T2, §6.4 scrubbing). */
import "../test/dom.ts";
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
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("NumberInput", () => {
  it("commits engineering notation on Enter", () => {
    const onChange = mock(() => {});
    const view = render(<NumberInput value={1000} onChange={onChange} label="R1" />);
    const input = view.getByRole("textbox", { name: "R1" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4.7k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(4700);
  });

  it("rejects garbage: aria-invalid, no onChange, restores value on blur", () => {
    const onChange = mock(() => {});
    const view = render(<NumberInput value={1000} onChange={onChange} label="C1" />);
    const input = view.getByRole("textbox", { name: "C1" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("1 k"); // formatted restore
  });

  it("Escape cancels the edit", () => {
    const onChange = mock(() => {});
    const view = render(<NumberInput value={4700} onChange={onChange} label="R2" />);
    const input = view.getByRole("textbox", { name: "R2" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("4.7 k");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ArrowUp steps by a decade-relative 10%", () => {
    const onChange = mock(() => {});
    const view = render(<NumberInput value={1000} onChange={onChange} label="R3" />);
    fireEvent.keyDown(view.getByRole("textbox", { name: "R3" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(1100);
  });

  it("clamps to min/max", () => {
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
    expect(container.firstChild).toMatchSnapshot();
  });
});
