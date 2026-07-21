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
 * Calcule la note nutritionnelle v7 brute (non plafonnée) à partir des macros.
 * Densité protéique non bornée à 1 ; bonus fibres inchangé (max +15) ; pas de plafond final à 100.
 * Sert au tri Macro pour départager les items qui affichent tous 100.
 */
export function computeNutritionScoreV7Raw(
  calories: number | null | undefined,
  protein: number | null | undefined,
  fiber: number | null | undefined,
): number | null {
  if (calories == null || calories <= 0 || protein == null) return null;

  const proteinDensity = (protein / calories) * 1000;
  const fiberValue = fiber ?? 0;
  const densityScore = proteinDensity / 100;
  const fiberBonus = Math.min(15, (fiberValue / calories) * 1000);

  return Math.round(densityScore * 100 + fiberBonus);
}

/**
 * Calcule la note nutritionnelle v7 (0-100) à partir des macros affichées.
 * Compare la densité protéique à 100 g/1000 kcal et ajoute un bonus fibres (max +15).
 */
export function computeNutritionScoreV7(
  calories: number | null | undefined,
  protein: number | null | undefined,
  fiber: number | null | undefined,
): number | null {
  const raw = computeNutritionScoreV7Raw(calories, protein, fiber);
  if (raw == null) return null;
  return Math.min(100, raw);
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

/** Options pour la note d'un ingrédient Macro (base Quantité + poids pour la note seulement). */
export type IngredientMacroScoreOptions = {
  /** Base affichée (« Quantité » / « 100g ») — la normalisation ne s'applique qu'à Quantité. */
  basisLabel?: string | null;
  /**
   * Poids d'une unité en grammes, utilisé **uniquement** pour ramener les macros au 100 g
   * dans le calcul de note. N'impacte ni recettes ni stock.
   */
  unitGrams?: number | null;
};

/**
 * Convertit des macros exprimées par unité en équivalent pour 100 g (calcul de note uniquement).
 * Formule : valeur_100g = valeur_unité / grammes_unité × 100.
 * Retourne null si le poids d'unité est invalide (≤ 0 ou manquant).
 */
export function normalizeUnitMacrosToPer100g(
  calories: number | null | undefined,
  protein: number | null | undefined,
  fiber: number | null | undefined,
  gramsPerUnit: number | null | undefined,
): { calories: number | null; protein: number | null; fiber: number | null } | null {
  if (gramsPerUnit == null || !(gramsPerUnit > 0)) return null;
  const factor = 100 / gramsPerUnit;
  return {
    calories: calories == null ? null : calories * factor,
    protein: protein == null ? null : protein * factor,
    fiber: fiber == null ? null : fiber * factor,
  };
}

/**
 * Résout les macros numériques à utiliser pour la note : si base Quantité et grammes/unité connus,
 * renvoie l'équivalent pour 100 g ; sinon les macros brutes (par unité ou déjà au 100 g).
 */
export function resolveIngredientMacrosForNutritionScore(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  options?: IngredientMacroScoreOptions,
): { calories: number | null; protein: number | null; fiber: number | null } {
  const cal = parseMacroDisplay(calories);
  const pro = parseMacroDisplay(protein);
  const fib = parseMacroDisplay(fiber);

  if (options?.basisLabel === "Quantité") {
    const normalized = normalizeUnitMacrosToPer100g(cal, pro, fib, options.unitGrams);
    if (normalized) return normalized;
  }

  return { calories: cal, protein: pro, fiber: fib };
}

/**
 * Retourne la note nutritionnelle v7 d'un ingrédient à partir de ses macros (kcal / prot. / fib.).
 * Même formule que les recettes ; utile dans l'onglet Macro pour afficher la pastille numérique.
 * En base Quantité avec grammes/unité, calcule sur macros ramenées au 100 g.
 */
export function getIngredientMacroNutritionScore(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  options?: IngredientMacroScoreOptions,
): number | null {
  const macros = resolveIngredientMacrosForNutritionScore(calories, protein, fiber, options);
  return computeNutritionScoreV7(macros.calories, macros.protein, macros.fiber);
}

/**
 * Retourne la note v7 brute (non plafonnée) d'un ingrédient pour le tri Macro.
 * L'affichage badge reste via getIngredientMacroNutritionScore (0–100).
 * En base Quantité avec grammes/unité, calcule sur macros ramenées au 100 g.
 */
export function getIngredientMacroNutritionScoreRaw(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  options?: IngredientMacroScoreOptions,
): number | null {
  const macros = resolveIngredientMacrosForNutritionScore(calories, protein, fiber, options);
  return computeNutritionScoreV7Raw(macros.calories, macros.protein, macros.fiber);
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
