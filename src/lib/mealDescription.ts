import type { Meal } from "@/types/meals";

/**
 * Résout la description à afficher / éditer pour un repas Possible :
 * celle du repas lié, sinon celle d’une fiche Au choix ou Tous homonyme.
 * Sert de filet pour les copies multipliées créées avant la copie de `description`.
 */
export function resolveMealDescriptionForDisplay(
  meal: Pick<Meal, "id" | "name" | "description"> | null | undefined,
  catalogMeals?: readonly Meal[] | null,
): string | null {
  const own = meal?.description?.trim();
  if (own) return meal?.description ?? own;
  if (!meal?.name?.trim() || !catalogMeals?.length) return null;
  const target = meal.name.trim().toLowerCase();
  const candidates = catalogMeals.filter(
    (m) =>
      (!meal.id || m.id !== meal.id) &&
      m.name.trim().toLowerCase() === target &&
      !!m.description?.trim(),
  );
  // Préférer la fiche Au choix, sinon une fiche Tous (Master) homonyme.
  const preferred = candidates.find((m) => m.is_available) ?? candidates[0];
  return preferred?.description?.trim() ? preferred.description : null;
}

/**
 * Collecte les ids de toutes les fiches repas du même nom (Possible / Tous / Au choix).
 * Sert à synchroniser la description entre copies liées.
 */
export function collectLinkedMealIdsByName(
  meals: readonly Pick<Meal, "id" | "name">[] | null | undefined,
  mealId: string,
): string[] {
  if (!meals?.length) return [mealId];
  const current = meals.find((m) => m.id === mealId);
  const target = current?.name?.trim().toLowerCase();
  if (!target) return [mealId];
  const ids = meals
    .filter((m) => m.name.trim().toLowerCase() === target)
    .map((m) => m.id);
  return ids.length > 0 ? ids : [mealId];
}
