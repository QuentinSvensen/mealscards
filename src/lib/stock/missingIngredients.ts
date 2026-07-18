import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  normalizeForMatch, normalizeKey, strictNameMatch, parseIngredientGroups,
} from "@/lib/ingredientUtils";

import { findStockKey, type StockInfo } from "./stockMap";

/** Retourne l'ensemble des noms d'ingrédients manquants en stock pour un repas */
export function getMissingIngredients(meal: Meal, stockMap: Map<string, StockInfo>): Set<string> {
  const missing = new Set<string>();
  if (!meal.ingredients?.trim()) return missing;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    let groupSatisfied = false;
    for (const alt of group) {
      let bundleSatisfied = true;
      for (const item of alt) {
        const key = findStockKey(stockMap, item.name);
        if (!key) { bundleSatisfied = false; break; }
        const stock = stockMap.get(key)!;
        if (!stock.infinite && stock.grams <= 0 && stock.count <= 0) { bundleSatisfied = false; break; }
      }
      if (bundleSatisfied) { groupSatisfied = true; break; }
    }
    if (!groupSatisfied) {
      // Si aucune alternative n'est satisfaite, on marque le PREMIER ingrédient du premier bundle 
      // comme manquant (plus simple pour l'UI)
      if (group[0]?.[0]) missing.add(normalizeKey(group[0][0].name));
    }
  }
  return missing;
}

/** Vérifie si un aliment est utilisé dans au moins un des repas spécifiés */
export function isFoodUsedInMeals(fi: FoodItem, mealsToCheck: Meal[]): boolean {
  const fiKey = normalizeForMatch(fi.name);
  return mealsToCheck.some(meal => {
    if (!meal.ingredients) return false;
    return parseIngredientGroups(meal.ingredients).some(group => 
      group.some(alt => alt.some(item => strictNameMatch(fiKey, item.name)))
    );
  });
}

