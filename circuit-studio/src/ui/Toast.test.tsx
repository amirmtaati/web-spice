/** Component tests: Toast stack + ErrorBoundary (UX0-T2/T7). */
import "../test/dom.ts";
import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, within } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ToastProvider, useToast } from "./Toast.tsx";

function ToastLauncher({ tone }: { tone?: "error" | "ok" }) {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        show({
          title: "Engine restarted",
          message: "Circuit preserved — press F5 to re-run",
          tone,
          actions: [{ label: "Reload", onClick: () => {} }],
        })
      }
    >
      notify
    </button>
  );
}

describe("Toast", () => {
  it("shows a toast with actions and dismisses", () => {
    const view = render(
      <ToastProvider>
        <ToastLauncher tone="ok" />
      </ToastProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "notify" }));
    const body = within(document.body);
    const status = body.getAllByRole("status").at(-1);
    expect(status?.textContent).toContain("Engine restarted");
    const dismiss = body.getAllByRole("button", { name: "Dismiss notification" }).at(-1);
    if (dismiss === undefined) throw new Error("dismiss button missing");
    fireEvent.click(dismiss);
    expect(body.queryByText("Engine restarted")).toBeNull();
  });

  it("action buttons dismiss the toast after firing", () => {
    const view = render(
      <ToastProvider>
        <ToastLauncher />
      </ToastProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "notify" }));
    const body = within(document.body);
    const reload = body.getAllByRole("button", { name: "Reload" }).at(-1);
    if (reload === undefined) throw new Error("action button missing");
    fireEvent.click(reload);
    expect(body.queryByText("Engine restarted")).toBeNull();
  });
});

function Boom(): never {
  throw new Error("probe exploded");
}

describe("ErrorBoundary", () => {
  it("isolates a thrown panel; the rest of the app stays alive", () => {
    const onError = mock(() => {});
    const view = render(
      <div>
        <div data-testid="sibling">alive</div>
        <ErrorBoundary region="scope" onError={onError}>
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(view.getByTestId("sibling").textContent).toBe("alive");
    expect(view.getByRole("alert").textContent).toContain("scope");
    expect(view.getByRole("alert").textContent).toContain("probe exploded");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("Retry clears the error state", () => {
    let shouldThrow = true;
    const { rerender, getByTestId, queryByRole } = render(
      <ErrorBoundary region="console">
        {shouldThrow ? <Boom /> : <div data-testid="healed">healed</div>}
      </ErrorBoundary>,
    );
    expect(within(document.body).getByRole("alert")).toBeDefined();
    fireEvent.click(within(document.body).getByRole("button", { name: "Retry" }));
    shouldThrow = false;
    rerender(
      <ErrorBoundary region="console">
        {shouldThrow ? <Boom /> : <div data-testid="healed">healed</div>}
      </ErrorBoundary>,
    );
    expect(getByTestId("healed")).toBeDefined();
    expect(queryByRole("alert")).toBeNull();
  });
});
