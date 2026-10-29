import { defineConfig } from "@playwright/test";

// E2E runs against the production build (SPEC §13.1). Browser binaries are
// installed with `bunx playwright install`; CI wiring lands with the U-track.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun --bun run vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
