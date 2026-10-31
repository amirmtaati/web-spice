/**
 * CanvasView (UX1-T1/T2/T4): the schematic canvas React shell — pointer
 * events → tool dispatch, rAF render loop reading the draw list, wheel zoom
 * at cursor, pan/inertia, DPR crispness. React never re-renders per frame:
 * the loop reads stores imperatively and draws straight to the canvas.
 */
import { useEffect, useRef } from "react";
import { snapPoint } from "../editor/snapping.ts";
import { useEditorStore, wirePreview } from "../editor/store.ts";
import type { SchematicDoc } from "../schematic/types.ts";
import {
  animateTo,
  type CameraAnimator,
  type CameraState,
  docToScreen,
  fitRect,
  type Inertia,
  makeInertia,
  panBy,
  screenToDoc,
  zoomAt,
} from "./camera.ts";
import { type Palette, readPalette, renderScene } from "./canvas2d.ts";
import { buildScene, docBounds } from "./scene.ts";
import { SpatialIndex } from "./spatial.ts";

export function CanvasView(): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<CameraState>({ x: -2000, y: -2000, scale: 0.25 });
  const animatorRef = useRef<CameraAnimator | null>(null);
  const inertiaRef = useRef<Inertia | null>(null);
  const indexRef = useRef<SpatialIndex>(new SpatialIndex());
  const docRef = useRef<SchematicDoc>(useEditorStore.getState().doc);
  const paletteRef = useRef<Palette>(readPalette());
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanRef = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    // Document revisions rebuild the spatial index lazily.
    const unsub = useEditorStore.subscribe((state) => {
      if (state.doc !== docRef.current) {
        docRef.current = state.doc;
        indexRef.current.sync(state.doc);
      }
    });

    const canvas = canvasRef.current;
    if (canvas === null) return unsub;

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const cam = camRef.current;
      let next = cam;
      const animator = animatorRef.current;
      if (animator?.active === true) {
        next = animator.step(dt);
        if (!animator.active) animatorRef.current = null;
      }
      const inertia = inertiaRef.current;
      if (inertia?.active === true) {
        const { dx, dy } = inertia.step(dt);
        next = panBy(next, dx, dy);
      } else if (inertia !== null) {
        inertiaRef.current = null;
      }
      camRef.current = next;

      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(rect.width, 1);
      const h = Math.max(rect.height, 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (ctx !== null) {
        const store = useEditorStore.getState();
        const tool = store.tool;
        const scene = buildScene(store.doc, next, { w, h }, store.sel, {
          rubber: tool.k === "rubber" ? { from: tool.start, to: tool.current } : null,
          wirePreview: wirePreview(tool),
          ghost:
            tool.k === "place"
              ? { defId: tool.defId, at: tool.pos, rot: tool.rot, mirrorX: tool.mirrorX }
              : null,
          showGrid: true,
        });
        renderScene(
          ctx,
          scene.ops,
          { scale: next.scale, x: next.x, y: next.y, dpr, width: w, height: h },
          paletteRef.current,
        );
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const snappedNow = (): { pos: { x: number; y: number }; doc: { x: number; y: number } } => {
      const store = useEditorStore.getState();
      const rect = canvas.getBoundingClientRect();
      const raw = pointerRef.current ?? { x: rect.width / 2, y: rect.height / 2 };
      const doc = screenToDoc(raw, camRef.current);
      const snap = snapPoint(doc, indexRef.current, {
        grid: store.doc.grid,
        enabled: true,
        disabled: false,
        gridOnly: false,
      });
      return { pos: snap.pos, doc };
    };

    const onPointerDown = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      animatorRef.current = null;
      inertiaRef.current = null;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const { pos } = snappedNow();
      const store = useEditorStore.getState();
      const hit = indexRef.current.hit(pos, 300);
      store.dispatch(
        {
          t: "down",
          button: e.button,
          mods: { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
        },
        pos,
        hit !== null,
        { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
      );
      if (e.button === 1 || store.tool.k === "pan")
        lastPanRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    };

    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const store = useEditorStore.getState();
      if (store.tool.k === "pan" && lastPanRef.current !== null) {
        const dx = e.clientX - lastPanRef.current.x;
        const dy = e.clientY - lastPanRef.current.y;
        lastPanRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        camRef.current = panBy(camRef.current, dx, dy);
        return;
      }
      const { pos } = snappedNow();
      store.dispatch({ t: "move" }, pos, indexRef.current.hit(pos, 300) !== null, {
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey || e.metaKey,
      });
    };

    const onPointerUp = (e: PointerEvent): void => {
      const store = useEditorStore.getState();
      // Inertia for pan release.
      if (store.tool.k === "pan" && lastPanRef.current !== null) {
        const dt = (performance.now() - lastPanRef.current.t) / 1000;
        if (dt > 0 && dt < 0.12) {
          const vx = ((e.clientX - lastPanRef.current.x) / dt) * 0.6;
          const vy = ((e.clientY - lastPanRef.current.y) / dt) * 0.6;
          if (Math.abs(vx) + Math.abs(vy) > 60) inertiaRef.current = makeInertia(vx, vy);
        }
        lastPanRef.current = null;
      }
      const { pos } = snappedNow();
      store.dispatch(
        {
          t: "up",
          button: e.button,
          mods: { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
        },
        pos,
        false,
        { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
      );
    };

    const onClick = (e: MouseEvent): void => {
      const { pos } = snappedNow();
      const store = useEditorStore.getState();
      store.dispatch({ t: "click" }, pos, indexRef.current.hit(pos, 300) !== null, {
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey || e.metaKey,
      });
    };

    const onDblClick = (): void => {
      const { pos } = snappedNow();
      useEditorStore
        .getState()
        .dispatch({ t: "dblclick" }, pos, false, { shift: false, alt: false, ctrl: false });
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0012);
      camRef.current = zoomAt(camRef.current, screen, factor);
    };

    const onContext = (e: MouseEvent): void => {
      e.preventDefault();
      useEditorStore.getState().dispatch({ t: "cancel" }, { x: 0, y: 0 }, false, {
        shift: false,
        alt: false,
        ctrl: false,
      });
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    const onFit = (ev: Event): void => {
      const target = (ev as CustomEvent<CameraState>).detail;
      animatorRef.current = animateToState(camRef.current, target);
    };
    canvas.addEventListener("studio:camera-fit", onFit);
    return () => {
      canvas.removeEventListener("studio:camera-fit", onFit);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
    };
  }, []);

  // Keyboard: Esc cancels; Delete deletes; R/X rotate/mirror; Home fits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const store = useEditorStore.getState();
      if (e.key === "Escape") {
        store.dispatch({ t: "cancel" }, { x: 0, y: 0 }, false, {
          shift: false,
          alt: false,
          ctrl: false,
        });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        store.deleteSelection();
      } else if (e.key === "r" || e.key === "R") {
        store.dispatch(
          { t: "key", key: "r", mods: { shift: false, alt: false, ctrl: false } },
          { x: 0, y: 0 },
          false,
          { shift: false, alt: false, ctrl: false },
        );
        store.rotateSelection();
      } else if (e.key === "x" || e.key === "X") {
        store.dispatch(
          { t: "key", key: "x", mods: { shift: false, alt: false, ctrl: false } },
          { x: 0, y: 0 },
          false,
          { shift: false, alt: false, ctrl: false },
        );
        store.mirrorSelection();
      } else if (e.key === "Home") {
        zoomToFit();
      } else if (e.key === "w" || e.key === "W") {
        store.setTool("wire");
      } else if (e.key === "j" || e.key === "J") {
        addJunction();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full min-h-0 w-full bg-[var(--canvas-bg)]" data-testid="canvas-root">
      <canvas
        ref={canvasRef}
        data-testid="schematic-canvas"
        className="h-full w-full cursor-crosshair touch-none select-none"
      />
      <CanvasTools />
    </div>
  );
}

/** Public camera actions used by commands (zoom-to-fit etc.). */
export function zoomToFit(): void {
  const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
    '[data-testid="schematic-canvas"]',
  );
  const rect = canvas?.getBoundingClientRect();
  const viewport = { w: rect?.width ?? 1200, h: rect?.height ?? 800 };
  const target = fitRect(docBounds(useEditorStore.getState().doc), viewport);
  animateToImmediate(target);
}

function animateToImmediate(target: CameraState): void {
  const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
    '[data-testid="schematic-canvas"]',
  );
  if (canvas === null) return;
  canvas.dispatchEvent(new CustomEvent("studio:camera-fit", { detail: target }));
}

function animateToState(from: CameraState, target: CameraState): CameraAnimator {
  return animateTo(from, target, false);
}

function addJunction(): void {
  const store = useEditorStore.getState();
  void store;
  // Junction tool lands with UX2 probe plumbing; keyboard binding kept warm.
}

/** Tool badge: shows the active tool + status hint over the canvas. */
function CanvasTools(): React.ReactNode {
  const status = useEditorStore((s) => s.status);
  const tool = useEditorStore((s) => s.tool);
  const label =
    tool.k === "place"
      ? `Place: ${tool.defId}`
      : tool.k === "wire"
        ? "Wire"
        : tool.k === "pan"
          ? "Pan"
          : "Select";
  return (
    <div
      data-testid="canvas-status"
      className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-line bg-elevated px-2 py-1 text-2xs text-muted"
    >
      {status !== "" ? status : label}
    </div>
  );
}

// Keep docToScreen referenced for future overlay math (badges UX4).
void docToScreen;
