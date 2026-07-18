import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  normalizeKey, parseIngredientGroups, parseQty, computeCounterDays,
} from "@/lib/ingredientUtils";
import { parseISO } from "date-fns";

import type { FoodItemIndex } from "./foodItemIndex";
import { lookupFoodItems } from "./foodItemIndex";
import { buildStockMap, pickBestAlternative } from "./stockMap";
import {
  isFoodItemCounterEligible,
  hasActiveFoodItemCounter,
} from "./foodItemState";

export interface MealAnalysis {
  /** Date de péremption la plus proche parmi les ingrédients */
  earliestExpiration: string | null;
  /** Nom de l'ingrédient ayant la péremption la plus proche */
  expiringIngredientName: string | null;
  /** Noms des ingrédients déjà périmés */
  expiredIngredientNames: Set<string>;
  /** Noms des ingrédients périssant sous 7 jours */
  expiringSoonIngredientNames: Set<string>;
  /** Nombre max de jours d'ouverture parmi les ingrédients */
  maxIngredientCounter: number | null;
  /** Nom de l'ingrédient avec le compteur le plus élevé */
  maxCounterName: string | null;
  /** Date de début du compteur le plus ancien */
  earliestCounterDate: string | null;
  /** Date de compteur la plus ancienne déjà démarrée (≤ maintenant), pour l’affichage badge */
  earliestActiveCounterDate: string | null;
  /** Noms des ingrédients ayant un compteur actif */
  counterIngredientNames: Set<string>;
  /** Vrai si au moins un ingrédient peut avoir un compteur (stock fini, non surgelé, non no_counter) */
  hasCounterableIngredient: boolean;
}
export function analyzeMealIngredients(
  meal: Meal,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  skipIds?: Set<string>
): MealAnalysis {
  const result: MealAnalysis = {
    earliestExpiration: null,
    expiringIngredientName: null,
    expiredIngredientNames: new Set(),
    expiringSoonIngredientNames: new Set(),
    maxIngredientCounter: null,
    maxCounterName: null,
    earliestCounterDate: null,
    earliestActiveCounterDate: null,
    counterIngredientNames: new Set(),
    hasCounterableIngredient: false,
  };

  if (!meal.ingredients?.trim()) return result;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const soonDate = new Date(today);
  soonDate.setDate(soonDate.getDate() + 7);
  const soonMs = soonDate.getTime();

  const groups = parseIngredientGroups(meal.ingredients);
  const stockMap = buildStockMap(foodItems);
  let earliestSoonDate: string | null = null;
  let earliestSoonName: string | null = null;

  for (const group of groups) {
    const bestAlt = pickBestAlternative(group, stockMap);
    for (const alt of group) {
      const includeCounter = !bestAlt || alt === bestAlt;
      for (const item of alt) {
        for (const fi of lookupFoodItems(item.name, foodItems, index)) {
          if (skipIds?.has(fi.id)) continue;

          // --- Analyse de péremption ---
          if (fi.expiration_date) {
            if (!result.earliestExpiration || fi.expiration_date < result.earliestExpiration) {
              result.earliestExpiration = fi.expiration_date;
              result.expiringIngredientName = item.name;
            }
            const parts = fi.expiration_date.split('-');
            const expMs = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
            if (expMs <= todayMs) {
              result.expiredIngredientNames.add(normalizeKey(item.name));
            } else if (expMs <= soonMs) {
              if (!earliestSoonDate || fi.expiration_date < earliestSoonDate) {
                earliestSoonDate = fi.expiration_date;
                earliestSoonName = normalizeKey(item.name);
              }
            }
          }

          if (!includeCounter) continue;

          // --- Analyse du compteur d'ouverture (compteur actif, y compris manuel) ---
          if (hasActiveFoodItemCounter(fi)) {
            const csdMs = parseISO(fi.counter_start_date!).getTime();
            if (!result.earliestActiveCounterDate || fi.counter_start_date! < result.earliestActiveCounterDate) {
              result.earliestActiveCounterDate = fi.counter_start_date!;
            }
            const days = computeCounterDays(fi.counter_start_date);
            if (days !== null) {
              if (result.maxIngredientCounter === null || days > result.maxIngredientCounter) {
                result.maxIngredientCounter = days;
                result.maxCounterName = fi.name;
              }
              result.counterIngredientNames.add(normalizeKey(item.name));
            }
            if (!result.earliestCounterDate || fi.counter_start_date! < result.earliestCounterDate) {
              result.earliestCounterDate = fi.counter_start_date!;
            }
          }

          // --- Vérifier si l'aliment peut avoir un compteur automatique ---
          if (isFoodItemCounterEligible(fi)) {
            result.hasCounterableIngredient = true;
          }
        }
      }
    }
  }

  if (earliestSoonName) result.expiringSoonIngredientNames.add(earliestSoonName);
  return result;
}
export function counterableIngredientKeysFromRecipe(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
): Set<string> {
  const keys = new Set<string>();
  if (!ingredients?.trim()) return keys;
  const groups = parseIngredientGroups(ingredients);
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const bundle = group[0];
    if (!bundle) continue;
    for (const item of bundle) {
      if (item.optional || !item.name) continue;
      const counterCapableMatches = lookupFoodItems(item.name, foodItems, index).filter(
        isFoodItemCounterEligible,
      );
      if (counterCapableMatches.length > 0) {
        keys.add(normalizeKey(item.name));
      }
    }
  }
  return keys;
}

/**
 * Indique si la recette comporte au moins un ingrédient lié à du stock fini pouvant porter un compteur.
 */
export function recipeHasFiniteCounterableIngredients(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
): boolean {
  return counterableIngredientKeysFromRecipe(ingredients, foodItems, index).size > 0;
}

