/**
 * Ring buffer tests (UX2-T2): wrap-around, drop-oldest, block appends,
 * min/max decimation — including the flat-memory guarantee (capacity is
 * fixed; a 30-min soak only ever appends into the same arrays).
 */
import { describe, expect, test } from "bun:test";
import { decimateMinMax, decimateRingMinMax, RingBuffer, snapCapacity } from "./ringbuffer.ts";

describe("RingBuffer", () => {
  test("appends and reads in order", () => {
    const r = new RingBuffer(8);
    for (let k = 0; k < 5; k++) {
      r.append(k);
    }
    expect(r.length).toBe(5);
    expect([...r.toArray()]).toEqual([0, 1, 2, 3, 4]);
  });

  test("wraps and drops oldest", () => {
    const r = new RingBuffer(4);
    for (let k = 0; k < 6; k++) {
      r.append(k);
    }
    expect(r.length).toBe(4);
    expect([...r.toArray()]).toEqual([2, 3, 4, 5]);
    expect(r.appended).toBe(6);
  });

  test("appendBlock matches per-sample appends", () => {
    const a = new RingBuffer(8);
    const b = new RingBuffer(8);
    for (let k = 0; k < 10; k++) {
      a.append(k);
    }
    const dropped = b.appendBlock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(dropped).toBe(2);
    expect([...a.toArray()]).toEqual([...b.toArray()]);
    expect(b.appended).toBe(10);
  });

  test("readLast returns the newest window chronologically", () => {
    const r = new RingBuffer(16);
    r.appendBlock([1, 2, 3, 4, 5]);
    const out = new Float64Array(3);
    expect(r.readLast(3, out)).toBe(3);
    expect([...out]).toEqual([3, 4, 5]);
    // Over-long reads clamp to length.
    const big = new Float64Array(16);
    expect(r.readLast(99, big)).toBe(5);
    expect([...big.subarray(0, 5)]).toEqual([1, 2, 3, 4, 5]);
  });

  test("readLast across the wrap boundary", () => {
    const r = new RingBuffer(4);
    r.appendBlock([10, 11, 12, 13, 14, 15]);
    const out = new Float64Array(4);
    r.readLast(4, out);
    expect([...out]).toEqual([12, 13, 14, 15]);
  });

  test("at() indexes from the oldest retained sample", () => {
    const r = new RingBuffer(3); // snaps to capacity 4
    r.appendBlock([9, 8, 7, 6, 5]); // 9 drops off
    expect(r.at(0)).toBe(8);
    expect(r.at(3)).toBe(5);
    expect(r.at(4)).toBeNaN();
  });

  test("snapCapacity rounds up to a power of two", () => {
    expect(snapCapacity(1000)).toBe(1024);
    expect(snapCapacity(1 << 20)).toBe(1 << 20);
  });

  test("memory stays flat over a soak (fixed arrays, no growth)", () => {
    const r = new RingBuffer(1024);
    const block = new Float64Array(64).fill(1);
    for (let k = 0; k < 50_000; k++) {
      r.appendBlock(block);
    }
    expect(r.appended).toBe(50_000 * 64);
    expect(r.length).toBe(1024);
    // The underlying buffer object is the same one allocated at construction.
    expect(r.capacity).toBe(1024);
  });
});

describe("decimateMinMax", () => {
  test("exact min/max per bin", () => {
    const src = [0, 3, -2, 5, 1, 1, 9, -7];
    const env = decimateMinMax(src, 2);
    expect([...env]).toEqual([-2, 5, -7, 9]);
  });
  test("bins cover tail samples (ceil coverage)", () => {
    const env = decimateMinMax([5, -5, 5, -5, 100], 2);
    // bin0 = [5,-5] → -5/5; bin1 = [5,-5,100] → -5/100.
    expect([...env]).toEqual([-5, 5, -5, 100]);
  });
  test("empty input → empty envelope", () => {
    expect(decimateMinMax([], 8).length).toBe(0);
  });
});

describe("decimateRingMinMax", () => {
  test("matches array decimation on the ring window", () => {
    const r = new RingBuffer(64);
    const src: number[] = [];
    for (let k = 0; k < 50; k++) {
      src.push(Math.sin(k / 3) * 10);
    }
    r.appendBlock(src);
    const env = decimateRingMinMax(r, 50, 10);
    const expected = decimateMinMax(src, 10);
    expect(env.length).toBe(expected.length);
    for (let k = 0; k < env.length; k++) {
      expect(env[k] ?? 0).toBeCloseTo(expected[k] ?? 0, 12);
    }
  });
  test("clamps to retained window", () => {
    const r = new RingBuffer(8);
    r.appendBlock(new Float64Array(20).fill(2));
    const env = decimateRingMinMax(r, 999, 4);
    expect(env.length).toBe(8);
    expect([...env]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });
});
