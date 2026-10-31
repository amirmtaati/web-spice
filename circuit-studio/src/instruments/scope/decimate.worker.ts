/**
 * Scope decimation worker (UX3-T2, UI-UX-SPEC §6.7.1 "decimation in a
 * worker"): computes aligned min-max envelopes off the UI thread. Spawned
 * lazily by `decimator.ts` via the Vite `?worker` import (same pattern as
 * the engine worker); all heavy per-frame math for zoomed-out windows lives
 * here. Pure typed arrays in/out — no DOM, no engine imports.
 */
import { decimateAlignedY } from "./decimate.ts";

interface DecimateJob {
  readonly type: "decimate";
  readonly jobId: number;
  readonly bins: number;
  readonly values: Float64Array;
}

interface DecimateReply {
  readonly type: "decimated";
  readonly jobId: number;
  readonly out: Float64Array;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DecimateJob>) => void) | null;
  postMessage: (msg: DecimateReply, transfer: Transferable[]) => void;
};

ctx.onmessage = (e: MessageEvent<DecimateJob>) => {
  const job = e.data;
  if (job === null || job.type !== "decimate") {
    return;
  }
  const out = new Float64Array(job.bins * 2);
  decimateAlignedY(job.values, 0, job.values.length, job.bins, out);
  ctx.postMessage({ type: "decimated", jobId: job.jobId, out }, [out.buffer]);
};
