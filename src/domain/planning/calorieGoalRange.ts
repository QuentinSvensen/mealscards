/**
 * calorieGoalRange — Logique pure de la fourchette d'objectif calorique.
 *
 * L'objectif calorique peut désormais être une fourchette « basse–haute ».
 * La borne haute reste la cible principale (compatibilité : c'est l'ancienne
 * valeur unique `planning_daily_goal`) et sert à tous les calculs de calories
 * restantes / seuil. La borne basse est optionnelle et purement indicative.
 *
 * Si seule la borne haute est renseignée, le Planning colore comme une
 * fourchette virtuelle [max − 100, max].
 */

/** Fourchette normalisée : borne basse optionnelle, borne haute = cible principale. */
export interface CalorieGoalRange {
  low: number | null;
  high: number;
}

/** Écart sous le max pour fabriquer une fourchette virtuelle quand le min est absent. */
export const CALORIE_GOAL_VIRTUAL_LOW_OFFSET = 100;

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
 * Résout la fourchette utilisée pour les couleurs Planning.
 * — Min réel distinct → fourchette saisie.
 * — Max seul → fourchette virtuelle [max − 100, max] (basse ≥ 1).
 */
export function resolveCalorieGoalRangeForColoring(
  low: number | null | undefined,
  high: number | null | undefined,
): CalorieGoalRange | null {
  const { low: nLow, high: nHigh } = normalizeCalorieGoalRange(low, high);
  if (nHigh <= 0) return null;
  if (nLow != null && nLow > 0 && nLow !== nHigh) {
    return { low: nLow, high: nHigh };
  }
  const virtualLow = Math.max(0, nHigh - CALORIE_GOAL_VIRTUAL_LOW_OFFSET);
  if (virtualLow <= 0 || virtualLow >= nHigh) return null;
  return { low: virtualLow, high: nHigh };
}

/**
 * Met en forme la cible calorique pour l'affichage des badges de jour.
 * Retourne « basse–haute » quand une borne basse distincte existe,
 * sinon la borne haute seule (comportement historique — pas de min virtuel affiché).
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

/**
 * Indique si une fourchette colorimétrique est active (min réel ou max seul → max−100).
 * Dans ce cas, le Planning masque les deltas « reste / + » par jour.
 */
export function hasCalorieGoalRangeMin(
  low: number | null | undefined,
  high: number | null | undefined,
): boolean {
  return resolveCalorieGoalRangeForColoring(low, high) != null;
}

/**
 * Couleur du total kcal quand une fourchette (réelle ou virtuelle max−100) est active :
 * vert dans la fourchette, rouge au-dessus, blanc (null) en dessous.
 * `dayScale` multiplie la fourchette journalière (ex. 7 pour le total semaine).
 */
export function getCalorieRangeTotalColorClass(
  total: number,
  low: number | null | undefined,
  high: number | null | undefined,
  dayScale = 1,
): string | null {
  const daily = resolveCalorieGoalRangeForColoring(low, high);
  if (!daily || daily.low == null || daily.high <= 0) return null;
  const scale = Number.isFinite(dayScale) && dayScale > 0 ? dayScale : 1;
  const nLow = daily.low * scale;
  const nHigh = daily.high * scale;
  const rounded = Math.round(total);
  if (rounded > nHigh) return "text-red-400";
  if (rounded >= nLow) return "text-emerald-500";
  return null;
}
