import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// UI bundler/dev server (SPEC §3.1): Vite executed by Bun (`bun --bun run vite`).
// Strict CSP-compatible output (no inline scripts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // The transport spawns the engine worker with {type:"module"} — emit ESM.
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Instruments are lazy-loaded chunks (SPEC §15.1 budgets).
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
