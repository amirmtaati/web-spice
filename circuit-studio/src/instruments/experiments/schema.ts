/**
 * Experiments data layer (UX2-T7, UI-UX-SPEC §6.7.4): declarative recipes
 * that configure circuit + analysis + probes + annotations in one action.
 * Data-driven and validated at the boundary — the scope renders callout
 * cards and annotation overlays from these recipes (UX3-T7).
 *
 * Validation is hand-rolled (no new dependency, ADR-free): recipes are our
 * own JSON, and every recipe is engine-parsed in tests.
 */
import type { AnalysisRequest } from "../../sim/types.ts";

/** Annotation overlays the scope/plot draws on top of the trace. */
export type ExperimentAnnotation =
  | {
      readonly kind: "hline";
      /** 0..1 of the driving source amplitude. */
      readonly fraction: number;
      readonly label: string;
    }
  | {
      readonly kind: "vline";
      /** Axis value, or "tau" for the time-constant marker. */
      readonly at: number | "tau";
      readonly label: string;
    }
  | {
      readonly kind: "band";
      readonly from: number | "3tau";
      readonly to: number | "5tau";
      readonly label: string;
    };

export interface ExperimentRecipe {
  /** Stable id ("rc-charge") — palette/menu key. */
  readonly id: string;
  readonly title: string;
  /** One-line physics explanation (callout card). */
  readonly explanation: string;
  /** "What to look for" (callout card). */
  readonly lookFor: string;
  /** Netlist template; `{name}` placeholders filled by `params`. */
  readonly netlist: string;
  readonly params: Readonly<Record<string, string>>;
  readonly analysis: AnalysisRequest;
  /** Probe signals streamed (engine `.probe` semantics, v()/i() names). */
  readonly probes: readonly string[];
  readonly annotations: readonly ExperimentAnnotation[];
  /**
   * First-order expectation (R·C) so the scope's "Estimate τ" fit can check
   * honesty; omitted for non-first-order experiments.
   */
  readonly tau?: { readonly r: number; readonly c: number };
}

// ─── runtime validation (typed, dependency-free) ─────────────────────────────

const ANALYSIS_KINDS = ["op", "dc", "ac", "tran", "noise", "tf"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Structural validation with actionable error strings. */
export function validateExperiment(
  raw: unknown,
): { ok: true; value: ExperimentRecipe } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "recipe must be an object" };
  if (!str(raw.id)) return { ok: false, error: "id required" };
  if (!str(raw.title)) return { ok: false, error: "title required" };
  if (!str(raw.explanation)) return { ok: false, error: "explanation required" };
  if (!str(raw.lookFor)) return { ok: false, error: "lookFor required" };
  if (!str(raw.netlist)) return { ok: false, error: "netlist required" };
  if (!raw.netlist.includes(".end")) return { ok: false, error: "netlist must end with .end" };
  if (!isRecord(raw.params)) return { ok: false, error: "params must be an object" };
  const analysis = raw.analysis;
  if (!isRecord(analysis) || !ANALYSIS_KINDS.includes(analysis.kind as never)) {
    return { ok: false, error: `analysis.kind must be one of ${ANALYSIS_KINDS.join("|")}` };
  }
  if (!Array.isArray(raw.probes) || raw.probes.some((p) => !str(p))) {
    return { ok: false, error: "probes must be non-empty signal strings" };
  }
  if (!Array.isArray(raw.annotations)) {
    return { ok: false, error: "annotations must be an array" };
  }
  for (const a of raw.annotations) {
    if (!isRecord(a)) return { ok: false, error: "annotation must be an object" };
    switch (a.kind) {
      case "hline":
        if (!num(a.fraction) || a.fraction <= 0 || a.fraction > 2) {
          return { ok: false, error: "hline.fraction must be in (0, 2]" };
        }
        if (!str(a.label)) return { ok: false, error: "hline.label required" };
        break;
      case "vline":
        if (a.at !== "tau" && !num(a.at)) {
          return { ok: false, error: "vline.at must be number or 'tau'" };
        }
        if (!str(a.label)) return { ok: false, error: "vline.label required" };
        break;
      case "band":
        if (!str(a.label)) return { ok: false, error: "band.label required" };
        break;
      default:
        return { ok: false, error: `unknown annotation kind "${String(a.kind)}"` };
    }
  }
  if (raw.tau !== undefined) {
    if (
      !isRecord(raw.tau) ||
      !num(raw.tau.r) ||
      !num(raw.tau.c) ||
      raw.tau.r <= 0 ||
      raw.tau.c <= 0
    ) {
      return { ok: false, error: "tau must be positive {r, c}" };
    }
  }
  return { ok: true, value: raw as unknown as ExperimentRecipe };
}

/** Fill `{name}` placeholders in a recipe netlist with its params. */
export function expandNetlist(recipe: ExperimentRecipe): string {
  return recipe.netlist.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, name: string) => {
    const v = recipe.params[name];
    return v === undefined ? raw : v;
  });
}
