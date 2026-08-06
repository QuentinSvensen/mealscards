import type { Meal } from "@/types/meals";

/**
 * Résout la description à afficher / éditer pour un repas.
 * Uniquement celle de la fiche liée : deux cartes homonymes (ex. plusieurs « Pot #1 »)
 * ne partagent plus leurs notes via le nom.
 */
export function resolveMealDescriptionForDisplay(
  meal: Pick<Meal, "id" | "name" | "description"> | null | undefined,
  _catalogMeals?: readonly Meal[] | null,
): string | null {
  const text = meal?.description;
  if (text == null) return null;
  return text.trim() ? text : null;
}
