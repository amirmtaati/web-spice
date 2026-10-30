/**
 * App root (UX0 shell): ToastProvider + TooltipProvider + app-level error
 * boundary around the Studio shell. The old P0 scaffold handshake now lives
 * in the run bar engine chip (`sim/useEngineStatus.ts`).
 */

import type { ReactNode } from "react";
import { StudioShell } from "../shell/StudioShell.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { ToastProvider } from "../ui/Toast.tsx";
import { TooltipProvider } from "../ui/Tooltip.tsx";

export function App(): ReactNode {
  return (
    <ErrorBoundary
      region="app"
      diagnostics={() =>
        JSON.stringify({
          region: "app",
          href: globalThis.location?.href,
          time: new Date().toISOString(),
        })
      }
    >
      <ToastProvider>
        <TooltipProvider>
          <StudioShell />
        </TooltipProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
