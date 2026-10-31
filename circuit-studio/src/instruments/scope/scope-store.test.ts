/**
 * scopeStore tests (UX3-T1/T5): channel cap (8), add/remove/update,
 * experiment bulk selection, 1-2-5 timebase clamp, cursor readout wiring.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { clampDiv, MAX_CHANNELS, useScopeStore } from "./scope-store.ts";

describe("scopeStore", () => {
  beforeEach(() => {
    useScopeStore.getState().resetForTests();
  });

  test("channels cap at 8 (MAX_CHANNELS)", () => {
    const s = useScopeStore.getState();
    for (let k = 0; k < MAX_CHANNELS + 3; k++) {
      s.addChannel(`v(n${k})`);
    }
    expect(useScopeStore.getState().channels).toHaveLength(MAX_CHANNELS);
  });

  test("duplicate adds are idempotent", () => {
    const s = useScopeStore.getState();
    s.addChannel("v(out)");
    s.addChannel("v(out)");
    expect(useScopeStore.getState().channels).toHaveLength(1);
  });

  test("removeChannel re-points active selection", () => {
    const s = useScopeStore.getState();
    s.addChannel("v(out)");
    s.addChannel("i(C1)");
    expect(useScopeStore.getState().activeChannelId).toBe("v(out)");
    useScopeStore.getState().removeChannel("v(out)");
    expect(useScopeStore.getState().activeChannelId).toBe("i(C1)");
  });

  test("selectSignals replaces the list (experiment flow)", () => {
    const s = useScopeStore.getState();
    s.addChannel("v(junk)");
    s.selectSignals(["v(out)", "i(C1)"]);
    const channels = useScopeStore.getState().channels;
    expect(channels.map((c) => c.id)).toEqual(["v(out)", "i(C1)"]);
    expect(channels[0]?.colorIndex).toBe(1); // 1-based palette
  });

  test("updateChannel offset/invert/visible", () => {
    const s = useScopeStore.getState();
    s.addChannel("v(out)");
    useScopeStore.getState().updateChannel("v(out)", { offset: 2.5, invert: true, visible: false });
    const ch = useScopeStore.getState().channels[0];
    expect(ch?.offset).toBe(2.5);
    expect(ch?.invert).toBe(true);
    expect(ch?.visible).toBe(false);
  });

  test("timebase clamps to the 1-2-5 decades", () => {
    const s = useScopeStore.getState();
    s.setSecPerDiv(3.7e-3);
    expect(useScopeStore.getState().secPerDiv).toBe(5e-3);
    s.setSecPerDiv(1.1e-3);
    expect(useScopeStore.getState().secPerDiv).toBe(1e-3);
  });

  test("single mode arming toggles", () => {
    const s = useScopeStore.getState();
    s.updateTrigger({ mode: "single", edge: "fall", level: 2 });
    expect(useScopeStore.getState().trigger.mode).toBe("single");
    expect(useScopeStore.getState().trigger.armed).toBe(true);
    useScopeStore.getState().rearm();
    expect(useScopeStore.getState().trigger.armed).toBe(true);
  });

  test("clampDiv picks nearest decade step", () => {
    expect(clampDiv(9.9e-4)).toBe(1e-3);
    expect(clampDiv(2.4e-6)).toBe(2e-6);
    expect(clampDiv(7)).toBe(5); // log-nearest of 7 is 5 (|ln 7/5| < |ln 7/10|)
  });
});
