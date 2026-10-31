import { expect, test } from "@playwright/test";

// Journey 2 (UX2): simulation control + results plumbing. Load the RC
// example from the palette, run a buffered tran with F5, and assert the
// NUMERIC result through resultStore: v(out) at t = τ is 63.2 % of V1 ±2 %
// (§13.5 journey 1 numeric gate, wired through the sim controller).
test("RC example: F5 runs a buffered tran; v(out) hits 63.2 % at τ", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });

  // Load the RC example via the palette (deterministic named nodes).
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill("rc charging");
  await page.keyboard.press("Enter");
  // Wait for the palette to fully close before sending shortcuts — the
  // modal guard swallows global keys while the dialog is closing.
  await expect(input).toBeHidden();

  // Run (F5) and wait for the done stats (method chip appears).
  await page.keyboard.press("F5");
  await expect(page.getByTestId("method-chip")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("run-btn")).toContainText("Run"); // back to idle
  await expect(page.getByTestId("sim-time")).not.toContainText("t = —");

  // Numeric assertion through the resultStore debug handle: v(out)(t=τ) =
  // 5·(1 − e^(−1)) ≈ 3.1607 V (±2 %), τ = 1 ms at sample 100 (tstep 10 µs).
  const vTau = await page.evaluate(() => {
    const studio = (
      window as unknown as {
        studio: { readSignal: (n: string) => { axis: number[]; values: number[] } };
      }
    ).studio;
    const { axis, values } = studio.readSignal("v(out)");
    // Interpolate at t = 1 ms (tolerant to grid rounding).
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let k = 0; k < axis.length; k++) {
      const d = Math.abs((axis[k] ?? 0) - 1e-3);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return { value: values[best] ?? 0, points: values.length, tauDist: bestDist };
  });
  expect(vTau.points).toBeGreaterThan(100);
  expect(vTau.tauDist).toBeLessThan(1e-4); // grid step is 1e-5
  expect(vTau.value).toBeGreaterThan(5 * (1 - Math.E ** -1) * 0.98);
  expect(vTau.value).toBeLessThan(5 * (1 - Math.E ** -1) * 1.02);
});

// Journey 2b: live mode streams through the frame sink — sim time advances
// via rAF (no React re-render per chunk), and pause/stop respond.
test("live tran: sim time advances, pause freezes, stop returns", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });

  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-input").fill("rc charging");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette-input")).toBeHidden();

  // Live mode defaults to Tran analysis — toggle Live and run.
  await page.getByTestId("live-toggle").click();
  await page.keyboard.press("F5");
  await expect(page.getByTestId("run-btn")).toContainText("Stop", { timeout: 10_000 });

  // Sim time readout (rAF-driven) must advance.
  const t1 = await page.getByTestId("sim-time").textContent();
  await page.waitForTimeout(600);
  const t2 = await page.getByTestId("sim-time").textContent();
  expect(t1).not.toBe(t2);

  // Frames flow through the shared frame sink (instrument path).
  const frames = await page.evaluate(() => {
    const studio = (
      window as unknown as {
        studio: { frames: () => { frames: number } };
      }
    ).studio;
    return studio.frames().frames;
  });
  expect(frames).toBeGreaterThan(5);

  // F6 pause freezes time (wait for the paused state, then sample twice);
  // F5 stops and returns to Run.
  await page.keyboard.press("F6");
  await expect(page.getByTestId("pause-btn")).toHaveAttribute("aria-label", "Resume", {
    timeout: 10_000,
  });
  const p1 = await page.getByTestId("sim-time").textContent();
  await page.waitForTimeout(400);
  const p2 = await page.getByTestId("sim-time").textContent();
  expect(p1).toBe(p2);

  await page.keyboard.press("F5");
  await expect(page.getByTestId("run-btn")).toContainText("Run", { timeout: 10_000 });
});

// Journey 2c (W1): running on an empty schematic surfaces the typed error
// banner (E_FLOATING_NODE) — never a crash, never a string-matched message.
test("empty schematic run shows the typed error banner", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });

  await page.keyboard.press("F5");
  const banner = page.getByTestId("sim-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("E_FLOATING_NODE");
  await expect(banner).toContainText("no non-ground nodes");

  // Dismiss works.
  await page.getByLabel("Dismiss error").click();
  await expect(page.getByTestId("sim-banner")).toHaveCount(0);
});

// UX2 acceptance (§13.5 journey 2 numeric gate): load an amplifier, run AC,
// and assert the MIDBAND GAIN through resultStore. The ideal op-amp inverting
// stage gives an exact analytic gain: vm(out) = Rf/Rin = 10 (±1 %).
test("inverting amplifier: AC midband gain is 10 (±1 %)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });

  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-input").fill("inverting amplifier");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette-input")).toBeHidden();

  // Switch the analysis kind to AC and run.
  await page.getByRole("button", { name: "Analysis type: AC" }).click();
  await page.keyboard.press("F5");
  await expect(page.getByTestId("method-chip")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("run-btn")).toContainText("Run");

  // Midband gain through the resultStore debug handle: vm(out) @ 1 kHz = 10.
  const gain = await page.evaluate(() => {
    const studio = (
      window as unknown as {
        studio: { readSignal: (n: string) => { axis: number[]; values: number[] } };
      }
    ).studio;
    const { axis, values } = studio.readSignal("vm(out)");
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let k = 0; k < axis.length; k++) {
      const d = Math.abs((axis[k] ?? 0) - 1e3);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return { value: values[best] ?? 0, points: values.length };
  });
  expect(gain.points).toBeGreaterThan(10); // dec sweep, ≥ 20 pts/decade band
  expect(gain.value).toBeGreaterThan(9.9); // −10 gain, |H| = 10 ±1 %
  expect(gain.value).toBeLessThan(10.1);
});

// UX2-T3 keyboard detail: F5 toggles to Stop while running (run/stop toggle).
// Uses a LIVE run — a buffered 10 ms tran completes faster than the first
// poll, so the Stop state would be unobservable.
test("F5 acts as run/stop toggle (§6.1)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId("engine-chip")).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, {
    timeout: 15_000,
  });

  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-input").fill("rc charging");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette-input")).toBeHidden();

  await page.getByTestId("live-toggle").click();
  await page.keyboard.press("F5");
  await expect(page.getByTestId("run-btn")).toContainText("Stop", { timeout: 10_000 });
  await page.keyboard.press("F5"); // toggle → stop
  await expect(page.getByTestId("run-btn")).toContainText("Run", { timeout: 10_000 });
});
