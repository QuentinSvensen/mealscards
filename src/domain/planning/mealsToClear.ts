import type { PossibleMeal } from "@/hooks/useMeals";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Repas à supprimer lors du reset hebdomadaire : plateau (sans jour), jours nommés,
 * ou dates ISO jusqu’à la coupure de semaine incluse.
 */
export function filterPossibleMealsToDeleteForWeeklyClear(
  meals: PossibleMeal[],
  cutoffISO: string
): PossibleMeal[] {
  return meals.filter(pm => {
    if (!pm.day_of_week) return true;
    if (ISO_DAY.test(pm.day_of_week)) {
      return pm.day_of_week <= cutoffISO;
    }
    return true;
  });
}

/** Reset manuel : supprime toutes les cartes sauf le petit-déj « plateau » sans jour. */
export function getPossibleMealIdsToDeleteOnManualReset(fresh: PossibleMeal[]): string[] {
  return fresh
    .filter(pm => {
      if (pm.meals?.category === "petit_dejeuner" && !pm.day_of_week) return false;
      return true;
    })
    .map(pm => pm.id);
}
