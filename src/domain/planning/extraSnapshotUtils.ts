import type { PlanningSnapshotEntry } from "./types";
import { clearWeekdayScopedSnapshots, type JsDayToPlanningKey } from "./weekdaySnapshotUtils";

export type { JsDayToPlanningKey };

/**
 * Supprime tous les snapshots 💾 « extra-… » d’un jour donné :
 * clé ISO courante, clé jour (lundi…), et anciennes dates ISO du même jour de semaine.
 * Évite qu’un oubli de save laisse un snapshot historique visible en semaine suivante.
 */
export function clearExtraSnapshotsForWeekday(
  snapshots: Record<string, PlanningSnapshotEntry>,
  iso: string,
  dayKey: string,
  jsDayToKey: JsDayToPlanningKey,
): Record<string, PlanningSnapshotEntry> {
  return clearWeekdayScopedSnapshots(snapshots, "extra", iso, dayKey, jsDayToKey);
}

/**
 * Réinitialise le brouillon semaine suivante pour les extras d’un jour :
 * sélection vide explicite et macros à 0 (ne pas retomber sur d’anciens snapshots).
 */
export function clearNextWeekExtraStateForDay(
  selections: Record<string, string[]>,
  calories: Record<string, number>,
  proteins: Record<string, number>,
  iso: string,
  dayKey: string,
): {
  selections: Record<string, string[]>;
  calories: Record<string, number>;
  proteins: Record<string, number>;
} {
  const nextSelections = { ...selections };
  const nextCalories = { ...calories };
  const nextProteins = { ...proteins };

  nextSelections[dayKey] = [];
  nextSelections[iso] = [];
  nextCalories[dayKey] = 0;
  nextCalories[iso] = 0;
  nextProteins[dayKey] = 0;
  nextProteins[iso] = 0;

  return {
    selections: nextSelections,
    calories: nextCalories,
    proteins: nextProteins,
  };
}
