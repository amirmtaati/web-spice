import { expect, test } from "@playwright/test";

// Golden journey 0 (scaffold): the shell loads and performs the engine
// handshake. Journeys 1–10 of SPEC §13.5 land with their milestones.
test("shell loads and shows engine status", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toContainText("Circuit Studio");
  await expect(page.locator("header")).toContainText(/engine: (connecting|error|[0-9])/);
});
