/**
 * Studio DS Toast (UI-UX-SPEC §4.3): bottom-right stack, 4 s auto-dismiss,
 * optional actions. Non-modal; never blocks the canvas. Screen-reader
 * announcements via role="status" (polite).
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./cn.ts";

export type ToastTone = "info" | "ok" | "warning" | "error";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastOptions {
  readonly title: string;
  readonly message?: string | undefined;
  readonly tone?: ToastTone | undefined;
  readonly actions?: readonly ToastAction[] | undefined;
  /** ms; default 4000 (§4.3). */
  readonly durationMs?: number | undefined;
}

interface ToastEntry extends ToastOptions {
  readonly id: number;
}

interface ToastApi {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ACCENT: Record<ToastTone, string> = {
  info: "bg-info",
  ok: "bg-ok",
  warning: "bg-warning",
  error: "bg-error",
};

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((list) => [...list.slice(-4), { ...options, id }]);
      const duration = options.durationMs ?? 4000;
      if (duration > 0) {
        globalThis.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed right-3 bottom-3 z-[100] flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex gap-2 overflow-hidden rounded-lg border border-line",
              "bg-elevated shadow-[var(--shadow-popover)]",
              "animate-[fade-in-up_var(--dur-2)_ease-[var(--ease-standard)]]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("w-1 shrink-0 rounded-l", TONE_ACCENT[toast.tone ?? "info"])}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-2">
              <p className="text-sm font-medium text-fg">{toast.title}</p>
              {toast.message !== undefined && <p className="text-xs text-muted">{toast.message}</p>}
              {toast.actions !== undefined && toast.actions.length > 0 && (
                <div className="mt-0.5 flex gap-2">
                  {toast.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => {
                        action.onClick();
                        dismiss(toast.id);
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="mr-1 self-start p-1 text-xs text-faint hover:text-fg"
              onClick={() => dismiss(toast.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Must be called under `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return api;
}
