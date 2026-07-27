import type { PlanningWeekDayLike } from "@/lib/planningWeekUtils";
import { serializePossibleMealsForBackup } from "./buildBackupPayload";
import type { PossibleMeal } from "@/types/meals";
import type { PossibleMealBackupCard } from "./types";

/**
 * Récupère, parmi les cartes encore présentes en base, celles dont le jour
 * correspond à une date ISO de la semaine précédente affichée.
 * Sert de source de vérité quand la sauvegarde a archivé les mauvaises cartes.
 */
export function recoverPreviousWeekCardsFromLive(
  possibleMeals: PossibleMeal[],
  displayWeekDates: PlanningWeekDayLike[],
): PossibleMealBackupCard[] {
  if (displayWeekDates.length === 0) return [];
  const isoSet = new Set(displayWeekDates.map((d) => d.iso));
  const matching = possibleMeals.filter(
    (pm) => pm.day_of_week && isoSet.has(pm.day_of_week),
  );
  return serializePossibleMealsForBackup(matching);
}

/**
 * Combine cartes récupérées en base et cartes archivées.
 * Les cartes live (ISO exact de la semaine affichée) sont prioritaires ;
 * les cartes de sauvegarde ne complètent que les jours restés vides.
 */
export function mergeRecoveredAndBackupCards(
  recovered: PossibleMealBackupCard[],
  backupCards: PossibleMealBackupCard[],
  displayWeekDates: PlanningWeekDayLike[],
): PossibleMealBackupCard[] {
  if (recovered.length === 0) return backupCards;

  const coveredDays = new Set(recovered.map((c) => c.day_of_week).filter(Boolean) as string[]);
  const recoveredIds = new Set(recovered.map((c) => c.id));
  const isoByWeekdayIndex = displayWeekDates.map((d) => d.iso);
  const isoByKey = new Map(displayWeekDates.map((d) => [d.key, d.iso]));

  /** Ramène un jour de carte (ISO d’une autre semaine ou clé jour) sur l’ISO affiché. */
  const normalizeToDisplayIso = (dayOfWeek: string): string | null => {
    const fromKey = isoByKey.get(dayOfWeek);
    if (fromKey) return fromKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) return null;
    const jsDay = new Date(`${dayOfWeek}T12:00:00`).getDay();
    const index = jsDay === 0 ? 6 : jsDay - 1;
    return isoByWeekdayIndex[index] ?? null;
  };

  const complement = backupCards
    .filter((c) => !recoveredIds.has(c.id) && !!c.day_of_week)
    .map((c) => {
      const normalized = normalizeToDisplayIso(c.day_of_week as string);
      return normalized ? { ...c, day_of_week: normalized } : null;
    })
    .filter((c): c is PossibleMealBackupCard => !!c && !coveredDays.has(c.day_of_week as string));

  return [...recovered, ...complement];
}
