import type { FoodItem } from "@/hooks/useFoodItems";
import {
  computeIngredientCalories, computeIngredientProtein, computeIngredientFiber,
  type FoodItemMacroIndex,
} from "@/lib/ingredientUtils";


/** Parse une valeur brute de calories/protéines (ex: "350 kcal" → 350) */
export function parseMacroDisplay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calcule les calories affichées pour un repas.
 * 
 * Logique de priorité :
 * 1. Si les ingrédients ont des macros → les utiliser (computeIngredientCalories)
 * 2. Sinon → utiliser la valeur de base du repas (meal.calories)
 * 3. Mode additif : si le repas de base n'a PAS d'ingrédients mais A des macros,
 *    et qu'on a un override d'ingrédients → additionner les deux
 */
export function getDisplayedCalories(
  meal: { calories?: string | null; ingredients?: string | null },
  ingredientsOverride?: string | null,
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  const baseCal = parseMacroDisplay(meal.calories);
  const scaledBaseCal = (baseCal !== null && ratio) ? baseCal * ratio : baseCal;

  const ingredients = ingredientsOverride ?? meal.ingredients;
  // Si on a un override, on considère qu'il est déjà à l'échelle (ratio 1) 
  // pour éviter de multiplier deux fois (ex: x2 * x2 = x4).
  const r = ingredientsOverride ? 1 : (ratio ?? 1);
  const ingCal = computeIngredientCalories(ingredients ?? null, isAvailable, r, foodItems, foodItemIndex);

  // Mode additif : override d'ingrédients + repas de base sans ingrédients mais avec macros
  if (ingredientsOverride && !meal.ingredients && baseCal !== null) {
    return (scaledBaseCal || 0) + (ingCal || 0);
  }

  if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;
  return scaledBaseCal;
}

/** Calcule les protéines affichées pour un repas (même logique que getDisplayedCalories) */
export function getDisplayedProtein(
  meal: { protein?: string | null; calories?: string | null; ingredients?: string | null },
  ingredientsOverride?: string | null,
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  const basePro = parseMacroDisplay(meal.protein);
  const scaledBasePro = (basePro !== null && ratio) ? basePro * ratio : basePro;

  const ingredients = ingredientsOverride ?? meal.ingredients;
  // Si on a un override, on considère qu'il est déjà à l'échelle (ratio 1) 
  // pour éviter de multiplier deux fois (ex: x2 * x2 = x4).
  const r = ingredientsOverride ? 1 : (ratio ?? 1);
  const ingPro = computeIngredientProtein(ingredients ?? null, isAvailable, r, foodItems, foodItemIndex);
  const ingCal = computeIngredientCalories(ingredients ?? null, isAvailable, r);

  if (ingredientsOverride && !meal.ingredients && basePro !== null) {
    const total = (scaledBasePro || 0) + (ingPro || 0);
    return Math.round(total);
  }

  if (ingPro !== null && Number.isFinite(ingPro)) return Math.round(ingPro);

  // Les lignes d’ingrédients ont souvent les kcal par ligne mais pas les protéines : dans ce cas,
  // estimer les prot affichées au prorata des kcal (carte repas vs somme ingrédients), comme le fallback du popup PossibleList.
  const baseCal = parseMacroDisplay(meal.calories);
  if (
    ingCal !== null &&
    ingCal > 0 &&
    baseCal !== null &&
    baseCal > 0 &&
    basePro !== null
  ) {
    return Math.round(basePro * (ingCal / baseCal));
  }

  return scaledBasePro !== null ? Math.round(scaledBasePro) : null;
}

/** Calcule les fibres affichées pour un repas (même logique que getDisplayedProtein, sans prorata protéines). */
export function getDisplayedFiber(
  meal: { fiber?: string | null; ingredients?: string | null },
  ingredientsOverride?: string | null,
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  const baseFiber = parseMacroDisplay(meal.fiber);
  const scaledBaseFiber = (baseFiber !== null && ratio) ? baseFiber * ratio : baseFiber;

  const ingredients = ingredientsOverride ?? meal.ingredients;
  const r = ingredientsOverride ? 1 : (ratio ?? 1);
  let ingFiber = computeIngredientFiber(ingredients ?? null, isAvailable, r, foodItems, foodItemIndex);

  // Override post-déduction sans marqueurs <fibres> : retomber sur la recette maître
  // (évite la disparition du badge ~1s après l’arrivée en Possible).
  if (
    (ingFiber === null || !Number.isFinite(ingFiber)) &&
    ingredientsOverride &&
    meal.ingredients?.trim()
  ) {
    ingFiber = computeIngredientFiber(meal.ingredients, isAvailable, ratio ?? 1, foodItems, foodItemIndex);
  }

  if (ingredientsOverride && !meal.ingredients && baseFiber !== null) {
    const total = (scaledBaseFiber || 0) + (ingFiber || 0);
    return Math.round(total);
  }

  if (ingFiber !== null && Number.isFinite(ingFiber)) return Math.round(ingFiber);
  return scaledBaseFiber !== null ? Math.round(scaledBaseFiber) : null;
}

/** Calories affichées pour une instance PossibleMeal (utilise ingredients_override si présent) */
export function getDisplayedPMCalories(pm: { ingredients_override?: string | null; meals?: { calories?: string | null; ingredients?: string | null } | null }, ratio?: number, isAvailable?: (name: string) => boolean): number | null {
  return getDisplayedCalories(pm.meals || {}, pm.ingredients_override, ratio, isAvailable);
}

/** Protéines affichées pour une instance PossibleMeal (utilise ingredients_override si présent) */
export function getDisplayedPMProtein(
  pm: { ingredients_override?: string | null; meals?: { protein?: string | null; calories?: string | null; ingredients?: string | null } | null },
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  return getDisplayedProtein(pm.meals || {}, pm.ingredients_override, ratio, isAvailable, foodItems, foodItemIndex);
}

/** Fibres affichées pour une instance PossibleMeal (utilise ingredients_override si présent). */
export function getDisplayedPMFiber(
  pm: { ingredients_override?: string | null; meals?: { fiber?: string | null; ingredients?: string | null } | null },
  ratio?: number,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  return getDisplayedFiber(pm.meals || {}, pm.ingredients_override, ratio, isAvailable, foodItems, foodItemIndex);
}

