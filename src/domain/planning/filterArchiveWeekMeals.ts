import type { PossibleMeal } from "@/types/meals";
import type { PlanningWeekDayLike } from "@/lib/planningWeekUtils";
import { isIsoDateString, isIsoWithinRange } from "./dailyCalorieHistory";
import type { PossibleMealBackupCard } from "./types";

/**
 * Filtre les repas possibles pour ne garder que ceux de la semaine archivée.
 * Priorité aux clés ISO (2026-07-20…) ; sinon repli sur les clés jour (lundi…).
 */
export function filterPossibleMealsForArchiveWeek(
  possibleMeals: PossibleMeal[],
  archivedWeekDates: PlanningWeekDayLike[],
): PossibleMeal[] {
  if (archivedWeekDates.length === 0) return possibleMeals;
  const isoSet = new Set(archivedWeekDates.map((d) => d.iso));
  const keySet = new Set(archivedWeekDates.map((d) => d.key));
  const isoMatches = possibleMeals.filter((pm) => pm.day_of_week && isoSet.has(pm.day_of_week));
  if (isoMatches.length > 0) return isoMatches;
  return possibleMeals.filter((pm) => pm.day_of_week && keySet.has(pm.day_of_week));
}

/**
 * Même filtre pour les cartes déjà sérialisées dans possible_meals_backup.
 */
export function filterBackupCardsForArchiveWeek(
  cards: PossibleMealBackupCard[],
  archivedWeekDates: PlanningWeekDayLike[],
  weekStartISO?: string | null,
  weekEndISO?: string | null,
): PossibleMealBackupCard[] {
  if (archivedWeekDates.length === 0) return cards;
  const isoSet = new Set(archivedWeekDates.map((d) => d.iso));
  const keySet = new Set(archivedWeekDates.map((d) => d.key));

  const isoMatches = cards.filter((c) => {
    const dow = c.day_of_week;
    if (!dow || !isIsoDateString(dow)) return false;
    if (isoSet.has(dow)) return true;
    if (weekStartISO && weekEndISO) {
      return isIsoWithinRange(dow, weekStartISO, weekEndISO);
    }
    return false;
  });
  if (isoMatches.length > 0) return isoMatches;

  return cards.filter((c) => c.day_of_week && keySet.has(c.day_of_week));
}
