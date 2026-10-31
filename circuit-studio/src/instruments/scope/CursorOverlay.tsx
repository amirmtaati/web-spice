/**
 * Scope cursor/annotation overlay (UX3-T2/T3/T4/T7): a transparent canvas
 * above the uPlot surface that draws X1/X2/Y1/Y2 cursors with drag handles,
 * the trigger level line + armed/locked glyph (with flash), experiment
 * annotations (hlines/vlines/bands), and the zoom-box rubber band. Pointer
 * interactions: drag cursors, drag = zoom box, Shift+drag = pan, wheel =
 * timebase zoom. Drawn inside the rAF frame loop — React never re-renders
 * for cursor movement.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { hitCursor, snapX } from "./cursors.ts";
import { scopePipeline } from "./scope-data.ts";
import { useScopeStore } from "./scope-store.ts";

interface DragState {
  kind: "cursor" | "zoom" | "pan";
  id?: "x1" | "x2" | "y1" | "y2";
  startPx: number;
  startPos: number; // data coord at drag start (position for pan)
  curPx: number;
}

export function CursorOverlay(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    let raf = requestAnimationFrame((now) => drawOverlay(canvas, now, dragRef.current));
    const loop = (now: number): void => {
      drawOverlay(canvas, now, dragRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── pointer handlers (DOM events, no React state) ────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent): void => {
      const scope = useScopeStore.getState();
      const { x, y } = local(e);
      const hit = hitCursor(
        scope.cursors,
        (v) => scopePipeline.toPxX(v),
        (v) => scopePipeline.toPxY(v),
        x,
        y,
      );
      if (hit !== null) {
        dragRef.current = { kind: "cursor", id: hit, startPx: x, startPos: 0, curPx: x };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        // Pan: shift the horizontal position by the drag delta.
        dragRef.current = {
          kind: "pan",
          startPx: x,
          startPos: scope.position,
          curPx: x,
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else {
        // Zoom box.
        dragRef.current = { kind: "zoom", startPx: x, startPos: y, curPx: x };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const drag = dragRef.current;
      if (drag === null) {
        return;
      }
      const { x, y } = local(e);
      drag.curPx = x;
      const scope = useScopeStore.getState();
      if (drag.kind === "cursor" && drag.id !== undefined) {
        moveCursor(scope, drag.id, x, y);
      } else if (drag.kind === "pan") {
        const geo = scopePipeline.geometry();
        // Dragging right moves the window start earlier (position ↑).
        const dPos = (x - drag.startPx) / Math.max(1, geo.width);
        scope.setPosition(clamp01(drag.startPos + dPos));
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      if (drag === null || drag.kind !== "zoom") {
        return;
      }
      applyZoomBox(drag);
    };

    const onWheel = (e: WheelEvent): void => {
      const scope = useScopeStore.getState();
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      scope.setSecPerDiv(scope.secPerDiv * factor);
      e.preventDefault();
    };

    const onDouble = (): void => {
      autoFit();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDouble);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-[5] touch-none"
      style={{ cursor: "crosshair" }}
      role="img"
      aria-label="Scope cursor and trigger overlay"
    />
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function moveCursor(
  scope: ReturnType<typeof useScopeStore.getState>,
  id: "x1" | "x2" | "y1" | "y2",
  px: number,
  py: number,
): void {
  if (id === "x1" || id === "x2") {
    let x = scopePipeline.toDataX(px);
    if (scope.cursors.snap && scopePipeline.view.valid) {
      x = snapX(x, scopePipeline.view.x0, scopePipeline.view.dt, scopePipeline.view.count);
    }
    scope.updateCursors({ [id]: x });
  } else {
    let v = scopePipeline.toDataY(py);
    if (scope.cursors.track) {
      v = valueAtPixel(px, py);
    }
    scope.updateCursors({ [id]: v });
  }
}

/** Signal value under the pointer (track mode): first visible channel window. */
function valueAtPixel(px: number, _py: number): number {
  void _py;
  const view = scopePipeline.view;
  if (!view.valid) {
    return Number.NaN;
  }
  const x = scopePipeline.toDataX(px);
  const scope = useScopeStore.getState();
  for (const ch of scope.channels) {
    if (!ch.visible || ch.math !== undefined) {
      continue;
    }
    const values = scopePipeline.valuesOf(ch.id);
    if (values === null) {
      continue;
    }
    const kf = (x - view.x0) / view.dt;
    const k = Math.round(kf);
    const v = values[Math.min(Math.max(0, k), view.count - 1)];
    if (v !== undefined && !Number.isNaN(v)) {
      return v;
    }
  }
  return Number.NaN;
}

function applyZoomBox(drag: { startPx: number; startPos: number; curPx: number }): void {
  const scope = useScopeStore.getState();
  const x1 = scopePipeline.toDataX(drag.startPx);
  const x2 = scopePipeline.toDataX(drag.curPx);
  if (!Number.isFinite(x1) || !Number.isFinite(x2) || Math.abs(x2 - x1) < 1e-15) {
    return;
  }
  const t1 = Math.min(x1, x2);
  const t2 = Math.max(x1, x2);
  scope.setSecPerDiv((t2 - t1) / 10);
  // Park the trigger near the right edge so the boxed span stays in view.
  scope.setPosition(0.9);
}

/** Auto fit: timebase covers the whole run, trigger centered. */
export function autoFit(): void {
  const scope = useScopeStore.getState();
  const view = scopePipeline.view;
  const total = view.valid ? view.total : 0;
  if (total > 1 && view.valid) {
    const span = view.total * view.dt * view.stride;
    scope.setSecPerDiv(span / 10);
    scope.setPosition(0.5);
  }
}

// ─── drawing ─────────────────────────────────────────────────────────────────

function drawOverlay(canvas: HTMLCanvasElement, now: number, drag: DragState | null): void {
  const parent = canvas.parentElement;
  if (parent === null) {
    return;
  }
  const dpr = globalThis.devicePixelRatio || 1;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const scope = useScopeStore.getState();
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  const textSmall = "10px 'JetBrains Mono Variable', monospace";

  const view = scopePipeline.view;
  if (!view.valid) {
    return;
  }
  const geo = scopePipeline.geometry();

  // ── experiment annotations (under cursors) ────────────────────────────
  const exp = scope.experiment;
  if (exp !== null) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    for (const a of exp.annotations) {
      if (a.kind === "hline") {
        drawHLine(ctx, a.y, a.label, color("--warning", "#f7b34f"), geo, textSmall);
      } else if (a.kind === "vline") {
        const x = a.x === "tau" ? exp.tau : a.x;
        if (x !== undefined) {
          drawVLine(ctx, x, a.label, color("--warning", "#f7b34f"), geo, textSmall);
        }
      } else {
        const from = a.from === "3tau" ? (exp.tau !== undefined ? exp.tau * 3 : undefined) : a.from;
        const to = a.to === "5tau" ? (exp.tau !== undefined ? exp.tau * 5 : undefined) : a.to;
        if (from !== undefined && to !== undefined) {
          const x1 = scopePipeline.toPxX(from);
          const x2 = scopePipeline.toPxX(to);
          if (Number.isFinite(x1) && Number.isFinite(x2)) {
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = color("--ok", "#3fd68f");
            ctx.fillRect(Math.min(x1, x2), geo.top, Math.abs(x2 - x1), geo.height);
            ctx.globalAlpha = 1;
          }
        }
      }
    }
    ctx.restore();
  }

  // ── trigger level + glyph ──────────────────────────────────────────────
  const trigSource = scope.trigger.source ?? scope.channels[0]?.id ?? null;
  if (trigSource !== null) {
    const yPx = scopePipeline.toPxY(scope.trigger.level);
    if (Number.isFinite(yPx) && yPx >= geo.top && yPx <= geo.top + geo.height) {
      ctx.save();
      ctx.strokeStyle = color("--guide", "#f74fd3");
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(geo.left, yPx);
      ctx.lineTo(geo.left + geo.width, yPx);
      ctx.stroke();
      ctx.restore();
    }
    // Glyph on the left edge: armed (hollow) vs triggered (solid + flash).
    const gx = geo.left + 8;
    const gy = yPx;
    const fired = now < scopePipeline.triggerFlashUntil;
    ctx.save();
    ctx.fillStyle = fired
      ? color("--ok", "#3fd68f")
      : scope.trigger.armed
        ? "transparent"
        : color("--warning", "#f7b34f");
    ctx.strokeStyle = color("--guide", "#f74fd3");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gx - 6, gy - 5);
    ctx.lineTo(gx + 4, gy);
    ctx.lineTo(gx - 6, gy + 5);
    ctx.closePath();
    if (fired || !scope.trigger.armed) {
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── cursors ────────────────────────────────────────────────────────────
  const c = scope.cursors;
  const cursorColor = color("--accent", "#4f8ef7");
  ctx.save();
  ctx.font = textSmall;
  if (c.x1 !== null) {
    drawVLine(ctx, c.x1, "X1", cursorColor, geo, textSmall);
  }
  if (c.x2 !== null) {
    drawVLine(ctx, c.x2, "X2", cursorColor, geo, textSmall);
  }
  if (c.y1 !== null) {
    drawHLine(ctx, c.y1, "Y1", cursorColor, geo, textSmall);
  }
  if (c.y2 !== null) {
    drawHLine(ctx, c.y2, "Y2", cursorColor, geo, textSmall);
  }
  // Δ shading between X1/X2.
  if (c.x1 !== null && c.x2 !== null) {
    const px1 = scopePipeline.toPxX(c.x1);
    const px2 = scopePipeline.toPxX(c.x2);
    if (Number.isFinite(px1) && Number.isFinite(px2)) {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = cursorColor;
      ctx.fillRect(Math.min(px1, px2), geo.top, Math.abs(px2 - px1), geo.height);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // ── zoom box ───────────────────────────────────────────────────────────
  if (drag !== null && drag.kind === "zoom") {
    const x1 = Math.min(drag.startPx, drag.curPx);
    const x2 = Math.max(drag.startPx, drag.curPx);
    const y1 = Math.min(drag.startPos, cursorY(drag));
    const y2 = Math.max(drag.startPos, cursorY(drag));
    ctx.save();
    ctx.strokeStyle = cursorColor;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = cursorColor;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }
}

function cursorY(drag: DragState): number {
  return Number.isFinite(drag.startPos) ? drag.startPos : 0;
}

function drawVLine(
  ctx: CanvasRenderingContext2D,
  xData: number,
  label: string,
  colorValue: string,
  geo: { left: number; top: number; height: number },
  font: string,
): void {
  const px = scopePipeline.toPxX(xData);
  if (!Number.isFinite(px)) {
    return;
  }
  ctx.strokeStyle = colorValue;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(px, geo.top);
  ctx.lineTo(px, geo.top + geo.height);
  ctx.stroke();
  ctx.setLineDash([]);
  // Handle: small downward triangle at the top edge.
  ctx.fillStyle = colorValue;
  ctx.beginPath();
  ctx.moveTo(px - 4, geo.top);
  ctx.lineTo(px + 4, geo.top);
  ctx.lineTo(px, geo.top + 6);
  ctx.closePath();
  ctx.fill();
  ctx.font = font;
  ctx.fillText(label, px + 4, geo.top + 14);
}

function drawHLine(
  ctx: CanvasRenderingContext2D,
  yData: number,
  label: string,
  colorValue: string,
  geo: { left: number; top: number; width: number; height: number },
  font: string,
): void {
  const py = scopePipeline.toPxY(yData);
  if (!Number.isFinite(py)) {
    return;
  }
  ctx.strokeStyle = colorValue;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(geo.left, py);
  ctx.lineTo(geo.left + geo.width, py);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colorValue;
  ctx.beginPath();
  ctx.moveTo(geo.left + geo.width - 6, py - 4);
  ctx.lineTo(geo.left + geo.width, py);
  ctx.lineTo(geo.left + geo.width - 6, py + 4);
  ctx.closePath();
  ctx.fill();
  ctx.font = font;
  ctx.fillText(label, geo.left + 6, py - 4);
}
