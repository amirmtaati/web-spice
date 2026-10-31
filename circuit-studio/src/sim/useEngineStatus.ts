/**
 * Engine status hook (UX0-T6 → UX2-T1): a thin view over simStore. The
 * controller owns the actual handshake (started once on first mount);
 * reconnect = crash-recovery path (re-connect + re-load, §3.4).
 */
import { useEffect } from "react";
import { useSimStore } from "../stores/sim-store.ts";
import { getSimController } from "./controller.ts";

export interface EngineStatus {
  readonly state: "connecting" | "ready" | "recovering" | "error";
  readonly engineVersion?: string;
  readonly transportLabel: string;
  readonly message?: string;
}

export function useEngineStatus(): {
  readonly status: EngineStatus;
  readonly reconnect: () => void;
} {
  const session = useSimStore((s) => s.session);
  const engineVersion = useSimStore((s) => s.engineInfo?.engineVersion);
  const transportLabel = useSimStore((s) => s.transportLabel);
  const errorMessage = useSimStore((s) => s.error?.message);

  useEffect(() => {
    void getSimController()
      .ensureConnected()
      .catch(() => {
        /* error state surfaces via the chip */
      });
  }, []);

  const state: EngineStatus["state"] =
    session === "error"
      ? "error"
      : session === "recovering"
        ? "recovering"
        : session === "idle"
          ? "connecting"
          : "ready";

  return {
    status: {
      state,
      ...(engineVersion === undefined ? {} : { engineVersion }),
      transportLabel,
      ...(errorMessage === undefined ? {} : { message: errorMessage }),
    },
    reconnect: () => {
      getSimController().recoverFromCrash();
    },
  };
}
