/**
 * useInstrumentFrame (UX2-T4): register a per-frame callback for the
 * component's lifetime. The callback runs OUTSIDE React — it mutates canvas
 * contexts / DOM text directly, so streaming data never re-renders the tree.
 *
 * Under `prefers-reduced-motion` instruments still need live data, so the
 * frame loop is NOT motion-gated (motion gating applies to animations only).
 */
import { useEffect, useRef } from "react";
import { subscribeFrame } from "./frames.ts";

export function useInstrumentFrame(cb: (now: number) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    return subscribeFrame((now) => ref.current(now));
  }, []);
}
