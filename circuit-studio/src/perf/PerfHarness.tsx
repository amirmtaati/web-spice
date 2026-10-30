/**
 * Perf harness (UX0-T8, §10 budgets): a standalone page (`?view=perf`) that
 * measures shell-relevant baselines on the production build — cold-load →
 * interactive, steady-state rAF frame time, and the ring-buffer
 * write/read cost instruments will pay per animation frame (§1.2 principle:
 * React never re-renders per data chunk). Numbers are copied into
 * `docs/perf-baseline.md`.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";

interface PerfRow {
  readonly metric: string;
  readonly value: string;
  readonly budget: string;
  readonly ok: boolean;
}

export function PerfHarness(): ReactNode {
  const [rows, setRows] = useState<readonly PerfRow[]>([]);
  const startedAt = useRef(performance.now());
  const interactiveAt = useRef<number | null>(null);

  useEffect(() => {
    interactiveAt.current = performance.now();
    const coldMs = interactiveAt.current - startedAt.current;
    const results: PerfRow[] = [
      {
        metric: "harness mount since navigation",
        value: `${coldMs.toFixed(1)} ms`,
        budget: "cold load → interactive ≤ 2500 ms (shell; harness lower bound)",
        ok: coldMs < 2500,
      },
    ];

    // rAF frame-time probe: 120 frames, no work in the loop.
    const samples: number[] = [];
    let last = performance.now();
    let frames = 0;
    const tick = (now: number): void => {
      samples.push(now - last);
      last = now;
      frames += 1;
      if (frames < 120) {
        requestAnimationFrame(tick);
      } else {
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        results.push(
          {
            metric: "rAF median frame time",
            value: `${median.toFixed(2)} ms`,
            budget: "60 FPS ⇒ ≤ 16.7 ms",
            ok: median < 16.7,
          },
          {
            metric: "rAF p95 frame time",
            value: `${p95.toFixed(2)} ms`,
            budget: "no frame > 25 ms",
            ok: p95 < 25,
          },
        );
        runRingBench(results);
        setRows(results);
      }
    };
    requestAnimationFrame(tick);
  }, []);

  const copy = (): void => {
    const text = rows.map((r) => `${r.metric}: ${r.value} (budget: ${r.budget})`).join("\n");
    void navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="mx-auto max-w-2xl p-6 text-fg">
      <h1 className="text-lg font-semibold">Perf harness — UX0 baselines</h1>
      <p className="mt-1 text-xs text-muted">
        Production build only (vite preview). Numbers feed docs/perf-baseline.md (§10).
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-2xs uppercase tracking-wide text-faint">
            <th className="pb-2">Metric</th>
            <th className="pb-2">Value</th>
            <th className="pb-2">Budget</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metric} className="border-t border-line/60">
              <td className="py-1.5 pr-3">{row.metric}</td>
              <td className="py-1.5 pr-3 font-mono tabular-nums">
                <span className={row.ok ? "text-ok" : "text-error"}>{row.value}</span>
              </td>
              <td className="py-1.5 text-xs text-faint">{row.budget}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-xs text-faint">
                Measuring…
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 0 && (
        <Button size="sm" className="mt-4" onClick={copy}>
          Copy results
        </Button>
      )}
    </div>
  );
}

/** Ring-buffer microbench: 1 Mi samples written + read through a Float64Array ring. */
function runRingBench(results: PerfRow[]): void {
  const capacity = 65_536;
  const ring = new Float64Array(capacity);
  const total = 1_048_576;
  let head = 0;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    ring[head] = i;
    head = (head + 1) % capacity;
  }
  let sum = 0;
  for (let i = 0; i < capacity; i++) {
    sum += ring[i] ?? 0;
  }
  const ms = performance.now() - t0;
  results.push({
    metric: `ring buffer 1 Mi writes + ${capacity} reads (checksum ${sum % 7})`,
    value: `${ms.toFixed(2)} ms`,
    budget: "allocation-free instrument reads: < 8 ms (§1.2, §6.7)",
    ok: ms < 8,
  });
}
