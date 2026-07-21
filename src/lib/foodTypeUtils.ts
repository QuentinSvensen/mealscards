import type { FoodItem, FoodType } from "@/types/food";
import { normalizeKey } from "@/lib/ingredientUtils";

/** Entrée minimale de bibliothèque pour résoudre un type d'aliment. */
export type FoodTypeLibraryLookup = {
  name: string;
  food_type: FoodType;
};

/**
 * Fait cycler le type d'aliment : aucun → féculent → viande → aucun.
 * Sert aux boutons de bascule Macro / Aliments.
 */
export function cycleFoodType(current: FoodType): FoodType {
  if (current === null) return "feculent";
  if (current === "feculent") return "viande";
  return null;
}

/**
 * Liste les fiches Aliments dont le nom normalisé correspond à la clé Macro.
 */
export function listFoodItemsMatchingIngredientKey(
  key: string,
  foodItems: Pick<FoodItem, "id" | "name" | "food_type">[],
): Pick<FoodItem, "id" | "name" | "food_type">[] {
  if (!key) return [];
  return foodItems.filter((item) => normalizeKey(item.name || "") === key);
}

/**
 * Résout le type affiché pour une ligne Macro :
 * stock Aliments (match) → bibliothèque (mémoire création) → aucun.
 */
export function resolveIngredientFoodType(
  key: string,
  foodItems: Pick<FoodItem, "name" | "food_type">[],
  library: FoodTypeLibraryLookup[] = [],
): FoodType {
  if (!key) return null;

  const matching = foodItems.filter((item) => normalizeKey(item.name || "") === key);
  if (matching.length > 0) {
    const nonNull = matching.find((item) => item.food_type != null)?.food_type;
    return nonNull ?? null;
  }

  const libraryEntry = library.find((entry) => normalizeKey(entry.name || "") === key);
  return libraryEntry?.food_type ?? null;
}

/**
 * Cherche le type mémorisé pour un nom saisi dans le formulaire Aliments (match exact normalisé).
 */
export function lookupFoodTypeMemory(
  name: string,
  library: FoodTypeLibraryLookup[],
): FoodType | undefined {
  const key = normalizeKey(name.trim());
  if (!key) return undefined;
  const entry = library.find((item) => normalizeKey(item.name || "") === key);
  return entry ? entry.food_type : undefined;
}
