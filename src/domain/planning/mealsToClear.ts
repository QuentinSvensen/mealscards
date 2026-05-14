import type { PossibleMeal } from "@/hooks/useMeals";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Repas à supprimer lors du reset hebdomadaire : plateau (sans jour), jours nommés,
 * ou dates ISO jusqu'à la coupure de semaine incluse.
 *
 * Exception : les cartes créées UNIQUEMENT dans "Possible" (meals.is_available === false
 * et sans jour planifié) sont préservées — elles ne viennent pas du catalogue maître
 * et ne doivent pas être effacées par le reset hebdomadaire.
 */
export function filterPossibleMealsToDeleteForWeeklyClear(
  meals: PossibleMeal[],
  cutoffISO: string
): PossibleMeal[] {
  return meals.filter(pm => {
    // Carte sans jour planifié
    if (!pm.day_of_week) {
      // Conserver les cartes créées directement dans Possible (pas dans le catalogue maître)
      if (pm.meals?.is_available === false) return false;
      // Supprimer les autres cartes sans jour (venant du catalogue "au choix")
      return true;
    }
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
