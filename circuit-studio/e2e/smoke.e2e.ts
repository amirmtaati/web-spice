import { expect, test } from "@playwright/test";

// Journey 0 (UX0): the shell loads, docks mount, the engine handshakes over
// the Web Worker, the palette runs a command, and presets switch. Journeys
// 1–10 of SPEC §13.5 land with their milestones (UX1+).
test("shell loads, docks mount, and the engine chip handshakes (worker)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("titlebar")).toContainText("Circuit Studio");
  await expect(page.getByTestId("tool-rail")).toBeVisible();
  await expect(page.getByTestId("runbar")).toBeVisible();
  await expect(page.getByTestId("statusbar")).toBeVisible();

  // Engine chip: connecting → ready with a version + worker transport label.
  const chip = page.getByTestId("engine-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, { timeout: 15_000 });
  await expect(chip).toContainText("worker");

  // Dockview mounted with the Build preset's canvas tab.
  await expect(page.getByTestId("dock-root")).toContainText("Schematic", { timeout: 15_000 });
});

test("command palette opens with Ctrl+K, filters, and runs a command", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });

  await page.keyboard.press("Control+k");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill("paper");
  await expect(page.getByTestId("palette-item").first()).toContainText("Theme: Paper");
  await page.keyboard.press("Enter");

  // Theme: Paper applied via data-theme on the root.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
});

test("layout presets switch via the title bar menu and keep the canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });

  await page.getByRole("button", { name: "Layout preset" }).click();
  await page.getByRole("menuitem", { name: "Debug" }).click();
  await expect(page.getByTestId("dock-root")).toContainText("Scope", { timeout: 15_000 });
  await expect(page.getByTestId("dock-root")).toContainText("Schematic");

  await page.getByRole("button", { name: "Layout preset" }).click();
  await page.getByRole("menuitem", { name: "Build" }).click();
  await expect(page.getByTestId("dock-root")).toContainText("Library", { timeout: 15_000 });
  await expect(page.getByTestId("dock-root")).toContainText("Schematic");
});

test("in-process transport override works (?transport=in-process)", async ({ page }) => {
  await page.goto("/?transport=in-process");
  const chip = page.getByTestId("engine-chip");
  await expect(chip).toContainText(/engine [0-9]+\.[0-9]+\.[0-9]+/, { timeout: 15_000 });
  await expect(chip).toContainText("in-process");
});

test("shortcut overlay opens with ?", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dock-root").waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Shift+Slash"); // "?"
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Command palette");
});
