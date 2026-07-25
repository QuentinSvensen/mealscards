import type { FoodItem } from "@/types/food";
import type { Meal } from "@/types/meals";
import {
  normalizeForMatch, normalizeKey, strictNameMatch, parseIngredientGroups,
  parseIngredientsToLines,
} from "@/lib/ingredientUtils";

import { findStockKey, pickBestAlternative, type StockInfo } from "./stockMap";

/**
 * Retourne les noms d'ingrédients manquants ou en stock insuffisant pour un repas.
 * Une branche OU ne compte comme disponible que si TOUTES ses parts ont assez
 * d'unités (#) et/ou de grammes (aligné sur pickBestAlternative / getMealMultiple).
 */
export function getMissingIngredients(meal: Meal, stockMap: Map<string, StockInfo>): Set<string> {
  const missing = new Set<string>();
  if (!meal.ingredients?.trim()) return missing;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    // Aucune alternative entièrement couverte par le stock → groupe manquant.
    if (pickBestAlternative(group, stockMap) === null) {
      // Si aucune alternative n'est satisfaite, on marque le PREMIER ingrédient du premier bundle
      // comme manquant (plus simple pour l'UI)
      if (group[0]?.[0]) missing.add(normalizeKey(group[0][0].name));
    }
  }
  return missing;
}

/**
 * Lit le besoin recette (grammes / unités) et le libellé d'affichage pour une clé d'ingrédient.
 * Sert de base au calcul du manque (besoin − stock) dans « Aliments pour compléter ».
 */
export function getIngredientNeedFromRecipe(
  ingredients: string | null | undefined,
  ingredientKey: string,
): { qty: number; count: number; displayName: string } {
  for (const line of parseIngredientsToLines(ingredients ?? null)) {
    if (normalizeKey(line.name) !== ingredientKey) continue;
    const qty = parseFloat(line.qty.replace(",", "."));
    const count = parseFloat(line.count.replace(",", "."));
    return {
      qty: Number.isFinite(qty) ? qty : 0,
      count: Number.isFinite(count) ? count : 0,
      displayName: line.name || ingredientKey,
    };
  }
  return { qty: 0, count: 0, displayName: ingredientKey };
}

/**
 * Calcule la quantité encore manquante pour un ingrédient : max(0, besoin − stock).
 * Affiche le complément à acheter (ex. besoin 3, stock 2 → ×1), pas le besoin total de la recette.
 */
export function getMissingQuantityForIngredient(
  ingredients: string | null | undefined,
  ingredientKey: string,
  stockMap: Map<string, StockInfo>,
): { qty: number; count: number; displayName: string } {
  const need = getIngredientNeedFromRecipe(ingredients, ingredientKey);
  const stockKey = findStockKey(stockMap, need.displayName) ?? findStockKey(stockMap, ingredientKey);
  const stock = stockKey ? stockMap.get(stockKey) : undefined;

  if (stock?.infinite) {
    return { qty: 0, count: 0, displayName: need.displayName };
  }

  const stockGrams = stock?.grams ?? 0;
  const stockCount = stock?.count ?? 0;

  return {
    qty: need.qty > 0 ? Math.max(0, need.qty - stockGrams) : 0,
    count: need.count > 0 ? Math.max(0, need.count - stockCount) : 0,
    displayName: need.displayName,
  };
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
