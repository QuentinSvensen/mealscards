import type { MealCategory } from "@/types/meals";

/**
 * Catégories « Au choix » où le filtre seuil max (calories restantes) est activé par défaut.
 * Petit déjeuner reste désactivé par défaut.
 */
export const AVAILABLE_SEUIL_MAX_DEFAULT_ON = [
  "entree",
  "plat",
  "dessert",
  "bonus",
] as const satisfies readonly MealCategory[];

const SEUIL_MAX_DEFAULT_ON_SET = new Set<string>(AVAILABLE_SEUIL_MAX_DEFAULT_ON);

/**
 * Indique si le filtre « Carte en fonction des calories restantes » (seuil max)
 * doit être activé par défaut pour cette catégorie Au choix.
 */
export function isAvailableSeuilMaxDefaultOn(category: string): boolean {
  return SEUIL_MAX_DEFAULT_ON_SET.has(category);
}

/**
 * Clé user_preferences du filtre seuil max pour une catégorie Au choix.
 */
export function availableSeuilMaxPrefKey(category: string): string {
  return `available_use_remaining_calories_${category}`;
}

/**
 * Clé user_preferences du filtre « 100 % » (recettes entièrement faisables en stock).
 */
export function availableFullRemainingPrefKey(category: string): string {
  return `available_full_remaining_recipes_${category}`;
}

/**
 * Indique si l’activation du seuil max doit aussi activer l’option « 100 % »
 * (uniquement Plat au choix).
 */
export function shouldAutoEnableFullRemainingWithSeuilMax(category: string): boolean {
  return category === "plat";
}
