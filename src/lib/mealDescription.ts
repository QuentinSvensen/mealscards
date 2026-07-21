import type { Meal } from "@/types/meals";

/**
 * Résout la description à afficher pour un repas Possible :
 * celle du repas lié, sinon celle d’une fiche Master / Au choix homonyme.
 * Sert de filet pour les copies multipliées créées avant la copie de `description`.
 */
export function resolveMealDescriptionForDisplay(
  meal: Pick<Meal, "name" | "description"> | null | undefined,
  catalogMeals?: readonly Meal[] | null,
): string | null {
  const own = meal?.description?.trim();
  if (own) return meal?.description ?? own;
  if (!meal?.name?.trim() || !catalogMeals?.length) return null;
  const target = meal.name.trim().toLowerCase();
  const master = catalogMeals.find(
    (m) =>
      m.is_available &&
      m.name.trim().toLowerCase() === target &&
      !!m.description?.trim(),
  );
  return master?.description?.trim() ? master.description : null;
}
