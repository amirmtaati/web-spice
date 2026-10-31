/**
 * Ring buffers (UX2-T2, SPEC §8.1/§7): O(1) appends on the data path — the
 * UI's counterpart duty for engine backpressure (AGENTS.md §5.3). Float64 is
 * retained for measurements; the Float32 display copy feeds plots/scope.
 * Capacity is fixed (2^n) so memory is flat over a 30-min live soak.
 */

/** Power-of-two floor for a requested capacity. */
export function snapCapacity(requested: number): number {
  let c = 1;
  while (c < requested) {
    c *= 2;
  }
  return c;
}

export class RingBuffer {
  readonly capacity: number;
  private readonly buf: Float64Array;
  /** Total samples ever appended (≥ length; may exceed capacity). */
  private total = 0;
  /** Index of the oldest sample when total > capacity. */
  private head = 0;

  constructor(capacity: number) {
    this.capacity = snapCapacity(capacity);
    this.buf = new Float64Array(this.capacity);
  }

  /** Samples currently retained (≤ capacity). */
  get length(): number {
    return Math.min(this.total, this.capacity);
  }

  get appended(): number {
    return this.total;
  }

  /** Oldest retained sample value (`i` = 0 → oldest). NaN when empty. */
  at(i: number): number {
    if (i < 0 || i >= this.length) {
      return Number.NaN;
    }
    return this.buf[(this.head + i) % this.capacity] ?? Number.NaN;
  }

  append(v: number): void {
    const tail = (this.head + this.length) % this.capacity;
    this.buf[tail] = v;
    this.total += 1;
    if (this.total > this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Append a block (chunk path — one call per chunk, still O(n) in the chunk
   * with no per-sample callback overhead). Returns samples dropped off the
   * ring (0 until capacity is hit).
   */
  appendBlock(src: ArrayLike<number>): number {
    const before = this.length;
    const n = src.length;
    for (let k = 0; k < n; k++) {
      const v = src[k];
      if (v === undefined) {
        break;
      }
      const tail = (this.head + this.length) % this.capacity;
      this.buf[tail] = v;
      this.total += 1;
      if (this.total > this.capacity) {
        this.head = (this.head + 1) % this.capacity;
      }
    }
    return Math.max(0, before + n - this.capacity);
  }

  /**
   * Copy the most recent `count` samples (chronological) into `out`.
   * Returns the number written (≤ count, ≤ length, ≤ out.length).
   */
  readLast(count: number, out: Float64Array): number {
    const n = Math.min(count, this.length, out.length);
    const startTotal = this.total - n;
    for (let k = 0; k < n; k++) {
      out[k] = this.buf[(startTotal + k) % this.capacity] ?? Number.NaN;
    }
    return n;
  }

  /** Copy everything retained (chronological) into a fresh array. */
  toArray(): Float64Array {
    const out = new Float64Array(this.length);
    this.readLast(this.length, out);
    return out;
  }

  clear(): void {
    this.total = 0;
    this.head = 0;
  }
}

/**
 * Min/max envelope decimation (run history overlays, low-zoom scope paths):
 * `bins` pairs [min₀, max₀, min₁, max₁, …] over the input. bins ≤ 1 → empty.
 */
export function decimateMinMax(src: ArrayLike<number>, bins: number): Float64Array {
  const n = src.length;
  if (bins < 1 || n === 0) {
    return new Float64Array(0);
  }
  const out = new Float64Array(bins * 2);
  const per = n / bins;
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor(b * per);
    const hi = Math.min(n, Math.max(lo + 1, Math.floor((b + 1) * per)));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let k = lo; k < hi; k++) {
      const v = src[k] ?? Number.NaN;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/**
 * Uniform min/max envelope of a *ring window*: decimates the most recent
 * `count` samples into `bins` pairs without copying the window first.
 */
export function decimateRingMinMax(ring: RingBuffer, count: number, bins: number): Float64Array {
  const n = Math.min(count, ring.length);
  if (bins < 1 || n === 0) {
    return new Float64Array(0);
  }
  const out = new Float64Array(bins * 2);
  const per = n / bins;
  const windowStart = ring.length - n;
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor(b * per);
    const hi = Math.min(n, Math.max(lo + 1, Math.floor((b + 1) * per)));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let k = lo; k < hi; k++) {
      const v = ring.at(windowStart + k);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}
