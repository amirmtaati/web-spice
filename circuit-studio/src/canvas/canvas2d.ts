/**
 * Canvas2D renderer (UX1-T1) + SVG exporter from the same draw list. Colors
 * come from the theme's CSS variables (theme-aware without re-rendering the
 * scene). Canvas2D is the current backend; the Renderer seam keeps a WebGL
 * backend swappable (deviation from GPU-first recorded for UX1).
 */

import type { DrawOp } from "./scene.ts";

export type Palette = Readonly<Record<string, string>>;

/** Read the current theme's canvas tokens into a palette. */
export function readPalette(): Palette {
  if (typeof globalThis.document === "undefined") {
    return {}; // non-DOM context (tests): renderers require a document anyway
  }
  const css = getComputedStyle(globalThis.document.documentElement);
  const get = (name: string): string => css.getPropertyValue(name).trim();
  return {
    grid: get("--grid-dot"),
    gridMajor: get("--grid-dot"),
    wire: get("--wire"),
    wireSelected: get("--wire-selected"),
    symbol: get("--symbol-body"),
    symbolSelected: get("--wire-selected"),
    pin: get("--pin"),
    junction: get("--junction"),
    label: get("--label"),
    text: get("--label"),
    overlay: get("--accent"),
    guide: get("--guide"),
    ghost: get("--ghost"),
    sig1: get("--sig-1"),
    sig2: get("--sig-2"),
    sig3: get("--sig-3"),
    sig4: get("--sig-4"),
    sig5: get("--sig-5"),
    sig6: get("--sig-6"),
    sig7: get("--sig-7"),
    sig8: get("--sig-8"),
  };
}

const LAYER_COLOR: Readonly<Record<string, readonly string[]>> = {
  grid: ["grid"],
  wire: ["wire", "wireSelected"],
  junction: ["junction"],
  symbol: ["symbol", "symbolSelected"],
  pin: ["pin"],
  label: ["label"],
  text: ["text"],
  erc: ["wire"],
  overlay: ["overlay"],
  selection: ["symbolSelected"],
  probe: ["overlay"],
};

/** Line widths in doc units (≈ 6 mil default, master §9.5). */
const LAYER_WIDTH: Readonly<Record<string, number>> = {
  grid: 8,
  wire: 60,
  junction: 0,
  symbol: 60,
  pin: 40,
  label: 0,
  text: 0,
  erc: 40,
  overlay: 40,
  selection: 70,
};

function colorFor(palette: Palette, layer: string, selected: boolean): string {
  const names = LAYER_COLOR[layer] ?? ["text"];
  const name = selected && names.length > 1 ? (names[1] ?? "text") : (names[0] ?? "text");
  return palette[name] ?? "currentColor";
}

export interface RenderTarget {
  readonly width: number;
  readonly height: number;
  /** Apply the camera: doc units → device pixels (incl. DPR). */
  readonly transform: CanvasTransform;
}

export interface CanvasTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
}

/** Draw the scene to a 2D context. Sync, allocation-light per frame. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  t: CanvasTransform,
  palette: Palette,
): void {
  ctx.setTransform(t.dpr, 0, 0, t.dpr, 0, 0);
  ctx.fillStyle = palette.grid ?? "transparent";
  ctx.fillRect(0, 0, t.width / t.dpr, t.height / t.dpr);
  ctx.setTransform(
    t.dpr * t.scale,
    0,
    0,
    t.dpr * t.scale,
    -t.x * t.dpr * t.scale,
    -t.y * t.dpr * t.scale,
  );
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let currentLayer = "";
  for (const op of ops) {
    if (op.layer !== currentLayer) {
      currentLayer = op.layer;
      const selected = op.layer === "selection";
      ctx.strokeStyle = colorFor(palette, op.layer, selected);
      ctx.fillStyle = ctx.strokeStyle;
      const w = LAYER_WIDTH[op.layer] ?? 40;
      ctx.lineWidth = Math.max(w, 1 / t.scale);
    }
    // Per-op color override (probe channels read sig tokens, §4.1).
    if (op.op === "circle" || op.op === "text") {
      if (op.colorKey !== undefined) {
        const c = palette[op.colorKey];
        if (c !== undefined && c !== "") {
          ctx.strokeStyle = c;
          ctx.fillStyle = c;
        }
      }
    }
    switch (op.op) {
      case "dot":
        ctx.beginPath();
        ctx.arc(op.at.x, op.at.y, op.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "circle":
        ctx.beginPath();
        ctx.arc(op.at.x, op.at.y, op.r, 0, Math.PI * 2);
        if (op.fill === true) ctx.fill();
        else ctx.stroke();
        break;
      case "arc":
        ctx.beginPath();
        ctx.arc(op.at.x, op.at.y, op.r, op.a0, op.a1);
        ctx.stroke();
        break;
      case "line":
      case "poly": {
        ctx.beginPath();
        const pts = op.pts;
        const first = pts[0];
        if (first === undefined) break;
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
          const pt = pts[i];
          if (pt !== undefined) ctx.lineTo(pt.x, pt.y);
        }
        if (op.op === "poly" && op.fill === true) {
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.stroke();
        }
        break;
      }
      case "rect":
        if (op.fill === true) ctx.fillRect(op.x, op.y, op.w, op.h);
        else ctx.strokeRect(op.x, op.y, op.w, op.h);
        break;
      case "text": {
        const px = Math.max(op.size, 0);
        ctx.font = `${op.bold === true ? "600 " : ""}${px}px "IBM Plex Sans", sans-serif`;
        ctx.textAlign = op.align ?? "left";
        ctx.textBaseline = "middle";
        ctx.fillText(op.text, op.at.x, op.at.y);
        break;
      }
      case "xCross": {
        ctx.beginPath();
        ctx.moveTo(op.at.x - op.r, op.at.y - op.r);
        ctx.lineTo(op.at.x + op.r, op.at.y + op.r);
        ctx.moveTo(op.at.x + op.r, op.at.y - op.r);
        ctx.lineTo(op.at.x - op.r, op.at.y + op.r);
        ctx.stroke();
        break;
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** SVG export (master §9.1): vector, accurate, from the scene graph. */
export function exportSvg(
  ops: readonly DrawOp[],
  bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  palette: Palette,
  background = true,
): string {
  const pad = 500;
  const x = bounds.x - pad;
  const y = bounds.y - pad;
  const w = bounds.w + pad * 2;
  const h = bounds.h + pad * 2;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`,
  ];
  if (background) {
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${palette.grid}"/>`);
  }
  for (const op of ops) {
    if (op.layer === "grid") continue; // grid is screen furniture, not content
    let color = colorFor(palette, op.layer, op.layer === "selection");
    if ((op.op === "circle" || op.op === "text") && op.colorKey !== undefined) {
      const c = palette[op.colorKey];
      if (c !== undefined && c !== "") {
        color = c;
      }
    }
    const stroke = `stroke="${color}" stroke-width="${LAYER_WIDTH[op.layer] ?? 40}" fill="none" stroke-linecap="round"`;
    switch (op.op) {
      case "dot":
        parts.push(`<circle cx="${op.at.x}" cy="${op.at.y}" r="${op.r}" fill="${color}"/>`);
        break;
      case "circle":
        parts.push(
          `<circle cx="${op.at.x}" cy="${op.at.y}" r="${op.r}" ${op.fill === true ? `fill="${color}"` : stroke}/>`,
        );
        break;
      case "arc":
        parts.push(
          `<path d="M ${op.at.x + op.r * Math.cos(op.a0)} ${op.at.y + op.r * Math.sin(op.a0)} A ${op.r} ${op.r} 0 0 1 ${op.at.x + op.r * Math.cos(op.a1)} ${op.at.y + op.r * Math.sin(op.a1)}" ${stroke}/>`,
        );
        break;
      case "line":
      case "poly": {
        const d = op.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
        const closed = op.op === "poly" && op.fill === true;
        parts.push(`<path d="${d}${closed ? " Z" : ""}" ${closed ? `fill="${color}"` : stroke}/>`);
        break;
      }
      case "rect":
        parts.push(
          `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" ${op.fill === true ? `fill="${color}"` : stroke}/>`,
        );
        break;
      case "text":
        parts.push(
          `<text x="${op.at.x}" y="${op.at.y}" font-size="${op.size}" fill="${color}" text-anchor="${op.align ?? "start"}" dominant-baseline="middle" font-family="IBM Plex Sans, sans-serif">${escapeXml(op.text)}</text>`,
        );
        break;
      case "xCross":
        parts.push(
          `<path d="M ${op.at.x - op.r} ${op.at.y - op.r} L ${op.at.x + op.r} ${op.at.y + op.r} M ${op.at.x + op.r} ${op.at.y - op.r} L ${op.at.x - op.r} ${op.at.y + op.r}" ${stroke}/>`,
        );
        break;
    }
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}
