import { defineConfig } from "@playwright/test";

// E2E runs against the production build (SPEC §13.1). Browser binaries are
// installed with `bunx playwright install`; CI wiring lands with the U-track.
export default defineConfig({
  testDir: "e2e",
  // Bun's test glob matches *.spec.ts, so Playwright suites use *.e2e.ts
  // (ADR 007) to keep `bun test circuit-studio` free of browser suites.
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run build && bun --bun run vite preview --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
