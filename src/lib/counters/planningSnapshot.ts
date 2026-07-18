import type { PossibleMeal } from "@/hooks/useMeals";

/**
 * Construit une empreinte stable du planning Possible (id + jour + créneau).
 * Sert à relancer la synchro Prog. à chaque changement, pas seulement au 1er chargement.
 */
export function buildPossiblePlanningSnapshot(possibleMeals: PossibleMeal[]): string {
  return possibleMeals
    .map((pm) => `${pm.id}:${pm.day_of_week ?? ""}:${String(pm.meal_time ?? "")}`)
    .sort()
    .join("|");
}
