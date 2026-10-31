/**
 * Error surface tests (UX2-T5 done-when): a bad netlist shows the
 * line-pinned banner; culprit resolution never string-matches error
 * messages (static check + behavior via controller's toSimError).
 */
import { describe, expect, test } from "bun:test";
import { setupDom } from "../test/dom.ts";

setupDom();

import { fireEvent, render } from "@testing-library/react";
import { ConsolePanel } from "../console/ConsolePanel.tsx";
import { useEditorStore } from "../editor/store.ts";
import { useConsoleStore } from "../stores/console-store.ts";
import { useSimStore } from "../stores/sim-store.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { toSimError } from "./sim-error.ts";
import { EngineError } from "./types.ts";

function reset(): void {
  useSimStore.setState({
    session: "error",
    error: null,
    loadResult: null,
    recovering: false,
  });
  useEditorStore.setState({
    sel: useEditorStore.getState().sel,
    doc: useEditorStore.getState().doc,
  });
  useConsoleStore.setState({ lines: [], version: useConsoleStore.getState().version + 1 });
}

const BAD_TEXT = "* broken\nV1 in 0 5\nZ1 in out 1k\n.end";

describe("ErrorBanner — line pinning (W1)", () => {
  test("shows code, message, and the pinned netlist line", () => {
    reset();
    const err = toSimError(
      new EngineError({
        code: "E_PARSE",
        message: "unknown element letter 'Z'",
        location: { line: 3 },
      }),
      "load",
      { sourceText: BAD_TEXT },
    );
    useSimStore.getState().setError(err);
    const view = render(<ErrorBanner />);
    const banner = view.getByTestId("sim-banner");
    expect(banner.textContent).toContain("E_PARSE");
    expect(banner.textContent).toContain("unknown element letter");
    const line = view.getByTestId("error-line").textContent ?? "";
    expect(line).toContain("line 3");
    expect(line).toContain("Z1 in out 1k");
  });

  test("sourceMap resolves the culprit component for selection (§7.2)", () => {
    reset();
    const err = toSimError(
      new EngineError({
        code: "E_SINGULAR_MATRIX",
        message: "singular matrix",
        location: { elementName: "v1" },
      }),
      "run",
      { sourceMap: { v1: "inst-9" } },
    );
    useSimStore.getState().setError(err);
    const view = render(<ErrorBanner />);
    const btn = view.getByTestId("error-component");
    fireEvent.click(btn);
    const sel = useEditorStore.getState().sel;
    expect(sel.symbols.has("inst-9")).toBe(true);
  });

  test("load warnings show the summary row", () => {
    reset();
    useSimStore.getState().setError(null);
    useSimStore.getState().setLoadResult({
      nodeTable: [],
      branchTable: [],
      warnings: [{ code: "W_DUP", message: "duplicate reference" }],
    });
    const view = render(<ErrorBanner />);
    expect(view.getByTestId("load-warnings").textContent).toContain("1 load warning");
  });

  test("no error and no warnings → banner absent", () => {
    reset();
    useSimStore.getState().setError(null);
    useSimStore.getState().setLoadResult({ nodeTable: [], branchTable: [], warnings: [] });
    const { container } = render(<ErrorBanner />);
    expect(container.querySelector('[data-testid="sim-banner"]')).toBeNull();
  });

  test("recovering state shows the restart notice", () => {
    reset();
    useSimStore.setState({ recovering: true, error: null });
    const view = render(<ErrorBanner />);
    expect(view.getByTestId("sim-banner").textContent).toContain("Engine restarting");
  });
});

describe("no string matching on engine errors (type-test policy)", () => {
  test("toSimError derives everything from the typed surface", () => {
    // The behavioral contract: code/location come from EngineError fields,
    // never from parsing `message`. The static scan lives in
    // test/no-string-matching.test.ts (fs access is out of bounds here).
    const err = toSimError(
      new EngineError({ code: "E_NO_GROUND", message: "circuit has no node 0" }),
      "load",
      {},
    );
    expect(err.code).toBe("E_NO_GROUND");
    expect(err.location).toBeUndefined(); // nothing inferred from the message
  });
});

describe("ConsolePanel", () => {
  test("renders lines with level classes, filters, and clears", () => {
    reset();
    const log = useConsoleStore.getState();
    log.log("info", "loaded: 2 nodes");
    log.log("warn", "duplicate reference");
    log.log("error", "E_PARSE: boom");
    log.log("engine", "engine ready");
    const view = render(<ConsolePanel />);
    const panel = view.getByTestId("console-panel");
    expect(panel.getAttribute("data-testid")).toBe("console-panel");
    expect(view.getAllByTestId("console-line").length).toBe(4);

    // Filter: only errors.
    fireEvent.click(view.getByTestId("console-filter-info"));
    fireEvent.click(view.getByTestId("console-filter-warn"));
    fireEvent.click(view.getByTestId("console-filter-engine"));
    expect(view.getAllByTestId("console-line").length).toBe(1);
    expect(view.getAllByTestId("console-line")[0]?.textContent).toContain("E_PARSE");

    // Clear.
    fireEvent.click(view.getByLabelText("Clear console"));
    expect(useConsoleStore.getState().lines.length).toBe(0);
  });

  test("log is bounded (oldest lines drop)", () => {
    reset();
    const s = useConsoleStore.getState();
    for (let k = 0; k < 600; k++) {
      s.log("info", `line ${k}`);
    }
    const lines = useConsoleStore.getState().lines;
    expect(lines.length).toBe(500);
    expect(lines[lines.length - 1]?.text).toBe("line 599");
  });
});
