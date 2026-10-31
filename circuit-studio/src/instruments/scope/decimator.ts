/**
 * Decimator host (UX3-T2): routes per-frame min-max decimation to a worker
 * when one is available, with a transparent inline fallback (tests, worker
 * spawn failure). Contract for the pipeline:
 *
 *  - `take(channelId, sig)` — returns the freshest worker result that
 *    matches the window signature (start/count/bins), consuming it.
 *  - `submit(channelId, sig, values, bins)` — queues a job (one in flight
 *    per channel; extra submits while busy are dropped, the pipeline draws
 *    inline meanwhile).
 *
 * Worker crashes degrade permanently to inline for the session — the scope
 * stays correct (just on-thread) either way.
 */
import DecimateWorker from "./decimate.worker.ts?worker";

export interface DecimSignature {
  /** Window identity: absolute start index + strided count + bins. */
  readonly startIdx: number;
  readonly count: number;
  readonly bins: number;
}

interface Pending {
  readonly sig: DecimSignature;
  readonly out: Float64Array;
}

interface InFlight {
  readonly sig: DecimSignature;
  readonly channelId: string;
}

function sigEqual(a: DecimSignature, b: DecimSignature): boolean {
  return a.startIdx === b.startIdx && a.count === b.count && a.bins === b.bins;
}

export class DecimatorHost {
  private worker: Worker | null = null;
  private broken = false;
  private jobId = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly jobs = new Map<number, string>();

  get workerActive(): boolean {
    return this.worker !== null && !this.broken;
  }

  private ensureWorker(): Worker | null {
    if (this.broken) {
      return null;
    }
    if (this.worker !== null) {
      return this.worker;
    }
    if (typeof Worker === "undefined") {
      this.broken = true;
      return null;
    }
    try {
      const w = new DecimateWorker();
      w.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; jobId: number; out?: Float64Array };
        if (msg.type !== "decimated") {
          return;
        }
        const channelId = this.jobs.get(msg.jobId);
        this.jobs.delete(msg.jobId);
        const flight = channelId !== undefined ? this.inFlight.get(channelId) : undefined;
        if (channelId !== undefined) {
          this.inFlight.delete(channelId);
        }
        if (msg.out instanceof Float64Array && flight !== undefined) {
          this.pending.set(flight.channelId, { sig: flight.sig, out: msg.out });
        }
      };
      w.onerror = () => {
        this.broken = true;
        this.inFlight.clear();
        this.jobs.clear();
      };
      this.worker = w;
      return w;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** Consume a worker result matching `sig`, if one has arrived. */
  take(channelId: string, sig: DecimSignature): Float64Array | null {
    const p = this.pending.get(channelId);
    if (p !== undefined && sigEqual(p.sig, sig)) {
      this.pending.delete(channelId);
      return p.out;
    }
    if (p !== undefined) {
      this.pending.delete(channelId); // stale window — drop
    }
    return null;
  }

  /** Queue a decimation job (dropped when the worker is busy/broken). */
  submit(channelId: string, sig: DecimSignature, values: Float64Array, bins: number): void {
    if (this.broken || this.inFlight.has(channelId)) {
      return;
    }
    const w = this.ensureWorker();
    if (w === null) {
      return;
    }
    const jobId = ++this.jobId;
    this.inFlight.set(channelId, { sig, channelId });
    this.jobs.set(jobId, channelId);
    // Structured clone (copy) — the pipeline keeps drawing from its buffer.
    w.postMessage({ type: "decimate", jobId, bins, values });
  }

  /** Test/diagnostic reset (kills the worker). */
  resetForTests(): void {
    this.worker?.terminate();
    this.worker = null;
    this.broken = false;
    this.pending.clear();
    this.inFlight.clear();
    this.jobs.clear();
  }
}
