/**
 * Sim controller tests (UX2-T1 done-when): the §3 session state chart,
 * forced worker crash auto-recovery < 1 s with the project intact, the
 * one-live-run rule, and the typed error surface (W1 acceptance).
 */
import { describe, expect, test } from "bun:test";
import { resultStore } from "../stores/result-store.ts";
import { DEFAULT_ANALYSIS_OPTIONS, useSimStore } from "../stores/sim-store.ts";
import { getSimulatorClient, setSimulatorClientForTests } from "./client.ts";
import { SimController, setSimControllerForTests } from "./controller.ts";
import { notifyEngineCrash } from "./crash-hook.ts";
import type {
  DataChunk,
  EngineInfo,
  LoadResult,
  RunHandle,
  RunRequest,
  RunStats,
  SignalInfo,
  SimulatorClient,
} from "./types.ts";
import { EngineError } from "./types.ts";

// ─── mock client ──────────────────────────────────────────────────────────────

interface MockState {
  connectCount: number;
  loadedTexts: string[];
  failLoadOnce: boolean;
}

const SIGNALS: SignalInfo[] = [{ name: "v(out)", unit: "v", kind: "voltage" }];

function makeMockClient(state: MockState): SimulatorClient {
  const info: EngineInfo = {
    engineVersion: "0.2.0+core",
    capabilities: {
      analyses: ["op", "dc", "ac", "tran"],
      devices: [],
      waveforms: [],
      liveParamMode: true,
      streaming: ["buffered", "live"],
    },
    limits: {
      maxElements: 1000,
      maxNodes: 1000,
      maxTimestepsPerRun: 1e6,
      maxOutputSamples: 1e6,
      maxNetlistBytes: 1e6,
      maxSubcktNesting: 8,
      maxIncludeDepth: 4,
    },
  };
  const loadResult: LoadResult = {
    nodeTable: [
      { name: "in", index: 1 },
      { name: "out", index: 2 },
    ],
    branchTable: [{ name: "v1", index: 1 }],
    warnings: [],
  };
  return {
    connect: () => {
      state.connectCount += 1;
      return Promise.resolve(info);
    },
    loadSpice: (text: string) => {
      if (state.failLoadOnce) {
        state.failLoadOnce = false;
        return Promise.reject(
          new EngineError({
            code: "E_PARSE",
            message: "unknown element letter 'Z'",
            location: { line: 3 },
          }),
        );
      }
      state.loadedTexts.push(text);
      return Promise.resolve(loadResult);
    },
    loadCircuit: () => Promise.resolve(loadResult),
    run: (req: RunRequest) => makeMockHandle(req),
    evaluate: () => Promise.resolve(0),
    exportSpice: () => Promise.resolve("* mock"),
    dispose: () => {},
  };
}

/** Scripted run handle: the test pushes chunks / settles done manually. */
let handleCtl: {
  chunk: (c: DataChunk) => void;
  progress: (p: { runId: string; fraction: number; simTime: number }) => void;
  resolveDone: (stats: RunStats) => void;
  rejectDone: (err: Error) => void;
  stopped: boolean;
} | null = null;

function makeMockHandle(_req: RunRequest): RunHandle {
  const dataSubs = new Set<(c: DataChunk) => void>();
  const progressSubs = new Set<(p: { runId: string; fraction: number; simTime: number }) => void>();
  let settle: ((stats: RunStats) => void) | null = null;
  let fail: ((err: Error) => void) | null = null;
  const ctl = {
    chunk: (c: DataChunk) => {
      for (const cb of dataSubs) cb(c);
    },
    progress: (p: { runId: string; fraction: number; simTime: number }) => {
      for (const cb of progressSubs) cb(p);
    },
    resolveDone: (stats: RunStats) => settle?.(stats),
    rejectDone: (err: Error) => fail?.(err),
    get stopped() {
      return stopped;
    },
  };
  let stopped = false;
  handleCtl = ctl;
  const done = new Promise<RunStats>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return {
    get id() {
      return "mock-run-1";
    },
    get signals() {
      return SIGNALS;
    },
    onData: (cb) => {
      dataSubs.add(cb);
      return () => dataSubs.delete(cb);
    },
    onProgress: (cb) => {
      progressSubs.add(cb);
      return () => progressSubs.delete(cb);
    },
    pause: () => {},
    resume: () => {},
    stop: () => {
      stopped = true;
    },
    step: () => {},
    setParam: () => Promise.resolve(),
    setExternal: () => Promise.resolve(),
    done,
  };
}

const STATS: RunStats = { timesteps: 10, rejectedSteps: 0, newtonIterations: 20, method: "trap" };

function resetStores(): void {
  useSimStore.setState({
    session: "idle",
    engineInfo: null,
    loadResult: null,
    error: null,
    recovering: false,
    analysisKind: "tran",
    options: DEFAULT_ANALYSIS_OPTIONS,
    live: false,
    speed: 1,
    runId: null,
    progress: null,
    pausedSimTime: null,
    stats: null,
  });
  resultStore.resetForTests();
  handleCtl = null;
}

/** Poll until `pred` holds or the budget elapses (crash-recovery timing). */
async function waitFor(pred: () => boolean, budgetMs = 1000): Promise<boolean> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > budgetMs) {
      return false;
    }
    await new Promise((r) => globalThis.setTimeout(r, 5));
  }
  return true;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("SimController — session state chart (§3)", () => {
  test("idle → connecting → ready → loaded → running → loaded", async () => {
    resetStores();
    const mock = makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false });
    setSimulatorClientForTests(mock);
    const c = new SimController();
    setSimControllerForTests(c);

    expect(useSimStore.getState().session).toBe("idle");
    await c.ensureConnected();
    expect(useSimStore.getState().session).toBe("ready");
    expect(useSimStore.getState().engineInfo?.engineVersion).toBe("0.2.0+core");

    await c.loadSpice("* test\nR1 a b 1k\n.end");
    expect(useSimStore.getState().session).toBe("loaded");
    expect(useSimStore.getState().loadResult?.nodeTable.length).toBe(2);

    await c.run();
    expect(useSimStore.getState().session).toBe("running");
    expect(useSimStore.getState().runId).toBe("mock-run-1");

    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
    expect(useSimStore.getState().stats?.timesteps).toBe(10);
    expect(useSimStore.getState().runCounter).toBe(1);
  });

  test("load failure surfaces a typed, line-pinned error (W1 banner)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: true }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    const bad = "* broken\nV1 in 0 5\nZ1 in out 1k\n.end";
    await c.loadSpice(bad).catch(() => {}); // rejection is the error path
    const err = useSimStore.getState().error;
    expect(err).not.toBeNull();
    expect(err?.code).toBe("E_PARSE");
    expect(err?.location?.line).toBe(3);
    expect(err?.lineText).toBe("Z1 in out 1k");
    expect(useSimStore.getState().session).toBe("error");
  });

  test("chunks flow into resultStore during a run", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    await c.run();
    handleCtl?.chunk({
      runId: "mock-run-1",
      signals: SIGNALS,
      tStart: 0,
      chunk: [{ name: "v(out)", samples: [1, 2, 3] }],
    });
    expect(resultStore.sampleCount).toBe(3);
    expect(resultStore.lastValue("v(out)")).toBe(3);
    handleCtl?.resolveDone(STATS);
    await waitFor(() => !resultStore.isRunning);
    // History entry created on done.
    expect(resultStore.getSnapshot().history.length).toBe(1);
  });

  test("stop() resolves done and lands back on loaded (W2)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    await c.run();
    c.stop();
    expect(handleCtl?.stopped).toBe(true);
    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
  });
});

describe("SimController — crash recovery (§3.4)", () => {
  test("forced crash auto-recovers < 1 s with the circuit reloaded", async () => {
    resetStores();
    const state = { connectCount: 0, loadedTexts: [] as string[], failLoadOnce: false };
    setSimulatorClientForTests(makeMockClient(state));
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    const text = "* rc\nR1 a b 1k\nC1 b 0 1u\n.end";
    await c.loadSpice(text);
    await c.run();
    handleCtl?.chunk({
      runId: "mock-run-1",
      signals: SIGNALS,
      tStart: 0,
      chunk: [{ name: "v(out)", samples: [1] }],
    });

    // Force the worker crash (transport calls the registered hook).
    notifyEngineCrash();

    const ok = await waitFor(
      () =>
        useSimStore.getState().session === "loaded" && useSimStore.getState().recovering === false,
      1000,
    );
    expect(ok).toBe(true); // < 1 s
    expect(state.connectCount).toBe(2); // original + fresh session
    // Project intact: the same text was re-submitted to the fresh session.
    expect(state.loadedTexts.filter((t) => t === text).length).toBe(2);
    // The dead run was dropped without awaiting done.
    expect(useSimStore.getState().runId).toBeNull();
    expect(c.activeRunId).toBeNull();
  });

  test("recovery without a prior load lands on ready", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    notifyEngineCrash();
    await waitFor(() => useSimStore.getState().session === "ready");
  });
});

describe("SimController — run rules", () => {
  test("second run() while running stops the active run (F5 toggle)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    await c.run();
    await c.run(); // toggle
    expect(handleCtl?.stopped).toBe(true);
    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
  });

  test("live mode with a non-tran analysis downgrades to buffered", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    useSimStore.getState().setLive(true);
    useSimStore.getState().setAnalysisKind("op");
    await c.run();
    expect(useSimStore.getState().live).toBe(false); // flipped back
    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
  });

  test("run() during an in-flight load waits for the load (no orphaned run)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    // Begin a load; do NOT await it. An F5 arriving now must queue behind it.
    const loading = c.loadSpice("* slow\nR1 a b 1k\n.end");
    await c.run();
    await loading;
    // The run started AFTER the load settled (session running, one handle).
    expect(useSimStore.getState().session).toBe("running");
    expect(c.activeRunId).toBe("mock-run-1");
    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
  });

  test("pause freezes the readout time (late in-flight chunks don't move it)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    await c.run();

    // Engine streams: progress at 3 ms, then a chunk.
    handleCtl?.progress({ runId: "mock-run-1", fraction: 0, simTime: 3e-3 });
    handleCtl?.chunk({
      runId: "mock-run-1",
      signals: SIGNALS,
      tStart: 0,
      chunk: [{ name: "v(out)", samples: [1, 2, 3] }],
    });

    // Pause → the frozen readout time is the last progress simTime.
    c.pause();
    expect(useSimStore.getState().session).toBe("paused");
    expect(useSimStore.getState().pausedSimTime).toBe(3e-3);

    // In-flight tail after pause: a late chunk + progress still append to the
    // result store (real data) but the frozen readout time must not move.
    handleCtl?.progress({ runId: "mock-run-1", fraction: 0, simTime: 3.2e-3 });
    handleCtl?.chunk({
      runId: "mock-run-1",
      signals: SIGNALS,
      tStart: 0,
      chunk: [{ name: "v(out)", samples: [4] }],
    });
    expect(useSimStore.getState().pausedSimTime).toBe(3e-3);
    expect(resultStore.sampleCount).toBe(4); // tail data is kept

    // Resume clears the freeze; the readout tracks progress again.
    c.resume();
    expect(useSimStore.getState().session).toBe("running");
    expect(useSimStore.getState().pausedSimTime).toBeNull();
    handleCtl?.resolveDone(STATS);
    await waitFor(() => useSimStore.getState().session === "loaded");
  });

  test("run error rejects done → typed simStore error (§7.3)", async () => {
    resetStores();
    setSimulatorClientForTests(
      makeMockClient({ connectCount: 0, loadedTexts: [], failLoadOnce: false }),
    );
    const c = new SimController();
    setSimControllerForTests(c);
    await c.ensureConnected();
    await c.loadSpice("* ok\n.end");
    await c.run();
    handleCtl?.rejectDone(new EngineError({ code: "E_NO_CONVERGENCE", message: "Newton failed" }));
    await waitFor(() => useSimStore.getState().session === "error");
    expect(useSimStore.getState().error?.code).toBe("E_NO_CONVERGENCE");
    expect(resultStore.getSnapshot().lastError).toContain("E_NO_CONVERGENCE");
  });
});

// Restore the real client for other suites.
setSimulatorClientForTests(null);
setSimControllerForTests(null);
void getSimulatorClient;
