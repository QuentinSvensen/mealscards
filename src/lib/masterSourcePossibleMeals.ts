import type { PossibleMeal } from "@/types/meals";
import { isNinjaCreamiStockExemptPossibleMeal } from "@/domain/ninjaCreami/ninjaCreami";

/** Clé user_preferences : ids des cartes Possible issues de « Tous ». */
export const MASTER_SOURCE_PM_IDS_PREF_KEY = "possible_master_source_pm_ids";

/** Ids Ninja Creami pour l’exemption stock (Tests / Recettes testées). */
export type PossibleNinjaStockExemptIds = {
  ninjaTestPmIds?: ReadonlySet<string> | readonly string[] | null;
  ninjaTestedMealIds?: ReadonlySet<string> | readonly string[] | null;
};

/**
 * Ajoute des ids à la liste des cartes Possible issues de « Tous ».
 */
export function addMasterSourcePmIds(
  current: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (id?.trim()) next.add(id);
  }
  return next;
}

/**
 * Indique si une carte Possible vient de la section « Tous ».
 */
export function isMasterSourcePossibleMeal(
  pmId: string | null | undefined,
  masterSourcePmIds: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
  if (!pmId?.trim() || !masterSourcePmIds) return false;
  if (masterSourcePmIds instanceof Set) return masterSourcePmIds.has(pmId);
  return masterSourcePmIds.includes(pmId);
}

/**
 * Indique si une carte Possible ne doit pas toucher au stock
 * (Tous, Ninja Tests, ou Recettes testées — même règle que le contour jaune).
 */
export function isPossibleMealStockExempt(
  pm: { id: string; meal_id?: string | null },
  masterSourcePmIds?: ReadonlySet<string> | readonly string[] | null,
  ninjaIds?: PossibleNinjaStockExemptIds | null,
): boolean {
  if (isMasterSourcePossibleMeal(pm.id, masterSourcePmIds)) return true;
  return isNinjaCreamiStockExemptPossibleMeal(
    pm.id,
    pm.meal_id,
    ninjaIds?.ninjaTestPmIds,
    ninjaIds?.ninjaTestedMealIds,
  );
}

/**
 * Retourne les repas Possible qui impactent le stock / les compteurs aliments.
 * Les cartes contour jaune (Tous / Ninja) n’ont pas de déduction.
 */
export function filterStockAffectingPossibleMeals(
  meals: PossibleMeal[],
  masterSourcePmIds?: ReadonlySet<string> | readonly string[] | null,
  ninjaIds?: PossibleNinjaStockExemptIds | null,
): PossibleMeal[] {
  return meals.filter((pm) => !isPossibleMealStockExempt(pm, masterSourcePmIds, ninjaIds));
}
