import type { FoodItem } from "@/hooks/useFoodItems";
import { normalizeKey, strictNameMatch } from "@/lib/ingredientUtils";

export type FoodItemIndex = Map<string, FoodItem[]>;

/** Construit un index par nom normalisé pour un accès O(1) aux aliments */
export function buildFoodItemIndex(foodItems: FoodItem[]): FoodItemIndex {
  const index = new Map<string, FoodItem[]>();
  for (const fi of foodItems) {
    if (fi.storage_type === "extras") continue;
    const key = normalizeKey(fi.name);
    const arr = index.get(key);
    if (arr) arr.push(fi);
    else index.set(key, [fi]);
  }
  return index;
}

/**
 * Recherche d'aliments par nom normalisé : d'abord exact O(1), puis fuzzy en fallback.
 * Utilisé en interne par analyzeMealIngredients.
 */
export function lookupFoodItems(name: string, foodItems: FoodItem[], index?: FoodItemIndex): FoodItem[] {
  if (index) {
    const exact = index.get(normalizeKey(name));
    if (exact && exact.length > 0) return exact;
    // Fallback fuzzy pour tolérer les typos
    const results: FoodItem[] = [];
    for (const [, items] of index) {
      if (items.length > 0 && strictNameMatch(items[0].name, name)) {
        results.push(...items);
      }
    }
    return results;
  }
  return foodItems.filter(fi => fi.storage_type !== "extras" && strictNameMatch(fi.name, name));
}
