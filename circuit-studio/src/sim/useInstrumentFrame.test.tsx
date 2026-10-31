/**
 * useInstrumentFrame profiler test (UX2-T4 done-when): "React never
 * re-renders per chunk" — a mounted instrument component's render count must
 * stay flat while hundreds of chunks stream into resultStore.
 */
import { describe, expect, test } from "bun:test";
import "../test/dom.ts";
import { render } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { setupDom } from "../test/dom.ts";

setupDom();

import { resultStore } from "../stores/result-store.ts";
import { frameStats, resetFrameStatsForTests } from "./frames.ts";
import type { SignalInfo } from "./types.ts";
import { useInstrumentFrame } from "./useInstrumentFrame.ts";

const SIGNALS: SignalInfo[] = [{ name: "v(n)", unit: "v", kind: "voltage" }];

function chunk(k: number) {
  return {
    runId: "prof",
    signals: SIGNALS,
    tStart: k,
    chunk: [{ name: "v(n)", samples: [k] }],
  };
}

let renderCount = 0;
let frameSeenValue = -1;

/** A minimal "instrument": renders once, then reads buffers in rAF. */
function FakeScope(): ReactNode {
  renderCount += 1;
  const el = useRef<HTMLSpanElement | null>(null);
  useInstrumentFrame(() => {
    // Imperative read — no state, no setState.
    const v = resultStore.lastValue("v(n)");
    frameSeenValue = v;
    if (el.current !== null) {
      el.current.textContent = String(v);
    }
  });
  return <span ref={el} data-testid="fake-scope" />;
}

describe("useInstrumentFrame — React never re-renders per chunk", () => {
  test("render count stays flat while 300 chunks stream", async () => {
    resultStore.resetForTests();
    resetFrameStatsForTests();
    renderCount = 0;
    frameSeenValue = -1;

    resultStore.beginRun("prof", { kind: "tran", tstep: 1e-3, tstop: 1e6 }, "live");
    resultStore.setSignals(SIGNALS);

    render(<FakeScope />);
    expect(renderCount).toBe(1);

    for (let k = 0; k < 300; k++) {
      resultStore.appendChunk(chunk(k));
    }
    // No React re-render was triggered by the data path.
    expect(renderCount).toBe(1);
    // The frame loop ran and read the newest sample imperatively.
    await new Promise((r) => globalThis.requestAnimationFrame(r));
    expect(frameStats().frames).toBeGreaterThan(0);
    expect(frameSeenValue).toBe(299);
    // And it painted it into the DOM without a render.
    const el = document.querySelector('[data-testid="fake-scope"]');
    expect(el?.textContent).toBe("299");

    resultStore.endRun(null);
    resultStore.resetForTests();
  });

  test("unmount unsubscribes from the frame loop", async () => {
    resultStore.resetForTests();
    resetFrameStatsForTests();
    const { unmount } = render(<FakeScope />);
    await new Promise((r) => globalThis.requestAnimationFrame(r));
    const whileMounted = frameStats().subscribers;
    unmount();
    await new Promise((r) => globalThis.requestAnimationFrame(r));
    expect(frameStats().subscribers).toBeLessThanOrEqual(whileMounted);
    expect(frameStats().subscribers).toBe(0);
    resultStore.resetForTests();
  });

  test("throttle: trailing call carries the last args", async () => {
    const { throttle } = await import("./throttle.ts");
    const seen: number[] = [];
    const t = throttle((v: number) => seen.push(v), 40);
    t(1);
    t(2);
    t(3); // only 1 sync; 3 is the trailing call
    expect(seen).toEqual([1]);
    await new Promise((r) => globalThis.setTimeout(r, 80));
    expect(seen).toEqual([1, 3]);
  });
});
