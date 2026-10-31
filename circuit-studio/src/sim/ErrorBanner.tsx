/**
 * Error banner (UX2-T5, AGENTS.md W1 acceptance): typed engine/load errors
 * surface with their code, message, and — when the engine pinned a location —
 * the offending netlist line and the schematic component (via Circuit.
 * sourceMap, never string matching, §7.2). Clicking the component chip
 * selects it in the editor. Warnings from LoadResult surface as a summary
 * row linking to the console.
 */
import { AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEditorStore } from "../editor/store.ts";
import { emptySelection } from "../schematic/types.ts";
import { logLine } from "../stores/console-store.ts";
import { type SimError, useSimStore } from "../stores/sim-store.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

export function ErrorBanner(): ReactNode {
  const error = useSimStore((s) => s.error);
  const warnings = useSimStore((s) => s.loadResult?.warnings);
  const recovering = useSimStore((s) => s.recovering);

  if (recovering) {
    return (
      <div
        data-testid="sim-banner"
        role="status"
        className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-2xs text-muted"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" aria-hidden="true" />
        Engine restarting — reloading circuit…
      </div>
    );
  }

  const warningCount = warnings?.length ?? 0;
  if (error === null && warningCount === 0) {
    return null;
  }
  return (
    <div data-testid="sim-banner" role="alert" className="border-b border-line">
      {error !== null ? <EngineErrorRow error={error} /> : null}
      {warningCount > 0 ? (
        <div className="flex items-center gap-2 bg-panel px-3 py-1.5 text-2xs text-muted">
          <AlertTriangle size={13} strokeWidth={1.5} className="text-warning" aria-hidden="true" />
          <span data-testid="load-warnings">
            {warningCount} load warning{warningCount === 1 ? "" : "s"} — details in console
          </span>
        </div>
      ) : null}
    </div>
  );
}

function EngineErrorRow({ error }: { readonly error: SimError }): ReactNode {
  const componentId = error.componentId;
  const select = useEditorStore((s) => s.setSelection);
  return (
    <div className="flex items-start gap-2 bg-panel px-3 py-1.5 text-2xs">
      <Badge tone="error">{error.code}</Badge>
      <div className="min-w-0 flex-1">
        <p className="text-fg">{error.message}</p>
        {error.lineText !== undefined ? (
          <p className="mt-0.5 font-mono text-faint" data-testid="error-line">
            line {error.location?.line}: {error.lineText}
          </p>
        ) : null}
        {error.location?.node !== undefined ? (
          <p className="mt-0.5 font-mono text-faint">node {error.location.node}</p>
        ) : null}
      </div>
      {componentId !== undefined ? (
        <Button
          size="sm"
          data-testid="error-component"
          onClick={() => {
            select({ ...emptySelection(), symbols: new Set([componentId]) });
            logLine("info", `highlighted component ${componentId} (from ${error.code})`);
          }}
        >
          Show in schematic
        </Button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss error"
        className="rounded p-1 text-faint hover:bg-elevated hover:text-muted"
        onClick={() => useSimStore.getState().setError(null)}
      >
        <X size={13} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
