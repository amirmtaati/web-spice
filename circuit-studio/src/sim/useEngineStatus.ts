/**
 * Engine status hook (UX0-T6, §6.1): one handshake on mount, exposed to the
 * run bar and status bar chips. States: connecting → ready | error; the
 * error state carries the message and a reconnect action (worker crash
 * auto-recovery hardening lands with UX5).
 */
import { useEffect, useState } from "react";
import { getSimulatorClient, resolveTransport } from "./client.ts";

export interface EngineStatus {
  readonly state: "connecting" | "ready" | "error";
  readonly engineVersion?: string;
  readonly transportLabel: string;
  readonly message?: string;
}

const TRANSPORT_LABEL = resolveTransport() === "in-process" ? "in-process" : "worker";

export function useEngineStatus(): {
  readonly status: EngineStatus;
  readonly reconnect: () => void;
} {
  const [status, setStatus] = useState<EngineStatus>({
    state: "connecting",
    transportLabel: TRANSPORT_LABEL,
  });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the manual reconnect trigger
  useEffect(() => {
    let cancelled = false;
    const client = getSimulatorClient();
    client
      .connect()
      .then((info) => {
        if (!cancelled) {
          setStatus({
            state: "ready",
            engineVersion: info.engineVersion,
            transportLabel: TRANSPORT_LABEL,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({
            state: "error",
            transportLabel: TRANSPORT_LABEL,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { status, reconnect: () => setAttempt((a) => a + 1) };
}
