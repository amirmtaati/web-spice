import { expect, type Page, test } from "@playwright/test";
import { GALLERY, type GalleryCircuit } from "../src/netlist/examples.ts";

/**
 * UX3 journeys (production build + worker transport — playwright.config
 * builds and serves via `vite preview`). Scope, experiments, plots, export,
 * and the 12-circuit gallery end-to-end. Desktop viewport: the Debug
 * preset's instrument dock needs real height for interactive scope work.
 */
test.use({ viewport: { width: 1720, height: 1000 } });

async function boot(page: Page, preset = "layout: debug"): Promise<void> {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill(preset);
  await page.keyboard.press("Enter");
  await expect(input).toBeHidden();
}

async function runFromPalette(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill(query);
  await page.keyboard.press("Enter");
  await expect(input).toBeHidden();
}

interface Studio {
  sim: () => {
    loadSpice: (text: string) => Promise<unknown>;
    run: () => Promise<void>;
  };
  simStore: {
    getState: () => {
      session: string;
      setAnalysisKind: (k: GalleryCircuit["kind"]) => void;
      setOptions: (k: GalleryCircuit["kind"], patch: object) => void;
    };
  };
  resultStore: { getSnapshot: () => { sampleCount: number; signalNames: string[] } };
  scopeStore: {
    getState: () => {
      channels: { id: string }[];
      experiment: {
        tau?: number;
        annotations: {
          kind: string;
          y?: number;
          x?: number | "tau";
          from?: number | "3tau";
          to?: number | "5tau";
        }[];
      } | null;
      updateCursors: (patch: { x1?: number | null; x2?: number | null }) => void;
    };
  };
  readSignal: (name: string) => { axis: number[]; values: number[] };
}

async function waitForRunDone(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const studio = (window as unknown as { studio: Studio }).studio;
          return studio.simStore.getState().session;
        }),
      { timeout: 30_000 },
    )
    .not.toBe("running");
}

// ─── Journey: experiment RC charging (the flagship §6.7.4 flow) ──────────────

test("experiment RC charging: channels, callout, τ annotations, Estimate-τ fit", async ({
  page,
}) => {
  await boot(page);
  await runFromPalette(page, "experiment: rc charging");
  await waitForRunDone(page);

  // Scope auto-wired the streamed signals (the engine streams node
  // voltages in tran — v(out) for the RC experiment).
  await expect(page.getByTestId("scope-legend")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("scope-row-v(out)")).toBeVisible();

  // Callout card teaches without leaving the tool.
  await expect(page.getByTestId("callout-card")).toContainText("RC charging");
  await expect(page.getByTestId("callout-card")).toContainText("63.2 %");

  // Experiment context: τ = R·C = 1 ms; the 63.2 % hline sits at 3.160 V ±2 %.
  const exp = await page.evaluate(() => {
    const studio = (window as unknown as { studio: Studio }).studio;
    const e = studio.scopeStore.getState().experiment;
    return { tau: e?.tau, hline: e?.annotations.find((a) => a.kind === "hline")?.y };
  });
  expect(exp.tau).toBeCloseTo(1e-3, 6);
  expect(exp.hline).toBeGreaterThan(5 * (1 - Math.E ** -1) * 0.98);
  expect(exp.hline).toBeLessThan(5 * (1 - Math.E ** -1) * 1.02);

  // "Estimate τ from cursor": span X1…X2 across the transient and fit.
  await page.evaluate(() => {
    const studio = (window as unknown as { studio: Studio }).studio;
    studio.scopeStore.getState().updateCursors({ x1: 0, x2: 2e-3 });
  });
  await page.getByTestId("estimate-tau").click();
  await expect(page.getByTestId("tau-result")).toContainText("τ ≈", { timeout: 5_000 });
  const tauText = (await page.getByTestId("tau-result").textContent()) ?? "";
  // Format: "τ ≈ 1.00 ms (R² 0.999…)" — parse to seconds, accept 5 %.
  const match = /τ ≈ ([\d.]+)\s*(ns|µs|ms|s)/.exec(tauText);
  expect(match).not.toBeNull();
  const value = Number(match?.[1] ?? 0);
  const unit = match?.[2] ?? "s";
  const tauSec = value * ({ ns: 1e-9, µs: 1e-6, ms: 1e-3, s: 1 }[unit] ?? 1);
  expect(tauSec / 1e-3).toBeGreaterThan(0.95);
  expect(tauSec / 1e-3).toBeLessThan(1.05);
});

// ─── Journey: gallery 1–12 end-to-end through the UI (worker transport) ─────

test("gallery circuits 1–12 run end-to-end through the production UI", async ({ page }) => {
  await boot(page);
  for (const g of GALLERY) {
    const result = await page.evaluate(async (g: GalleryCircuit) => {
      const studio = (window as unknown as { studio: Studio }).studio;
      const withProbes = `${g.netlist.trimEnd().replace(/\.end\s*$/, "")}\n.probe ${g.probes.join(" ")}\n.end`;
      await studio.sim().loadSpice(withProbes);
      const sim = studio.simStore.getState();
      sim.setAnalysisKind(g.kind);
      if (g.analysis.kind !== "op") {
        sim.setOptions(g.kind, g.analysis);
      }
      await studio.sim().run();
      // Wait for the run to settle (session returns to loaded/error).
      for (let t = 0; t < 600; t++) {
        const session = studio.simStore.getState().session;
        if (session !== "running" && session !== "paused") {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const snap = studio.resultStore.getSnapshot();
      return {
        session: studio.simStore.getState().session,
        points: snap.sampleCount,
        signals: [...snap.signalNames],
      };
    }, g);
    expect(result.session, `${g.id} session`).toBe("loaded");
    expect(result.points, `${g.id} points`).toBeGreaterThan(0);
    for (const probe of g.probes) {
      const hit = result.signals.some((s) => s.toLowerCase() === probe.toLowerCase());
      expect(hit, `${g.id} probe ${probe}`).toBe(true);
    }
  }
});

// ─── Journey: Sallen-Key Bode numeric through the UI ─────────────────────────

test("Sallen-Key Bode: −3 dB corner ≈ 1024 Hz (±5 %) in the Plots panel", async ({ page }) => {
  await boot(page);
  const g6 = GALLERY[5];
  if (g6 === undefined) {
    throw new Error("gallery missing");
  }
  await page.evaluate(async (g: GalleryCircuit) => {
    const studio = (window as unknown as { studio: Studio }).studio;
    const withProbes = `${g.netlist.trimEnd().replace(/\.end\s*$/, "")}\n.probe ${g.probes.join(" ")}\n.end`;
    await studio.sim().loadSpice(withProbes);
    const sim = studio.simStore.getState();
    sim.setAnalysisKind("ac");
    sim.setOptions("ac", g.analysis);
    await studio.sim().run();
    for (let t = 0; t < 600; t++) {
      const session = studio.simStore.getState().session;
      if (session !== "running") {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }, g6);

  // Focus the Plots panel (Debug preset docks scope+console+OP; the command
  // requests panel focus and dockview raises it).
  await page.evaluate(() => {
    const studio = (
      window as unknown as {
        studio: {
          shellStore: { getState: () => { requestPanelFocus: (id: string) => void } };
        };
      }
    ).studio;
    studio.shellStore.getState().requestPanelFocus("plots");
  });
  await expect(page.getByTestId("bode-features")).toBeVisible({ timeout: 10_000 });
  const text = (await page.getByTestId("bode-features").textContent()) ?? "";
  // "f₋₃ᵈᵇ = 1.02 kHz" → parse value+unit, assert vs analytic 0.6436·f₀.
  const m = /f₋₃ᵈᵇ = ([\d.]+)\s*(Hz|kHz|MHz)/.exec(text);
  expect(m).not.toBeNull();
  const val = Number(m?.[1] ?? 0) * ({ Hz: 1, kHz: 1e3, MHz: 1e6 }[m?.[2] ?? "Hz"] ?? 1);
  const f0 = 1 / (2 * Math.PI * 1e3 * 1e-7);
  const expected = 0.6436 * f0;
  expect(Math.abs(val - expected) / expected).toBeLessThan(0.05);
});

// ─── Journey: PNG/CSV export bytes validated (UX3-T8) ────────────────────────

test("scope exports: CSV header/rows and PNG magic bytes", async ({ page }) => {
  await boot(page);
  await runFromPalette(page, "experiment: rc charging");
  await waitForRunDone(page);
  await expect(page.getByTestId("scope-legend")).toBeVisible({ timeout: 10_000 });

  const menu = page.getByLabel("Export plot");
  await expect(menu).toBeVisible();

  // CSV: open the menu, wait for the item, click, capture the download.
  await menu.click();
  const csvItem = page.getByText("CSV data (full run)");
  await expect(csvItem).toBeVisible();
  const [csv] = await Promise.all([page.waitForEvent("download"), csvItem.click()]);
  const csvPath = await csv.path();
  expect(csvPath).not.toBeNull();
  const fs = await import("node:fs/promises");
  const csvText = await fs.readFile(csvPath ?? "", "utf8");
  const lines = csvText.trim().split("\n");
  expect(lines[0]).toContain("# axis (s)");
  expect(lines[0]).toContain("v(out)");
  expect(lines.length).toBeGreaterThan(300); // 5 ms / 10 µs grid

  // PNG: reopen the menu (the first selection closed it).
  await menu.click();
  const pngItem = page.getByText("PNG image");
  await expect(pngItem).toBeVisible();
  const [png] = await Promise.all([page.waitForEvent("download"), pngItem.click()]);
  const pngPath = await png.path();
  const buf = await fs.readFile(pngPath ?? "");
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A.
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
});

// ─── Perf gate (§10, UX3-T1): 60 fps with a 100 k-point window ───────────────

test("scope trace: ≥ 55 fps with a 100 k-point decimated window", async ({ page }) => {
  await boot(page);
  const netlist = `* 100k-sample transient (perf gate)
V1 in 0 PULSE(0 5 0 1u 1u 50m 100m)
R1 in out 1k
C1 out 0 100u
.probe v(out)
.end`;
  await page.evaluate(async (netlist: string) => {
    const studio = (window as unknown as { studio: Studio }).studio;
    await studio.sim().loadSpice(netlist);
    const sim = studio.simStore.getState();
    sim.setAnalysisKind("tran");
    sim.setOptions("tran", { tstep: 1e-6, tstop: 0.1, tstart: 0, uic: false });
    await studio.sim().run();
    for (let t = 0; t < 1200; t++) {
      const session = studio.simStore.getState().session;
      if (session !== "running") {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }, netlist);

  await expect(page.getByTestId("scope-legend")).toBeVisible({ timeout: 10_000 });
  // Measure rAF fps over ~1.5 s while the scope renders the decimated window.
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (): void => {
          frames += 1;
          if (performance.now() - start < 1500) {
            requestAnimationFrame(tick);
          } else {
            resolve((frames * 1000) / (performance.now() - start));
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(fps).toBeGreaterThanOrEqual(55);
  const points = await page.evaluate(() => {
    const studio = (window as unknown as { studio: Studio }).studio;
    return studio.resultStore.getSnapshot().sampleCount;
  });
  expect(points).toBeGreaterThan(50_000);
});
