import type { Meal } from "@/hooks/useMeals";
import { normalizeKey, parseIngredientGroups } from "@/lib/ingredientUtils";


export type IngredientMealIndex = Map<string, Set<string>>;

/** Construit un index inversé : clé_ingrédient_normalisée → ensemble des IDs de repas l'utilisant */
export function buildIngredientMealIndex(meals: Meal[]): IngredientMealIndex {
  const idx = new Map<string, Set<string>>();
  for (const meal of meals) {
    if (!meal.ingredients?.trim()) continue;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        for (const item of alt) {
          const key = normalizeKey(item.name);
          let set = idx.get(key);
          if (!set) { set = new Set(); idx.set(key, set); }
          set.add(meal.id);
        }
      }
    }
  }
  return idx;
}

