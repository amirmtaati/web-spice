/**
 * Experiment registry (UX2-T7): id → validated recipe. Registration
 * validates once at module load — a broken recipe fails loudly in dev/test,
 * never in front of a student.
 */
import { RECIPES } from "./recipes.ts";
import { type ExperimentRecipe, validateExperiment } from "./schema.ts";

const registry = new Map<string, ExperimentRecipe>();

for (const raw of RECIPES) {
  const result = validateExperiment(raw);
  if (!result.ok) {
    throw new Error(
      `experiment "${String((raw as { id?: unknown }).id)}" invalid: ${result.error}`,
    );
  }
  registry.set(result.value.id, result.value);
}

/** All experiments (menu order). */
export function listExperiments(): readonly ExperimentRecipe[] {
  return [...registry.values()];
}

/** One experiment by id. */
export function getExperiment(id: string): ExperimentRecipe | undefined {
  return registry.get(id);
}

/** Test seam: register an extra recipe (validated). */
export function registerExperimentForTests(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  const result = validateExperiment(raw);
  if (!result.ok) {
    return result;
  }
  registry.set(result.value.id, result.value);
  return { ok: true };
}

/** Test seam: drop a registration. */
export function unregisterExperimentForTests(id: string): void {
  registry.delete(id);
}
