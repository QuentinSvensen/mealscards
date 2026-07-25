import type { PossibleMeal } from "@/types/meals";

/** Clé user_preferences : ids des cartes Possible issues de « Tous ». */
export const MASTER_SOURCE_PM_IDS_PREF_KEY = "possible_master_source_pm_ids";

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
 * Retourne les repas Possible qui impactent le stock / les compteurs aliments.
 * Les cartes issues de « Tous » n’ont pas de déduction : elles ne doivent pas
 * déclencher ni maintenir le mode « Prog. » sur les fiches Aliments.
 */
export function filterStockAffectingPossibleMeals(
  meals: PossibleMeal[],
  masterSourcePmIds?: ReadonlySet<string> | readonly string[] | null,
): PossibleMeal[] {
  if (!masterSourcePmIds) return meals;
  const hasAny =
    masterSourcePmIds instanceof Set
      ? masterSourcePmIds.size > 0
      : masterSourcePmIds.length > 0;
  if (!hasAny) return meals;
  return meals.filter((pm) => !isMasterSourcePossibleMeal(pm.id, masterSourcePmIds));
}
