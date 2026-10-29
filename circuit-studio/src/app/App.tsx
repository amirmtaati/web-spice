/**
 * App shell (P0 scaffold — SPEC §22 P0: "UI shell connecting to the stub in
 * worker mode"). The dockable layout (dockview), run bar controls, and the
 * schematic canvas land with the U milestones; this shell already performs a
 * real protocol handshake against the engine on mount.
 */
import { useEffect, useState } from "react";
import { getSimulatorClient } from "../sim/client.ts";
import { useUiStore } from "../stores/ui-store.ts";
import { THEMES, type ThemeId } from "./theme.ts";

type EngineChip =
  | { state: "connecting" }
  | { state: "ok"; version: string; transport: string }
  | { state: "error"; message: string };

export function App() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [engine, setEngine] = useState<EngineChip>({ state: "connecting" });

  useEffect(() => {
    let cancelled = false;
    const client = getSimulatorClient();
    client
      .connect()
      .then((info) => {
        if (!cancelled) {
          setEngine({ state: "ok", version: info.engineVersion, transport: "in-process (stub)" });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEngine({ state: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
      >
        <span className="text-sm font-semibold tracking-wide">Circuit Studio</span>
        <EngineStatus chip={engine} />
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="theme-select" className="text-xs" style={{ color: "var(--fg-muted)" }}>
            Theme
          </label>
          <select
            id="theme-select"
            aria-label="Theme"
            className="rounded border bg-transparent px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeId)}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="flex flex-1" style={{ background: "var(--canvas-bg)" }}>
        {/* Schematic canvas placeholder — replaced by the GPU renderer (U1). */}
        <div
          className="flex flex-1 items-center justify-center text-sm"
          style={{ color: "var(--fg-muted)" }}
        >
          <div className="text-center">
            <p>Schematic editor lands with U1–U3 (SPEC §22).</p>
            <p className="mt-1 text-xs">
              Run bar, dockable instruments, and dashboard arrive with U4.
            </p>
          </div>
        </div>
      </main>

      <footer
        className="flex items-center gap-4 border-t px-4 py-1 text-xs"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-panel)",
          color: "var(--fg-muted)",
        }}
      >
        <span>P0 scaffold</span>
        <span>·</span>
        <span>spec: docs/spec/SPEC.md</span>
        <span>·</span>
        <span>Run / Pause / Stop appear with the run bar (§8.4)</span>
      </footer>
    </div>
  );
}

function EngineStatus({ chip }: { chip: EngineChip }) {
  if (chip.state === "connecting") {
    return (
      <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
        engine: connecting…
      </span>
    );
  }
  if (chip.state === "error") {
    return <span className="text-xs text-red-400">engine: error ({chip.message})</span>;
  }
  return (
    <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
      engine: <span style={{ color: "var(--accent)" }}>{chip.version}</span> · {chip.transport}
    </span>
  );
}
