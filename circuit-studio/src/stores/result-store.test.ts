/**
 * resultStore tests (UX2-T2): append pipeline, throttled React snapshots,
 * axis reconstruction through the store, run history with decimated
 * envelopes, and the flat-memory soak guarantee.
 */
import { describe, expect, test } from "bun:test";
import type { DataChunk, SignalInfo } from "../sim/types.ts";
import { resultStore } from "./result-store.ts";

const SIGNALS: SignalInfo[] = [
  { name: "v(out)", unit: "v", kind: "voltage" },
  { name: "i(v1)", unit: "a", kind: "current" },
];

function tranChunk(runId: string, tStart: number, values: number[]): DataChunk {
  return {
    runId,
    signals: SIGNALS,
    tStart,
    chunk: [
      { name: "v(out)", samples: values },
      { name: "i(v1)", samples: values.map((v) => -v / 1000) },
    ],
  };
}

describe("resultStore — buffered pipeline", () => {
  test("chunks accumulate and the axis reconstructs", () => {
    resultStore.beginRun("run-1", { kind: "tran", tstep: 0.001, tstop: 0.01 }, "buffered");
    resultStore.setSignals(SIGNALS);
    resultStore.appendChunk(tranChunk("run-1", 0, [0, 0.63, 0.86]));
    resultStore.appendChunk(tranChunk("run-1", 0.003, [0.95, 0.98, 0.99]));
    expect(resultStore.sampleCount).toBe(6);
    expect(resultStore.signalNames).toEqual(["v(out)", "i(v1)"]);
    const axis = new Float64Array(6);
    expect(resultStore.readAxisInto(6, axis)).toBe(6);
    expect([...axis]).toEqual([0, 0.001, 0.002, 0.003, 0.004, 0.005]);
    const last = new Float64Array(2);
    resultStore.readLastInto("v(out)", 2, last);
    expect([...last]).toEqual([0.98, 0.99]);
    expect(resultStore.lastValue("v(out)")).toBeCloseTo(0.99, 12);
  });

  test("foreign-run chunks are ignored", () => {
    resultStore.beginRun("run-a", { kind: "tran", tstep: 1, tstop: 10 }, "buffered");
    resultStore.setSignals(SIGNALS);
    resultStore.appendChunk(tranChunk("run-other", 0, [1, 2]));
    expect(resultStore.sampleCount).toBe(0);
    resultStore.endRun(null);
  });

  test("endRun snapshots a history entry with envelope + stats", () => {
    resultStore.beginRun("run-h", { kind: "tran", tstep: 1, tstop: 100 }, "buffered");
    resultStore.setSignals(SIGNALS);
    resultStore.appendChunk(tranChunk("run-h", 0, [1, -2, 3, -4, 5]));
    resultStore.endRun({ timesteps: 5, rejectedSteps: 0, newtonIterations: 9, method: "trap" });
    const snap = resultStore.getSnapshot();
    expect(snap.history.length).toBeGreaterThan(0);
    const h = snap.history[0];
    expect(h?.id).toBe("run-h");
    expect(h?.points).toBe(5);
    expect(h?.stats?.method).toBe("trap");
    expect(h?.signals[0]?.envelope.length).toBeGreaterThan(0);
  });

  test("history keeps at most the last 5 runs", () => {
    for (let k = 0; k < 7; k++) {
      const id = `hist-${k}`;
      resultStore.beginRun(id, { kind: "op" }, "buffered");
      resultStore.setSignals(SIGNALS);
      resultStore.appendChunk({
        runId: id,
        signals: SIGNALS,
        tStart: 0,
        chunk: [
          { name: "v(out)", samples: [k] },
          { name: "i(v1)", samples: [0] },
        ],
      });
      resultStore.endRun(null);
    }
    const hist = resultStore.getSnapshot().history;
    expect(hist.length).toBe(5);
    expect(hist[0]?.id).toBe("hist-6");
    expect(hist[4]?.id).toBe("hist-2");
  });

  test("failed run records the error and skips empty history entries", () => {
    resultStore.beginRun("run-x", { kind: "tran", tstep: 1, tstop: 5 }, "buffered");
    resultStore.endRun(null, "E_NO_CONVERGENCE: Newton failed");
    const snap = resultStore.getSnapshot();
    expect(snap.lastError).toContain("E_NO_CONVERGENCE");
    expect(snap.running).toBe(false);
    expect(snap.history[0]?.id).not.toBe("run-x");
  });
});

describe("resultStore — live window + wrap", () => {
  test("live chunks continue the axis and the ring wraps at capacity", () => {
    resultStore.beginRun("live-1", { kind: "tran", tstep: 0.1, tstop: 1e9 }, "live");
    resultStore.setSignals([
      { name: "v(n)", unit: "v", kind: "voltage" },
      { name: "i(v1)", unit: "a", kind: "current" },
    ]);
    // Small probe capacity: feed 250 samples total; retain window exactly.
    for (let c = 0; c < 25; c++) {
      resultStore.appendChunk(
        tranChunk(
          "live-1",
          c * 10 * 0.1,
          Array.from({ length: 10 }, () => c),
        ),
      );
    }
    expect(resultStore.sampleCount).toBe(250);
    const axis = new Float64Array(10);
    resultStore.readAxisInto(10, axis);
    // Last 10 samples: indices 240..249 → t = 24.0 … 24.9
    expect(axis[0]).toBeCloseTo(24.0, 9);
    expect(axis[9]).toBeCloseTo(24.9, 9);
    const win = new Float64Array(10);
    resultStore.readLastInto("v(out)", 10, win);
    expect([...win]).toEqual(Array.from({ length: 10 }, () => 24));
    resultStore.endRun(null);
  });

  test("React snapshot version bumps are throttled while streaming", async () => {
    resultStore.resetForTests();
    resultStore.beginRun("throttle", { kind: "tran", tstep: 1, tstop: 1e6 }, "live");
    resultStore.setSignals(SIGNALS);
    let bumps = 0;
    const unsub = resultStore.subscribe(() => {
      bumps += 1;
    });
    for (let k = 0; k < 50; k++) {
      resultStore.appendChunk(tranChunk("throttle", k, [k]));
    }
    // Deterministic: exactly one synchronous bump (first chunk); chunks
    // 2…50 coalesce behind the 100 ms throttle.
    expect(bumps).toBe(1);
    await new Promise((r) => globalThis.setTimeout(r, 260));
    // One deferred flush at ~100 ms; the re-armed timer finds no dirty flag.
    expect(bumps).toBe(2);
    unsub();
    resultStore.endRun(null);
    resultStore.resetForTests();
  });

  test("float32 display copy tracks the same window as f64", () => {
    resultStore.beginRun("f32", { kind: "tran", tstep: 1, tstop: 100 }, "buffered");
    resultStore.setSignals(SIGNALS);
    resultStore.appendChunk(tranChunk("f32", 0, [0.25, 0.5, 0.75]));
    const disp = resultStore.readDisplay("v(out)");
    expect([...disp]).toEqual([0.25, 0.5, 0.75]);
    resultStore.endRun(null);
  });

  test("retargetRunId admits chunks under the engine-assigned run id (§5.1)", () => {
    resultStore.beginRun("req-1", { kind: "tran", tstep: 1, tstop: 10 }, "buffered");
    resultStore.setSignals(SIGNALS);
    // Chunks arrive with the ENGINE run id (handle.id promotes on runAccepted);
    // without retarget they would be dropped.
    resultStore.appendChunk(tranChunk("run-9", 0, [1]));
    expect(resultStore.sampleCount).toBe(0);
    resultStore.retargetRunId("run-9");
    resultStore.appendChunk(tranChunk("run-9", 1, [2]));
    expect(resultStore.sampleCount).toBe(1);
    expect(resultStore.lastValue("v(out)")).toBe(2);
    resultStore.endRun(null);
    resultStore.resetForTests();
  });

  test("soak: 200k samples in 2k chunks leave memory flat and data correct", () => {
    resultStore.beginRun("soak", { kind: "tran", tstep: 1e-3, tstop: 1e9 }, "live");
    resultStore.setSignals(SIGNALS);
    const vals = new Array(100).fill(0).map((_, k) => k);
    for (let c = 0; c < 2000; c++) {
      resultStore.appendChunk(tranChunk("soak", c * 100 * 1e-3, vals));
    }
    expect(resultStore.sampleCount).toBe(200_000);
    // Retained window = capacity (1<<20 ≥ 200k → everything retained).
    expect(resultStore.readSignal("v(out)").length).toBe(200_000);
    const axis = new Float64Array(2);
    resultStore.readAxisInto(2, axis);
    expect(axis[1]).toBeCloseTo(199.999, 6);
    resultStore.endRun(null);
  });
});
