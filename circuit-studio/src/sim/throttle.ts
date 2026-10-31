/**
 * Throttle utilities (UX2-T4): trailing-edge throttle for React-facing
 * updates and cheap coercion helpers shared by instruments.
 */

/**
 * Trailing throttle: the wrapped fn runs at most once per `ms`, with the
 * LAST arguments received. Timer handle kept per-wrapper (no allocation on
 * the hot path after the first call).
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let last = -Infinity;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pending: A | null = null;
  return (...args: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = globalThis.setTimeout(
        () => {
          timer = null;
          last = Date.now();
          if (pending !== null) {
            const args2 = pending;
            pending = null;
            fn(...args2);
          }
        },
        ms - (now - last),
      );
    }
  };
}

/** Clamp to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
