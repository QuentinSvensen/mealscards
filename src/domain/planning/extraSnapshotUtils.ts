import type { PlanningSnapshotEntry } from "./types";

/** Mappe l’indice JS getDay() vers la clé jour du planning (lundi…dimanche). */
export type JsDayToPlanningKey = Record<number, string>;

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
  const updated = { ...snapshots };
  delete updated[`extra-${iso}`];
  delete updated[`extra-${dayKey}`];

  for (const snapKey of Object.keys(updated)) {
    if (!snapKey.startsWith("extra-")) continue;
    const suffix = snapKey.slice("extra-".length);
    if (suffix === dayKey) {
      delete updated[snapKey];
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(suffix)) continue;
    const dow = jsDayToKey[new Date(`${suffix}T12:00:00`).getDay()];
    if (dow === dayKey) delete updated[snapKey];
  }

  return updated;
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
