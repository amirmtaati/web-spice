/**
 * Instrument frame plumbing (UX2-T4, UI-UX-SPEC §7 rule 2): instruments
 * subscribe to a shared rAF loop and read resultStore buffers IMPERATIVELY —
 * React never re-renders per data chunk. The e2e suite reads the frame-sink
 * stats to prove data flows while render counts stay flat.
 */

type FrameCb = (now: number) => void;

const frameSubs = new Set<FrameCb>();
let rafId: number | null = null;
/** Total frames dispatched (monotonic; e2e asserts this advances). */
let framesDispatched = 0;

function loop(now: number): void {
  framesDispatched += 1;
  for (const cb of frameSubs) {
    cb(now);
  }
  if (frameSubs.size > 0) {
    rafId = globalThis.requestAnimationFrame(loop);
  } else {
    rafId = null;
  }
}

/** Subscribe a callback to the shared animation frame loop. */
export function subscribeFrame(cb: FrameCb): () => void {
  frameSubs.add(cb);
  if (rafId === null) {
    rafId = globalThis.requestAnimationFrame(loop);
  }
  return () => {
    frameSubs.delete(cb);
  };
}

/** Frame-sink stats for e2e/profiling (read-only). */
export function frameStats(): { frames: number; subscribers: number } {
  return { frames: framesDispatched, subscribers: frameSubs.size };
}

export function resetFrameStatsForTests(): void {
  framesDispatched = 0;
}
