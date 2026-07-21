/** Clé user_preferences : ids des repas créés via « Possibles uniquement ». */
export const POSSIBLE_ONLY_MEAL_IDS_PREF_KEY = "possible_only_created_meal_ids";

/**
 * Indique si une fiche repas a été créée via le bouton « Possibles uniquement »
 * (et peut donc être renommée depuis Possible).
 */
export function isPossibleOnlyCreatedMeal(
  mealId: string | null | undefined,
  possibleOnlyMealIds: readonly string[] | null | undefined,
): boolean {
  if (!mealId?.trim() || !possibleOnlyMealIds?.length) return false;
  return possibleOnlyMealIds.includes(mealId);
}

/**
 * Ajoute un meal_id à la liste des créations « Possibles uniquement » (sans doublon).
 */
export function appendPossibleOnlyMealId(
  current: readonly string[] | null | undefined,
  mealId: string,
): string[] {
  const id = mealId.trim();
  if (!id) return [...(current ?? [])];
  if ((current ?? []).includes(id)) return [...(current ?? [])];
  return [...(current ?? []), id];
}
