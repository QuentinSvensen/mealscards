/**
 * calorieGoalRange — Logique pure de la fourchette d'objectif calorique.
 *
 * L'objectif calorique peut désormais être une fourchette « basse–haute ».
 * La borne haute reste la cible principale (compatibilité : c'est l'ancienne
 * valeur unique `planning_daily_goal`) et sert aux calculs de calories
 * restantes. La borne basse optionnelle (> 0) active le mode strict du seuil
 * « Au choix » (reste pile) ; sinon on garde le lissage historique.
 *
 * Si seule la borne haute est renseignée, le Planning colore comme une
 * fourchette virtuelle [max − 100, max]. Cette fourchette virtuelle n’active
 * PAS le mode strict du seuil « Au choix » (seul un min explicitement > 0 le fait).
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

/** Tolérance au-dessus du max avant de colorer le total en noir (≥ 100 kcal). */
export const CALORIE_GOAL_OVER_MAX_BLACK_OFFSET = 100;

/**
 * Couleur du total kcal quand une fourchette (réelle ou virtuelle max−100) est active :
 * vert dans la fourchette, rouge dès dépassement du max,
 * noir si dépassement ≥ 100 kcal au-dessus du max, blanc (null) en dessous.
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
  const overBlack = nHigh + CALORIE_GOAL_OVER_MAX_BLACK_OFFSET * scale;
  const rounded = Math.round(total);
  // Noir si dépassement ≥ 100 kcal au-dessus du max ; rouge dès le moindre dépassement.
  if (rounded >= overBlack) return "text-black";
  if (rounded > nHigh) return "text-red-400";
  if (rounded >= nLow) return "text-emerald-500";
  return null;
}

/**
 * Indique si le total kcal du jour est affiché en vert (objectif atteint / dans la fourchette).
 * Réutilise la même règle que `getCalorieRangeTotalColorClass` (badge Planning).
 */
export function isDayCaloriesGoalMet(
  total: number,
  low: number | null | undefined,
  high: number | null | undefined,
  dayScale = 1,
): boolean {
  return getCalorieRangeTotalColorClass(total, low, high, dayScale) === "text-emerald-500";
}

/**
 * Calcule les calories restantes du jour jusqu'à la borne haute d'objectif.
 * Formule : max(0, objectifMax − calories déjà planifiées/consommées).
 * Sert au bandeau Planning (« reste … ») et au filtre catalogue Extras.
 */
export function getRemainingDayCalories(goalHigh: number, dayCalories: number): number {
  const high = typeof goalHigh === "number" && Number.isFinite(goalHigh) ? goalHigh : 0;
  const consumed = typeof dayCalories === "number" && Number.isFinite(dayCalories) ? dayCalories : 0;
  return Math.max(0, high - consumed);
}

/**
 * Indique si une borne basse calorique a été explicitement saisie (> 0).
 * La fourchette virtuelle max−100 (colorimétrie Planning) ne compte pas.
 */
export function hasExplicitCalorieGoalMin(low: number | null | undefined): boolean {
  return typeof low === "number" && Number.isFinite(low) && low > 0;
}

/**
 * Seuil « Au choix » historique (lissage) : reste du jour − moyenne des écarts
 * (conso − objectif) des jours antérieurs de la même semaine ayant conso > 0.
 * Si les jours passés sont sous l'objectif, l'écart moyen est négatif → le seuil augmente
 * (ex. reste 30 et moyenne −800 → seuil ≈ 830, pas le reste pile).
 */
export function resolveHabitualAvailableCalorieThreshold(
  goalHigh: number,
  dayCalories: number,
  pastDayCalories: readonly number[] = [],
): number {
  const high = typeof goalHigh === "number" && Number.isFinite(goalHigh) ? goalHigh : 0;
  const consumed =
    typeof dayCalories === "number" && Number.isFinite(dayCalories) ? dayCalories : 0;

  let differencesSum = 0;
  let daysCount = 0;
  for (const past of pastDayCalories) {
    if (typeof past === "number" && Number.isFinite(past) && past > 0) {
      differencesSum += past - high;
      daysCount++;
    }
  }

  const avgDifference = daysCount > 0 ? differencesSum / daysCount : 0;
  // Pas de clamp du reste avant lissage (comportement historique pré-strict).
  const remainingToday = high - consumed;
  return Math.max(0, remainingToday - avgDifference);
}

/**
 * Calcule le seuil max « Au choix » (filtre « Carte en fonction des calories restantes »).
 * — Si calorie min explicitement renseignée (> 0) : mode strict
 *   max(0, Math.round(borneHaute) − Math.round(conso)) — le min n’entre pas dans le calcul,
 *   il active seulement ce mode (ex. 2200 − 1423 = 777).
 * — Sinon (min vide / 0) : formule habituelle de lissage
 *   resolveHabitualAvailableCalorieThreshold (moyenne des écarts des jours antérieurs).
 *   La fourchette virtuelle max−100 ne compte PAS comme min renseigné.
 */
export function resolveAvailableCalorieThreshold(
  goalHigh: number,
  dayCalories: number,
  goalLow: number | null | undefined = null,
  pastDayCalories: readonly number[] = [],
): number {
  if (hasExplicitCalorieGoalMin(goalLow)) {
    const high = typeof goalHigh === "number" && Number.isFinite(goalHigh) ? goalHigh : 0;
    const consumed =
      typeof dayCalories === "number" && Number.isFinite(dayCalories) ? dayCalories : 0;
    return Math.max(0, Math.round(high) - Math.round(consumed));
  }
  return resolveHabitualAvailableCalorieThreshold(goalHigh, dayCalories, pastDayCalories);
}

/**
 * Indique si les kcal d'un extra rentrent dans le budget calorique restant du jour.
 */
export function extraFitsRemainingCalories(extraKcal: number, remainingCalories: number): boolean {
  const kcal = typeof extraKcal === "number" && Number.isFinite(extraKcal) ? extraKcal : 0;
  const remaining =
    typeof remainingCalories === "number" && Number.isFinite(remainingCalories) ? remainingCalories : 0;
  return kcal <= remaining;
}
