/**
 * Experiment application (UX3-T7, UI-UX-SPEC §6.7.4): one action configures
 * circuit + analysis + probes + annotations. Flow: expand the recipe netlist
 * → load into the engine → select the recipe's analysis in simStore → point
 * the scope at the recipe's probes with resolved annotations (hline at
 * fraction·V, τ marker at R·C, steady-state band) → run.
 *
 * Honesty rule: τ annotations appear only when the recipe declares a
 * first-order expectation; the callout card always states what to look for.
 */

import { getSimController } from "../../sim/controller.ts";
import type { AnalysisRequest } from "../../sim/types.ts";
import { type AnalysisOptions, useSimStore } from "../../stores/sim-store.ts";
import { parseEngineering } from "../../ui/format.ts";
import {
  type ExperimentAnnotationView,
  type ExperimentContext,
  useScopeStore,
} from "../scope/scope-store.ts";
import { tauFromRC } from "../scope/tau.ts";
import { type ExperimentRecipe, expandNetlist } from "./schema.ts";

/** Convert a wire AnalysisRequest back into simStore options. */
export function analysisToOptions(a: AnalysisRequest): Partial<AnalysisOptions> {
  switch (a.kind) {
    case "op":
      return {};
    case "dc":
      return { dc: { source: a.source, start: a.start, stop: a.stop, step: a.step } };
    case "ac":
      return {
        ac: { sweep: a.sweep, points: a.points, fstart: a.fstart, fstop: a.fstop },
      };
    case "tran":
      return {
        tran: { tstep: a.tstep, tstop: a.tstop, tstart: a.tstart ?? 0, uic: a.uic ?? false },
      };
    case "noise":
      return {
        noise: {
          output: a.output,
          source: a.source,
          sweep: a.sweep,
          points: a.points,
          fstart: a.fstart,
          fstop: a.fstop,
        },
      };
    case "tf":
      return { tf: { output: a.output, source: a.source } };
  }
}

/** Resolve recipe annotations into scope-view annotations. */
export function resolveAnnotations(
  recipe: ExperimentRecipe,
  sourceAmplitude: number,
): ExperimentAnnotationView[] {
  return recipe.annotations.map((a): ExperimentAnnotationView => {
    switch (a.kind) {
      case "hline":
        return { kind: "hline", y: a.fraction * sourceAmplitude, label: a.label };
      case "vline":
        return { kind: "vline", x: a.at, label: a.label };
      case "band":
        return { kind: "band", from: a.from, to: a.to, label: a.label };
      default: {
        const never: never = a;
        throw new Error(`unknown annotation kind: ${JSON.stringify(never)}`);
      }
    }
  });
}

/** The driving source amplitude from the recipe params (`V`), parsed. */
export function sourceAmplitudeOf(recipe: ExperimentRecipe): number {
  const raw = recipe.params.V;
  if (raw === undefined) {
    return 1;
  }
  const v = parseEngineering(raw);
  return v === null ? 1 : Math.abs(v);
}

/**
 * Apply an experiment recipe end-to-end. Errors surface through the standard
 * sim error banner (load failures) — this function logs and rethrows.
 */
export async function applyRecipe(recipe: ExperimentRecipe): Promise<void> {
  const controller = getSimController();
  // Recipes declare their probe signals — append .probe cards exactly like
  // the document loader does (UX2-T6), so the engine streams v(out)/i(C1).
  const body = expandNetlist(recipe)
    .trimEnd()
    .replace(/\.end\s*$/, "");
  const netlist =
    recipe.probes.length > 0 ? `${body}\n.probe ${recipe.probes.join(" ")}\n.end` : `${body}\n.end`;
  await controller.loadSpice(netlist);

  // Select the recipe's analysis in simStore (controller.run() reads it).
  const sim = useSimStore.getState();
  sim.setAnalysisKind(recipe.analysis.kind);
  const patch = analysisToOptions(recipe.analysis)[recipe.analysis.kind];
  if (patch !== undefined) {
    sim.setOptions(recipe.analysis.kind, patch);
  }
  sim.setLive(false); // experiments are deterministic buffered runs

  // Point the scope at the recipe probes with resolved annotations.
  const scope = useScopeStore.getState();
  scope.selectSignals(recipe.probes);
  const ctx: ExperimentContext = {
    id: recipe.id,
    title: recipe.title,
    explanation: recipe.explanation,
    lookFor: recipe.lookFor,
    sourceAmplitude: sourceAmplitudeOf(recipe),
    ...(recipe.tau !== undefined ? { tau: tauFromRC(recipe.tau.r, recipe.tau.c) } : {}),
    annotations: resolveAnnotations(recipe, sourceAmplitudeOf(recipe)),
  };
  scope.setExperiment(ctx);

  // Fit the timebase to the analysis span (5τ for RC-family recipes).
  if (recipe.analysis.kind === "tran") {
    const span = recipe.analysis.tstop - (recipe.analysis.tstart ?? 0);
    scope.setSecPerDiv(span / 10 / 1.05);
    scope.setPosition(0.55);
  }
  scope.setShowMeasurements(true);

  await controller.run();
}

/** Alias kept for readability at call sites (menu onSelect). */
export const runRecipe = applyRecipe;
