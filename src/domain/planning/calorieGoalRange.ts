/**
 * calorieGoalRange — Logique pure de la fourchette d'objectif calorique.
 *
 * L'objectif calorique peut désormais être une fourchette « basse–haute ».
 * La borne haute reste la cible principale (compatibilité : c'est l'ancienne
 * valeur unique `planning_daily_goal`) et sert à tous les calculs de calories
 * restantes / seuil. La borne basse est optionnelle et purement indicative.
 */

/** Fourchette normalisée : borne basse optionnelle, borne haute = cible principale. */
export interface CalorieGoalRange {
  low: number | null;
  high: number;
}

/**
 * Normalise une fourchette saisie par l'utilisateur (validation souple).
 * Ignore les bornes <= 0, arrondit les valeurs et, si la borne basse dépasse la
 * borne haute, échange les deux pour garder une fourchette cohérente et prévisible.
 */
export function normalizeCalorieGoalRange(
  low: number | null | undefined,
  high: number | null | undefined,
): CalorieGoalRange {
  const cleanHigh = typeof high === "number" && high > 0 ? Math.round(high) : 0;
  const cleanLow = typeof low === "number" && low > 0 ? Math.round(low) : null;

  if (cleanLow != null && cleanHigh > 0 && cleanLow > cleanHigh) {
    // Basse > haute : on échange pour rester prévisible.
    return { low: cleanHigh, high: cleanLow };
  }
  return { low: cleanLow, high: cleanHigh };
}

/**
 * Met en forme la cible calorique pour l'affichage des badges de jour.
 * Retourne « basse–haute » quand une borne basse distincte existe,
 * sinon la borne haute seule (comportement historique).
 */
export function formatCalorieGoalTarget(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  const { low: nLow, high: nHigh } = normalizeCalorieGoalRange(low, high);
  if (nLow != null && nLow !== nHigh) {
    return `${nLow}\u2013${nHigh}`;
  }
  return String(nHigh);
}
