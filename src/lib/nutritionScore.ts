import {
  getDisplayedCalories,
  getDisplayedFiber,
  getDisplayedPMCalories,
  getDisplayedPMFiber,
  getDisplayedPMProtein,
  getDisplayedProtein,
  parseMacroDisplay,
} from "@/lib/stockUtils";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import type { FoodItem } from "@/hooks/useFoodItems";

const SCORE_CATEGORIES = new Set(["plat", "petit_dejeuner"]);

type MealMacrosSource = {
  category?: string | null;
  calories?: string | null;
  protein?: string | null;
  fiber?: string | null;
  ingredients?: string | null;
};

/**
 * Calcule la note nutritionnelle v7 (0-100) à partir des macros affichées.
 * Compare la densité protéique à 100 g/1000 kcal et ajoute un bonus fibres (max +15).
 */
export function computeNutritionScoreV7(
  calories: number | null | undefined,
  protein: number | null | undefined,
  fiber: number | null | undefined,
): number | null {
  if (calories == null || calories <= 0 || protein == null) return null;

  const proteinDensity = (protein / calories) * 1000;
  const fiberValue = fiber ?? 0;
  const densityScore = Math.min(1, proteinDensity / 100);
  const fiberBonus = Math.min(15, (fiberValue / calories) * 1000);

  return Math.min(100, Math.round(densityScore * 100 + fiberBonus));
}

/**
 * Retourne la note v7 d'un repas catalogue (Tous / Au choix) pour Plat et Petit déj uniquement.
 */
export function getMealNutritionScore(
  meal: MealMacrosSource,
  isAvailable?: (name: string) => boolean,
): number | null {
  if (!meal.category || !SCORE_CATEGORIES.has(meal.category)) return null;

  const hasIngredients = Boolean(meal.ingredients?.trim());
  const calories = hasIngredients
    ? getDisplayedCalories(meal, undefined, undefined, isAvailable)
    : parseMacroDisplay(meal.calories);
  const protein = hasIngredients
    ? getDisplayedProtein(meal, undefined, undefined, isAvailable)
    : parseMacroDisplay(meal.protein);
  const fiber = hasIngredients
    ? getDisplayedFiber(meal, undefined, undefined, isAvailable)
    : parseMacroDisplay(meal.fiber);

  return computeNutritionScoreV7(calories, protein, fiber);
}

/**
 * Retourne la note v7 d'une carte Possible (override + ratio) pour Plat et Petit déj uniquement.
 */
export function getPossibleMealNutritionScore(
  pm: {
    ingredients_override?: string | null;
    meals?: MealMacrosSource | null;
  },
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  const meal = pm.meals;
  if (!meal?.category || !SCORE_CATEGORIES.has(meal.category)) return null;

  const calories = getDisplayedPMCalories(pm, ratio, isAvailable);
  const protein = getDisplayedPMProtein(pm, ratio, isAvailable, foodItems, foodItemIndex);
  const fiber = getDisplayedPMFiber(pm, ratio, isAvailable, foodItems, foodItemIndex);

  return computeNutritionScoreV7(calories, protein, fiber);
}
