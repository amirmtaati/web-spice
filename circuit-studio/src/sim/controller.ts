/**
 * Sim controller (UX2-T1, AGENTS.md §3/W1): owns the engine session lifecycle
 * — connect, load (document netlist or raw text), run (buffered/live),
 * control ops, and crash recovery. The ONLY module that turns UI state into
 * RunRequests and RunHandle events into stores.
 *
 * State rules encoded (AGENTS.md §3): no run before connect+load; one live
 * run per session; loading replaces the circuit; crash ⇒ fresh session ⇒
 * re-connect + re-load (drop the dead RunHandle without awaiting `done`).
 */

import { useEditorStore } from "../editor/store.ts";
import { extractNetlist } from "../schematic/netlist.ts";
import { probeSignalsOf, probesOf } from "../schematic/probes.ts";
import { logLine } from "../stores/console-store.ts";
import { resultStore } from "../stores/result-store.ts";
import { currentAnalysisRequest, type SimState, useSimStore } from "../stores/sim-store.ts";
import { describeAnalysis } from "./axis.ts";
import { getSimulatorClient, resolveTransport } from "./client.ts";
import { registerEngineCrashHandler } from "./crash-hook.ts";
import { errText, toSimError } from "./sim-error.ts";
import type {
  AnalysisRequest,
  Circuit,
  DataChunk,
  EngineInfo,
  LoadResult,
  RunHandle,
  RunRequest,
} from "./types.ts";
import { EngineError } from "./types.ts";

/** Recover the editor doc type without importing a cycle-heavy module. */
type EditorDoc = ReturnType<typeof useEditorStore.getState>["doc"];

type LastLoad =
  | { kind: "spice"; text: string }
  | { kind: "circuit"; circuit: Circuit }
  | { kind: "document" }
  | null;

export class SimController {
  private client: ReturnType<typeof getSimulatorClient> | null = null;
  private handle: RunHandle | null = null;
  private unsubData: (() => void) | null = null;
  private unsubProgress: (() => void) | null = null;
  private lastLoad: LastLoad = null;
  private lastSourceText: string | undefined;
  private lastSourceMap: Record<string, string> | undefined;
  private connecting: Promise<EngineInfo> | null = null;
  /**
   * Operation queue: load/run are strictly sequential (AGENTS.md §3 state
   * rules). Without this, a palette load and an F5 press interleave: run()
   * starts before the load's session writes land and a live run is orphaned
   * (never stopped — the UI tracks a different handle).
   */
  private ops: Promise<unknown> = Promise.resolve();

  constructor() {
    registerEngineCrashHandler(() => this.recoverFromCrash());
  }

  /** Serialize an async operation after all previously enqueued ones. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.ops.then(op, op);
    this.ops = next.catch(() => {});
    return next;
  }

  // ─── session lifecycle ─────────────────────────────────────────────────────

  /** Connect (idempotent, AGENTS.md §3: calling connect twice is safe). */
  async ensureConnected(): Promise<EngineInfo> {
    const sim = useSimStore.getState();
    if (sim.engineInfo !== null && sim.session !== "error" && sim.session !== "recovering") {
      return sim.engineInfo;
    }
    if (this.connecting !== null) {
      return this.connecting;
    }
    this.client = getSimulatorClient();
    sim.setTransportLabel(resolveTransport());
    sim.setSession("connecting");
    sim.setError(null);
    this.connecting = this.client
      .connect()
      .then((info) => {
        const s = useSimStore.getState();
        s.setEngineInfo(info);
        s.setSession(s.loadResult !== null ? "loaded" : "ready");
        logLine("engine", `engine ready · ${info.engineVersion}`);
        return info;
      })
      .catch((err: unknown) => {
        const s = useSimStore.getState();
        s.setSession("error");
        s.setError(toSimError(err, "transport", {}));
        logLine("error", `engine connect failed: ${errText(err)}`);
        throw err;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /**
   * Load the current schematic document: extract netlist (+ probe cards),
   * submit via loadSpice. This is the "apply my edits to the engine" unit.
   */
  loadFromDocument(): Promise<LoadResult> {
    return this.enqueue(() => this.loadFromDocumentNow());
  }

  private async loadFromDocumentNow(): Promise<LoadResult> {
    const doc: EditorDoc = useEditorStore.getState().doc;
    const extraction = extractNetlist(doc);
    const probes = probesOf(doc);
    const signals = probeSignalsOf(probes);
    const withProbes =
      signals.length > 0
        ? `${extraction.netlist.trimEnd()}\n.probe ${signals.join(" ")}\n.end`
        : extraction.netlist;
    // sourceMap: engine element name → UI instance id (§7.2). Extraction keys
    // by netlist line index; the element name is the line's first token.
    const sourceMap: Record<string, string> = {};
    const netLines = extraction.netlist.split("\n");
    for (const [lineIdx, entry] of extraction.sourceMap) {
      const name = netLines[lineIdx]?.trim().split(/\s+/)[0];
      if (name !== undefined && name.length > 0) {
        sourceMap[name.toLowerCase()] = entry.instanceId;
      }
    }
    this.lastSourceMap = sourceMap;
    return this.loadSpiceNow(withProbes, { fromDocument: true, sourceMap });
  }

  /** Load raw SPICE text (examples, debug, future import). */
  loadSpice(
    text: string,
    opts: { fromDocument?: boolean; sourceMap?: Record<string, string> } = {},
  ): Promise<LoadResult> {
    return this.enqueue(() => this.loadSpiceNow(text, opts));
  }

  private async loadSpiceNow(
    text: string,
    opts: { fromDocument?: boolean; sourceMap?: Record<string, string> } = {},
  ): Promise<LoadResult> {
    await this.ensureConnected();
    const client = this.requireClient();
    this.lastLoad = opts.fromDocument ? { kind: "document" } : { kind: "spice", text };
    this.lastSourceText = text;
    if (opts.sourceMap !== undefined) {
      this.lastSourceMap = opts.sourceMap;
    }
    const sim = useSimStore.getState();
    try {
      const result = await client.loadSpice(text);
      sim.setLoadResult(result);
      sim.setSession("loaded");
      sim.setError(null);
      logLine(
        "info",
        `loaded: ${result.nodeTable.length} nodes · ${result.branchTable.length} branches`,
        result.warnings.length > 0 ? `${result.warnings.length} warning(s)` : undefined,
      );
      for (const w of result.warnings) {
        logLine("warn", w.message, w.code);
      }
      return result;
    } catch (err: unknown) {
      const simError = toSimError(err, "load", {
        sourceText: text,
        ...(this.lastSourceMap !== undefined ? { sourceMap: this.lastSourceMap } : {}),
      });
      sim.setSession("error");
      sim.setError(simError);
      logLine("error", `${simError.code}: ${simError.message}`, simError.lineText);
      throw err;
    }
  }

  /** Load a structured Circuit IR (experiments UX2-T7 will use this). */
  loadCircuit(circuit: Circuit): Promise<LoadResult> {
    return this.enqueue(() => this.loadCircuitNow(circuit));
  }

  private async loadCircuitNow(circuit: Circuit): Promise<LoadResult> {
    await this.ensureConnected();
    const client = this.requireClient();
    this.lastLoad = { kind: "circuit", circuit };
    this.lastSourceText = undefined;
    const sim = useSimStore.getState();
    try {
      const result = await client.loadCircuit(circuit);
      sim.setLoadResult(result);
      sim.setSession("loaded");
      sim.setError(null);
      logLine("info", `loaded IR: ${result.nodeTable.length} nodes`);
      return result;
    } catch (err: unknown) {
      const simError = toSimError(err, "load", {
        ...(this.lastSourceMap !== undefined ? { sourceMap: this.lastSourceMap } : {}),
      });
      sim.setSession("error");
      sim.setError(simError);
      logLine("error", `${simError.code}: ${simError.message}`);
      throw err;
    }
  }

  // ─── runs ──────────────────────────────────────────────────────────────────

  /**
   * Start a run with the current analysis settings. One live run per session:
   * a second `run()` while running/paused stops the active run first (the run
   * bar exposes this as the F5 run/stop toggle). Serialized after loads —
   * an F5 during an in-flight load applies after the load settles.
   */
  run(): Promise<void> {
    return this.enqueue(() => this.runNow());
  }

  private async runNow(): Promise<void> {
    const sim = useSimStore.getState();
    if (sim.session === "running" || sim.session === "paused") {
      this.stop();
      return;
    }
    if (this.handle !== null) {
      this.dropHandle();
    }
    const info = await this.ensureConnected();
    // Loading is the unit of "apply my edits" — always reload the document
    // before a run when the last load came from the editor (§3 rule 2).
    if (this.lastLoad === null || this.lastLoad.kind === "document") {
      await this.loadFromDocumentNow();
    }
    const analysis = currentAnalysisRequest(useSimStore.getState());
    this.assertAnalysisSupported(info, analysis);
    const mode = sim.live ? "live" : "buffered";
    if (mode === "live" && analysis.kind !== "tran") {
      // Live is tran-only (AGENTS.md §5.3) — flip to a buffered run instead of
      // failing: the run bar disables Live for non-tran kinds.
      useSimStore.getState().setLive(false);
    }
    const req: RunRequest = {
      analysis,
      ...(mode === "live"
        ? { stream: { mode: "live" as const, realtimeFactor: useSimStore.getState().speed } }
        : {}),
    };
    this.startRun(req, mode);
  }

  /** Internal: subscribe first, then issue run (AGENTS.md §5.1 pattern). */
  private startRun(req: RunRequest, mode: "buffered" | "live"): void {
    const client = this.requireClient();
    const sim = useSimStore.getState();
    const analysis = req.analysis;
    const handle = client.run(req);
    this.handle = handle;
    // Seed the store with the accepted id before subscribing — chunks cannot
    // interleave (no await between run() and onData).
    resultStore.beginRun(handle.id, analysis, mode);
    sim.setRunId(handle.id);
    sim.setProgress(null);
    sim.setPausedSimTime(null);
    sim.setStats(null);
    sim.setSession("running");
    logLine("engine", `run started · ${describeAnalysis(analysis)} · ${mode}`);
    // Subscribe synchronously — buffered chunks can arrive immediately.
    this.unsubData = handle.onData((chunk: DataChunk) => {
      // By chunk time the handle carries the engine-assigned runId; keep the
      // store pointed at it (request id → run id promotion, §5.1).
      resultStore.retargetRunId(handle.id);
      resultStore.appendChunk(chunk);
    });
    this.unsubProgress = handle.onProgress((p) => {
      useSimStore.getState().setProgress({
        fraction: p.fraction,
        simTime: p.simTime,
      });
      // Live progress: fraction is always 0 — drive from simTime (§5.3).
      if (mode === "live") {
        useSimStore.getState().setProgress({ fraction: 0, simTime: p.simTime });
      }
    });
    void handle.done.then(
      (stats) => {
        if (this.handle !== handle) {
          return; // stale (crashed/disposed) — ignore
        }
        this.finishRun();
        resultStore.endRun(stats);
        const s = useSimStore.getState();
        s.setStats(stats);
        s.bumpRunCounter();
        logLine(
          "info",
          `run done · ${stats.timesteps} steps · ${stats.newtonIterations} Newton iters`,
          stats.method,
        );
      },
      (err: unknown) => {
        if (this.handle !== handle) {
          return;
        }
        const simError = toSimError(err, "run", {
          ...(this.lastSourceText !== undefined ? { sourceText: this.lastSourceText } : {}),
          ...(this.lastSourceMap !== undefined ? { sourceMap: this.lastSourceMap } : {}),
        });
        this.finishRun();
        resultStore.endRun(null, `${simError.code}: ${simError.message}`);
        const s = useSimStore.getState();
        s.setSession("error");
        s.setError(simError);
        logLine("error", `${simError.code}: ${simError.message}`, simError.lineText);
      },
    );
  }

  // ─── control ops (§6.4; guard UI state — failures surface in DevTools) ────

  pause(): void {
    const sim = useSimStore.getState();
    if (sim.session !== "running") {
      return;
    }
    this.handle?.pause();
    // Freeze the readout NOW (scope-like Stop): control is async, so a short
    // in-flight chunk tail keeps appending after this point — the readout must
    // not track it (UX2-T3 "pause freezes").
    const t = sim.progress?.simTime ?? resultStore.axisEnd;
    sim.setPausedSimTime(Number.isFinite(t) ? t : null);
    sim.setSession("paused");
  }

  resume(): void {
    const sim = useSimStore.getState();
    if (sim.session !== "paused") {
      return;
    }
    this.handle?.resume();
    sim.setPausedSimTime(null);
    sim.setSession("running");
  }

  togglePause(): void {
    if (useSimStore.getState().session === "paused") {
      this.resume();
    } else {
      this.pause();
    }
  }

  step(): void {
    if (
      useSimStore.getState().session !== "running" &&
      useSimStore.getState().session !== "paused"
    ) {
      return;
    }
    this.handle?.step();
  }

  stop(): void {
    if (this.handle === null) {
      return;
    }
    // stop() resolves `done` with stats (§6.4) — the done path finalizes.
    this.handle.stop();
  }

  /** Live speed (×0.01…×10). Applies to the current run via engine pacing. */
  setSpeed(factor: number): void {
    useSimStore.getState().setSpeed(factor);
    // Changing realtimeFactor mid-run is not in protocol 0.2 — takes effect
    // on the next live run (documented deviation, see progress notes).
  }

  // ─── crash recovery (AGENTS.md §3.4) ───────────────────────────────────────

  /** Worker crashed: fresh empty session. Re-connect + re-load < 1 s. */
  recoverFromCrash(): void {
    const started = Date.now();
    const sim = useSimStore.getState();
    // Drop the dead run without awaiting done (it never settles after a
    // crash) — AGENTS.md §3.4. Queued pre-crash ops are discarded: the fresh
    // session gets a single authoritative reload below.
    this.ops = Promise.resolve();
    this.dropHandle();
    resultStore.endRun(null, "engine restarted (worker crash)");
    sim.setRecovering(true);
    sim.setSession("recovering");
    logLine("warn", "engine worker crashed — recovering");
    void (async () => {
      try {
        this.client = getSimulatorClient();
        const info = await this.client.connect();
        sim.setEngineInfo(info);
        // Terminal state so nested ensureConnected() calls early-return.
        sim.setSession("ready");
        const load = this.lastLoad;
        if (load === null) {
          sim.setSession("ready");
        } else if (load.kind === "document") {
          await this.loadFromDocument();
        } else if (load.kind === "spice") {
          await this.loadSpice(load.text);
        } else {
          await this.loadCircuit(load.circuit);
        }
        logLine("engine", `engine restarted in ${Date.now() - started} ms — circuit reloaded`);
      } catch (err: unknown) {
        const s = useSimStore.getState();
        s.setSession("error");
        s.setError(toSimError(err, "transport", {}));
        logLine("error", `recovery failed: ${errText(err)}`);
      } finally {
        useSimStore.getState().setRecovering(false);
      }
    })();
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private assertAnalysisSupported(info: EngineInfo, analysis: AnalysisRequest): void {
    if (!info.capabilities.analyses.includes(analysis.kind)) {
      throw new EngineError({
        code: "E_PARSE",
        message: `Analysis "${analysis.kind}" is not supported by this engine`,
      });
    }
  }

  private requireClient(): NonNullable<ReturnType<typeof getSimulatorClient>> {
    if (this.client === null) {
      this.client = getSimulatorClient();
    }
    return this.client;
  }

  private finishRun(): void {
    this.unsubData?.();
    this.unsubProgress?.();
    this.unsubData = null;
    this.unsubProgress = null;
    this.handle = null;
    const sim = useSimStore.getState();
    sim.setRunId(null);
    sim.setProgress(null);
    sim.setPausedSimTime(null);
    if (sim.session === "running" || sim.session === "paused") {
      sim.setSession("loaded");
    }
  }

  /** Drop the current handle (crash path): no stop, no done await. */
  private dropHandle(): void {
    this.unsubData?.();
    this.unsubProgress?.();
    this.unsubData = null;
    this.unsubProgress = null;
    this.handle = null;
    useSimStore.getState().setRunId(null);
  }

  /** Exposed for tests/diagnostics: the active run id, if any. */
  get activeRunId(): string | null {
    return this.handle?.id ?? null;
  }
}

/** App-wide singleton (wired in main.tsx before first client use). */
let instance: SimController | null = null;

export function getSimController(): SimController {
  if (instance === null) {
    instance = new SimController();
  }
  return instance;
}

/** Test seam: replace the singleton (injects via setSimulatorClientForTests). */
export function setSimControllerForTests(c: SimController | null): void {
  instance = c;
}

/** SimState selector helper (controller tests). */
export type { SimState };
