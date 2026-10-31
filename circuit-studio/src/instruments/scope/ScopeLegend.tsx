/**
 * Scope legend + measurement column (UX3-T1/T4/T5, UI-UX-SPEC §6.7.1): one
 * row per channel — color, visibility, label, offset/invert controls,
 * automatic measurements (Vpp/Vmax/Vmin/Vavg/Vrms/f/duty/rise/fall/
 * overshoot, 4 Hz refresh), cursor readouts (Δt, 1/Δt, ΔV), math-channel
 * menu, custom `evaluate` expression, and "Estimate τ from cursor".
 * Measurement values render via a 4 Hz React tick reading the pipeline's
 * cache — the data path itself never re-renders React (§7).
 */

import { Eye, EyeOff, Sigma, Trash2, TrendingUp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { resultStore } from "../../stores/result-store.ts";
import { ColorDot } from "../../ui/ColorDot.tsx";
import { formatEng, formatTime } from "../../ui/format.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, MenuItem, MenuLabel } from "../../ui/Menu.tsx";
import { NumberInput } from "../../ui/NumberInput.tsx";
import type { MathOp } from "../math.ts";
import { cursorReadouts } from "./cursors.ts";
import type { MeasurementRow } from "./measure.ts";
import { customEvalCache, scopePipeline } from "./scope-data.ts";
import { measurementCache, useScopeStore } from "./scope-store.ts";
import { fitTau } from "./tau.ts";

const MEASUREMENT_COLUMNS: { key: keyof MeasurementRow; label: string; unit: string }[] = [
  { key: "vpp", label: "Vpp", unit: "" },
  { key: "vmax", label: "Vmax", unit: "" },
  { key: "vmin", label: "Vmin", unit: "" },
  { key: "vavg", label: "avg", unit: "" },
  { key: "vrms", label: "rms", unit: "" },
  { key: "freq", label: "freq", unit: "Hz" },
  { key: "period", label: "period", unit: "s" },
  { key: "duty", label: "duty", unit: "%" },
  { key: "rise", label: "rise", unit: "s" },
  { key: "fall", label: "fall", unit: "s" },
  { key: "overshoot", label: "over", unit: "%" },
];

/** 4 Hz tick while mounted (measurements/eval refresh cadence). */
function useFourHertz(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function cell(
  row: MeasurementRow | undefined,
  col: { key: keyof MeasurementRow; unit: string },
  channelUnit: string,
): string {
  const v = row?.[col.key];
  if (v === undefined || !Number.isFinite(v)) {
    return "—";
  }
  // Amplitude columns read in the channel's unit (V or A); the rest carry
  // their own unit (Hz / s / %).
  return formatEng(v, col.unit === "" ? channelUnit : col.unit);
}

export function ScopeLegend(): ReactNode {
  const scope = useScopeStore();
  useFourHertz();

  const signals = [...resultStore.signalNames];
  const unitOf = (id: string): string => (id.startsWith("i(") ? "A" : "V");
  const ro = cursorReadouts(scope.cursors);

  const addMath = (op: MathOp, label: string): void => scope.addMathChannel(op, label);
  const active = scope.channels.find((c) => c.id === scope.activeChannelId) ?? null;

  const estimateTau = (): void => {
    const view = scopePipeline.view;
    const c = scope.cursors;
    if (!view.valid || c.x1 === null || c.x2 === null || active === null) {
      return;
    }
    const values = scopePipeline.valuesOf(active.id);
    if (values === null) {
      return;
    }
    // Cursor x → window sample indices (uniform grid).
    const i1 = Math.round((c.x1 - view.x0) / view.dt);
    const i2 = Math.round((c.x2 - view.x0) / view.dt);
    const lo = Math.max(0, Math.min(i1, i2));
    const hi = Math.min(values.length, Math.max(i1, i2));
    const axis = new Float64Array(hi - lo);
    for (let k = 0; k < axis.length; k++) {
      axis[k] = view.x0 + (lo + k) * view.dt;
    }
    const fit = fitTau(axis, values, lo - lo, hi - lo);
    scope.setTauEstimate(
      fit === null
        ? null
        : { tau: fit.tau, r2: fit.r2, firstOrder: fit.firstOrder, channel: active.id },
    );
  };

  return (
    <div className="border-t border-line" data-testid="scope-legend">
      {/* cursor readouts + math + τ row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1 text-2xs text-muted">
        <span className="font-mono" data-testid="cursor-dt">
          Δt = {Number.isFinite(ro.dt) ? formatTime(ro.dt) : "—"}
        </span>
        <span className="font-mono">
          1/Δt = {Number.isFinite(ro.oneOverDt) ? formatEng(ro.oneOverDt, "Hz") : "—"}
        </span>
        <span className="font-mono">
          ΔV ={" "}
          {Number.isFinite(ro.dy)
            ? formatEng(ro.dy, active !== null ? unitOf(active.id) : "V")
            : "—"}
        </span>
        <Menu
          trigger={
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1 hover:text-fg"
              aria-label="Add math channel"
            >
              <Sigma size={12} /> math
            </button>
          }
        >
          <MenuLabel>Waveform math (A ± B, A·B, ∫, d/dt)</MenuLabel>
          {signalOptions(scope.channels).map(([a, b]) => (
            <MenuItem
              key={`${a}+${b}`}
              onSelect={() => addMath({ kind: "add", a, b }, `${a}+${b}`)}
            >
              {a} + {b}
            </MenuItem>
          ))}
          {signalOptions(scope.channels).map(([a, b]) => (
            <MenuItem
              key={`${a}-${b}`}
              onSelect={() => addMath({ kind: "sub", a, b }, `${a}−${b}`)}
            >
              {a} − {b}
            </MenuItem>
          ))}
          {signalOptions(scope.channels).map(([a, b]) => (
            <MenuItem
              key={`${a}x${b}`}
              onSelect={() => addMath({ kind: "mul", a, b }, `${a}·${b}`)}
            >
              {a} × {b}
            </MenuItem>
          ))}
          {scope.channels
            .filter((c) => c.math === undefined)
            .map((c) => (
              <MenuItem
                key={`int-${c.id}`}
                onSelect={() => addMath({ kind: "int", a: c.id }, `∫${c.id}dt`)}
              >
                ∫ {c.id} dt
              </MenuItem>
            ))}
          {scope.channels
            .filter((c) => c.math === undefined)
            .map((c) => (
              <MenuItem
                key={`d-${c.id}`}
                onSelect={() => addMath({ kind: "deriv", a: c.id }, `d${c.id}/dt`)}
              >
                d {c.id} /dt
              </MenuItem>
            ))}
        </Menu>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 hover:text-fg disabled:opacity-40"
          onClick={estimateTau}
          disabled={scope.cursors.x1 === null || scope.cursors.x2 === null || active === null}
          data-testid="estimate-tau"
          title="Fit τ over the X1…X2 span (least-squares exponential)"
        >
          <TrendingUp size={12} /> Estimate τ
        </button>
        {scope.tauEstimate !== null && (
          <span
            className="font-mono"
            data-testid="tau-result"
            style={{ color: scope.tauEstimate.firstOrder ? "var(--ok)" : "var(--warning)" }}
          >
            {scope.tauEstimate.firstOrder
              ? `τ ≈ ${formatTime(scope.tauEstimate.tau)} (R² ${scope.tauEstimate.r2.toFixed(3)})`
              : `not first-order (R² ${scope.tauEstimate.r2.toFixed(3)})`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <input
            className="h-5 w-40 rounded border border-line bg-panel px-1 font-mono text-2xs text-fg"
            placeholder={`f(${active?.id ?? "x"}) via evaluate`}
            aria-label="Custom expression (evaluated at the last sample)"
            onChange={(e) => scope.setCustomExpr(e.target.value === "" ? null : e.target.value)}
          />
          <span className="font-mono" data-testid="custom-eval">
            {customEvalCache.error !== null
              ? "⚠"
              : customEvalCache.value !== null && Number.isFinite(customEvalCache.value)
                ? formatEng(customEvalCache.value)
                : "—"}
          </span>
        </span>
      </div>

      {/* channel rows */}
      <table
        className="w-full border-collapse text-2xs"
        aria-label="Scope channels and measurements"
      >
        <thead>
          <tr className="text-faint">
            <th className="w-8 px-1 py-0.5 text-left font-normal">ch</th>
            <th className="px-1 py-0.5 text-left font-normal">signal</th>
            <th className="px-1 py-0.5 text-right font-normal">offset</th>
            {scope.showMeasurements &&
              MEASUREMENT_COLUMNS.map((m) => (
                <th key={m.key} className="px-1 py-0.5 text-right font-normal">
                  {m.label}
                </th>
              ))}
            <th className="w-14 px-1 py-0.5 text-right font-normal">ops</th>
          </tr>
        </thead>
        <tbody>
          {scope.channels.map((ch) => {
            const row = measurementCache.get(ch.id);
            const isActive = ch.id === scope.activeChannelId;
            return (
              <tr
                key={ch.id}
                className={`border-t border-line ${isActive ? "bg-accent-soft/40" : ""}`}
                onClick={() => scope.setActiveChannel(ch.id)}
                data-testid={`scope-row-${ch.id}`}
              >
                <td className="px-1 py-0.5">
                  <ColorDot index={ch.colorIndex} className={ch.visible ? "" : "opacity-30"} />
                </td>
                <td
                  className="px-1 py-0.5 font-mono text-fg"
                  title={ch.math !== undefined ? "math channel" : ch.id}
                >
                  {ch.label}
                  {ch.invert && <span className="ml-1 text-warning">¬</span>}
                </td>
                <td className="px-1 py-0.5">
                  <NumberInput
                    label={`Vertical offset for ${ch.label}`}
                    value={ch.offset}
                    onChange={(offset) => scope.updateChannel(ch.id, { offset })}
                    className="h-5 w-20 text-2xs"
                    step={0.1}
                  />
                </td>
                {scope.showMeasurements &&
                  MEASUREMENT_COLUMNS.map((m) => (
                    <td key={m.key} className="px-1 py-0.5 text-right font-mono text-muted">
                      {cell(row, m, unitOf(ch.id))}
                    </td>
                  ))}
                <td className="px-1 py-0.5">
                  <span className="flex items-center justify-end gap-0.5">
                    <IconButton
                      label={ch.visible ? `Hide ${ch.label}` : `Show ${ch.label}`}
                      onClick={() => scope.updateChannel(ch.id, { visible: !ch.visible })}
                      className="h-5 w-5"
                    >
                      {ch.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </IconButton>
                    <IconButton
                      label={`Invert ${ch.label}`}
                      onClick={() => scope.updateChannel(ch.id, { invert: !ch.invert })}
                      active={ch.invert}
                      className="h-5 w-5"
                    >
                      <span className="text-2xs">±</span>
                    </IconButton>
                    <IconButton
                      label={`Remove ${ch.label}`}
                      onClick={() => scope.removeChannel(ch.id)}
                      className="h-5 w-5"
                    >
                      <Trash2 size={11} />
                    </IconButton>
                  </span>
                </td>
              </tr>
            );
          })}
          {scope.channels.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-2 text-muted">
                No channels — add a probe from the tool rail (P), cross-probe with Alt+click, or run
                an Experiment.{" "}
                {signals.length > 0 ? `${signals.length} signal(s) available in this run.` : ""}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function signalOptions(channels: readonly { id: string; math?: MathOp }[]): [string, string][] {
  const real = channels.filter((c) => c.math === undefined).map((c) => c.id);
  const pairs: [string, string][] = [];
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = real[i];
      const b = real[j];
      if (a !== undefined && b !== undefined) {
        pairs.push([a, b]);
        pairs.push([b, a]);
      }
    }
  }
  return pairs;
}
