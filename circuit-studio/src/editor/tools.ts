/**
 * Tool state machines (master §9.2–9.5, UX layer §6.2 rule 2). Pure reducer:
 * events in → (state, effects) out. The store executes effects (doc edits,
 * selection changes). Esc always cancels with no undo entry.
 */
import type { Vec2 } from "../geometry.ts";

export type ToolId =
  | "select"
  | "wire"
  | "place"
  | "pan"
  | "text"
  | "probe"
  | "junction"
  | "noconnect";

export interface Mods {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
}

export type ToolState =
  | { readonly k: "idle"; readonly tool: ToolId }
  | { readonly k: "rubber"; readonly start: Vec2; readonly current: Vec2 }
  | { readonly k: "drag"; readonly start: Vec2; readonly current: Vec2; readonly moved: boolean }
  | {
      readonly k: "wire";
      readonly pts: readonly Vec2[];
      readonly current: Vec2;
      readonly flip: boolean;
      readonly mode: RouteMode;
    }
  | {
      readonly k: "place";
      readonly defId: string;
      readonly pos: Vec2;
      readonly rot: 0 | 1 | 2 | 3;
      readonly mirrorX: boolean;
    }
  | { readonly k: "pan"; readonly start: Vec2; readonly current: Vec2 };

export type RouteMode = "ortho" | "deg45" | "free";

export const nextRouteMode = (m: RouteMode): RouteMode =>
  m === "ortho" ? "deg45" : m === "deg45" ? "free" : "ortho";

export type Effect =
  | {
      readonly t: "rubberSelect";
      readonly from: Vec2;
      readonly to: Vec2;
      readonly enclosed: boolean;
    }
  | { readonly t: "rubber"; readonly rect: null }
  | { readonly t: "beginDrag" }
  | { readonly t: "dragMove"; readonly d: Vec2 }
  | { readonly t: "endDrag"; readonly d: Vec2 }
  | { readonly t: "beginPan" }
  | { readonly t: "panBy"; readonly d: Vec2 }
  | { readonly t: "endPan" }
  | { readonly t: "beginWire"; readonly at: Vec2 }
  | { readonly t: "commitWire"; readonly pts: readonly Vec2[] }
  | {
      readonly t: "ghostCommit";
      readonly defId: string;
      readonly at: Vec2;
      readonly rot: 0 | 1 | 2 | 3;
      readonly mirrorX: boolean;
    }
  | { readonly t: "setStatus"; readonly text: string }
  | { readonly t: "setTool"; readonly tool: ToolId };

export interface ToolCtx {
  /** Snapped cursor position (the store computes snapping before dispatch). */
  readonly snapped: Vec2;
  /** True when the down event hit a pin/wire/symbol (from the spatial index). */
  readonly hitSomething: boolean;
}

export interface ToolResult {
  readonly state: ToolState;
  readonly effects: readonly Effect[];
}

export const initialToolState = (tool: ToolId = "select"): ToolState => ({ k: "idle", tool });

/** Route one segment per the active mode (L-corner / 45° elbow / straight). */
export function routeSegment(
  from: Vec2,
  to: Vec2,
  mode: RouteMode,
  flip: boolean,
): readonly Vec2[] {
  if (mode === "free") return [to];
  if (mode === "ortho") {
    return flip ? [{ x: from.x, y: to.y }, to] : [{ x: to.x, y: from.y }, to];
  }
  // 45°: one diagonal segment + one straight segment.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const diag = Math.min(adx, ady);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const corner = { x: from.x + sx * diag, y: from.y + sy * diag };
  return flip ? [{ x: to.x - sx * 0, y: to.y - (ady - diag) * sy }, to] : [corner, to];
}

export function reduceTool(state: ToolState, ev: ToolEvent, ctx: ToolCtx): ToolResult {
  const p = ctx.snapped;
  switch (ev.t) {
    case "tool":
      return { state: { k: "idle", tool: ev.tool }, effects: [{ t: "setTool", tool: ev.tool }] };

    case "cancel":
      return cancelToIdle(state);

    case "place": {
      if (ev.defId === null) return { state: { k: "idle", tool: "select" }, effects: [] };
      return {
        state: { k: "place", defId: ev.defId, pos: p, rot: 0, mirrorX: false },
        effects: [{ t: "setStatus", text: "Click to place — R rotate, X/Y mirror, Esc cancels" }],
      };
    }

    case "down": {
      if (ev.button === 1 || (state.k === "idle" && state.tool === "pan")) {
        return {
          state: { k: "pan", start: p, current: p },
          effects: [{ t: "beginPan" }, { t: "setStatus", text: "Panning" }],
        };
      }
      switch (state.k) {
        case "idle": {
          if (state.tool === "wire") {
            return {
              state: { k: "wire", pts: [p], current: p, flip: false, mode: "ortho" },
              effects: [{ t: "beginWire", at: p }],
            };
          }
          if (state.tool !== "select") return { state, effects: [] };
          if (ctx.hitSomething && !ev.mods.shift) {
            return {
              state: { k: "drag", start: p, current: p, moved: false },
              effects: [{ t: "beginDrag" }],
            };
          }
          return {
            state: { k: "rubber", start: p, current: p },
            effects: [{ t: "setStatus", text: "Drag to select — LTR enclosed, RTL touching" }],
          };
        }
        case "place":
          return {
            state: {
              k: "place",
              defId: state.defId,
              pos: p,
              rot: state.rot,
              mirrorX: state.mirrorX,
            },
            effects: [
              {
                t: "ghostCommit",
                defId: state.defId,
                at: p,
                rot: state.rot,
                mirrorX: state.mirrorX,
              },
            ],
          };
        case "drag":
          return { state, effects: [] };
        case "rubber":
          return { state, effects: [] };
        case "pan":
          return { state, effects: [] };
        case "wire":
          return { state, effects: [] };
      }
      return { state, effects: [] };
    }

    case "move": {
      switch (state.k) {
        case "rubber":
          return { state: { ...state, current: p }, effects: [] };
        case "drag": {
          const d = { x: p.x - state.start.x, y: p.y - state.start.y };
          const moved = state.moved || d.x !== 0 || d.y !== 0;
          return {
            state: { ...state, current: p, moved },
            effects: moved ? [{ t: "dragMove", d }] : [],
          };
        }
        case "pan": {
          const d = { x: p.x - state.current.x, y: p.y - state.current.y };
          return { state: { ...state, current: p }, effects: [{ t: "panBy", d }] };
        }
        case "wire":
          return { state: { ...state, current: p }, effects: [] };
        case "place":
          return { state: { ...state, pos: p }, effects: [] };
        case "idle":
          return { state, effects: [] };
      }
      return { state, effects: [] };
    }

    case "up": {
      switch (state.k) {
        case "rubber":
          return {
            state: { k: "idle", tool: "select" },
            effects: [
              {
                t: "rubberSelect",
                from: state.start,
                to: p,
                enclosed: p.x >= state.start.x,
              },
              { t: "rubber", rect: null },
            ],
          };
        case "drag": {
          const d = { x: p.x - state.start.x, y: p.y - state.start.y };
          return {
            state: { k: "idle", tool: "select" },
            effects: [{ t: "endDrag", d }],
          };
        }
        case "pan":
          return { state: { k: "idle", tool: "pan" }, effects: [{ t: "endPan" }] };
        case "idle":
        case "place":
        case "wire":
          return { state, effects: [] };
      }
      return { state, effects: [] };
    }

    case "key": {
      if (ev.key === "Escape") return cancelToIdle(state);
      if (state.k === "place") {
        if (ev.key === "r" || ev.key === "R") {
          return { state: { ...state, rot: ((state.rot + 1) % 4) as 0 | 1 | 2 | 3 }, effects: [] };
        }
        if (ev.key === "x" || ev.key === "X") {
          return { state: { ...state, mirrorX: !state.mirrorX }, effects: [] };
        }
      }
      if (state.k === "wire" && (ev.key === " " || ev.key === "Space")) {
        if (ev.mods.shift) {
          const mode = nextRouteMode(state.mode);
          return {
            state: { ...state, mode },
            effects: [{ t: "setStatus", text: `Routing: ${mode}` }],
          };
        }
        return { state: { ...state, flip: !state.flip }, effects: [] };
      }
      return { state, effects: [] };
    }

    case "click": {
      if (state.k === "wire") {
        // Click adds a corner; finishing happens on double-click or by
        // clicking an existing endpoint/pin (ctx.hitSomething).
        if (ctx.hitSomething && state.pts.length >= 1) {
          const pts = finishWire(state);
          return {
            state: { k: "idle", tool: "wire" },
            effects: [{ t: "commitWire", pts }],
          };
        }
        return { state: { ...state, pts: [...state.pts, p], current: p }, effects: [] };
      }
      return { state, effects: [] };
    }

    case "dblclick": {
      if (state.k === "wire") {
        const pts = finishWire(state);
        return { state: { k: "idle", tool: "wire" }, effects: [{ t: "commitWire", pts }] };
      }
      return { state, effects: [] };
    }
  }
  return { state, effects: [] };
}

function finishWire(state: Extract<ToolState, { k: "wire" }>): readonly Vec2[] {
  const last = state.pts[state.pts.length - 1];
  if (last === undefined) return [state.current];
  const seg = routeSegment(last, state.current, state.mode, state.flip);
  return [...state.pts, ...seg];
}

function cancelToIdle(state: ToolState): ToolResult {
  const tool: ToolId = state.k === "idle" ? state.tool : state.k === "place" ? "place" : "select";
  const effects: Effect[] = [
    { t: "rubber", rect: null },
    { t: "setStatus", text: "" },
  ];
  if (state.k === "pan") effects.push({ t: "endPan" });
  return { state: { k: "idle", tool }, effects };
}

export type ToolEvent =
  | { readonly t: "tool"; readonly tool: ToolId }
  | { readonly t: "place"; readonly defId: string | null }
  | { readonly t: "down"; readonly button: number; readonly mods: Mods }
  | { readonly t: "up"; readonly button: number; readonly mods: Mods }
  | { readonly t: "move" }
  | { readonly t: "click" }
  | { readonly t: "dblclick" }
  | { readonly t: "key"; readonly key: string; readonly mods: Mods }
  | { readonly t: "cancel" };
