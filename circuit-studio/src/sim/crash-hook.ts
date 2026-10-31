/**
 * Crash-hook seam (UX2-T1): client.ts notifies engine-worker crashes without
 * importing the controller (which imports client.ts) — a one-slot callback
 * registry breaks the cycle. The controller registers at construction; the
 * app's composition registers it before the first client use (main.tsx).
 */

type CrashHandler = () => void;

let handler: CrashHandler | null = null;

/** Register (replaces any previous) the worker-crash recovery hook. */
export function registerEngineCrashHandler(next: CrashHandler): void {
  handler = next;
}

/** client.ts calls this on transport crash (AGENTS.md §3.4). */
export function notifyEngineCrash(): void {
  handler?.();
}
