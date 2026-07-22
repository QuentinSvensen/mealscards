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
import type { FoodType } from "@/types/food";

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
  /** Type viande / féculent : formule de note dédiée dans l'onglet Macro. */
  foodType?: FoodType;
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

/** Référence neutre de densité énergétique (kcal / 100 g) pour le bonus/malus ingrédient. */
const INGREDIENT_CALORIC_DENSITY_NEUTRAL_KCAL = 130;

/**
 * Bonus ou malus lié aux kcal pour 100 g (onglet Macro uniquement).
 * Favorise les aliments peu denses (légumes, pomme de terre) et pénalise les très caloriques (pain, viennoiserie).
 */
export function computeIngredientCaloricDensityAdjustment(
  caloriesPer100g: number | null | undefined,
): number {
  if (caloriesPer100g == null || !(caloriesPer100g > 0)) return 0;

  const delta = INGREDIENT_CALORIC_DENSITY_NEUTRAL_KCAL - caloriesPer100g;
  if (delta > 0) {
    return Math.min(15, Math.round(delta / 5));
  }
  return -Math.min(35, Math.round(-delta / 7));
}

/**
 * Indique si les macros résolues sont exprimées pour 100 g (base 100g ou Quantité + poids unitaire).
 */
export function hasIngredientMacrosPer100gBasis(
  options?: IngredientMacroScoreOptions,
): boolean {
  if (options?.basisLabel === "100g") return true;
  return (
    options?.basisLabel === "Quantité" &&
    options.unitGrams != null &&
    options.unitGrams > 0
  );
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

/** Références kcal / 100 g pour la partie « volume » (viande et féculent). */
const MACRO_VOLUME_LOW_KCAL_PER_100G = 80;
const MACRO_VOLUME_HIGH_KCAL_PER_100G = 320;

/** Référence protéines au 100 g pour le plafond de la partie « protéines absolues » viande. */
const VIANDE_HIGH_PROTEIN_PER_100G = 27;

/**
 * Calcule la partie « volume » : plus les kcal/100 g sont basses, plus on peut manger de grammes pour peu de calories.
 * Partagée par les formules viande et féculent (courbe continue, sans saut artificiel).
 */
export function computeMacroVolumePart(caloriesPer100g: number, maxPoints = 40): number {
  if (caloriesPer100g <= MACRO_VOLUME_LOW_KCAL_PER_100G) return maxPoints;
  if (caloriesPer100g >= MACRO_VOLUME_HIGH_KCAL_PER_100G) return 0;
  return Math.round(
    (maxPoints * (MACRO_VOLUME_HIGH_KCAL_PER_100G - caloriesPer100g)) /
      (MACRO_VOLUME_HIGH_KCAL_PER_100G - MACRO_VOLUME_LOW_KCAL_PER_100G),
  );
}

/** Poids max de la partie volume pour la formule viande (plus élevé que féculent). */
const VIANDE_VOLUME_MAX_POINTS = 50;

/**
 * Calcule la note brute Macro pour un ingrédient **viande** :
 * volume (kcal/100 g) + protéines absolues + densité protéique (prot/kcal).
 * Le volume permet de favoriser les aliments qu'on peut consommer en grande quantité (ex. jaune d'œuf léger vs poisson pané).
 */
export function computeViandeIngredientNutritionScoreRaw(
  calories: number,
  protein: number,
  caloriesPer100g: number | null,
): number {
  const hasPer100g = caloriesPer100g != null && caloriesPer100g > 0;

  const proteinDensity = (protein / calories) * 1000;
  const densityPart = Math.min(25, Math.round(proteinDensity * 0.25));

  const absolutePart = hasPer100g
    ? Math.min(30, Math.round((protein / VIANDE_HIGH_PROTEIN_PER_100G) * 30))
    : Math.min(15, Math.round(proteinDensity * 0.15));

  const volumePart = hasPer100g ? computeMacroVolumePart(caloriesPer100g, VIANDE_VOLUME_MAX_POINTS) : 0;

  return volumePart + absolutePart + densityPart;
}

/**
 * Alias féculent → {@link computeMacroVolumePart} (rétrocompat tests / exports).
 */
export function computeFeculentVolumePart(caloriesPer100g: number): number {
  return computeMacroVolumePart(caloriesPer100g);
}

/**
 * Calcule la note brute Macro pour un ingrédient **féculent** : fibres, faible densité énergétique (volume/kcal).
 * Favorise les aliments peu caloriques au 100 g, riches en fibres et « volumineux » par rapport aux macros.
 */
export function computeFeculentIngredientNutritionScoreRaw(
  calories: number,
  fiber: number | null | undefined,
  caloriesPer100g: number | null,
): number {
  const fiberValue = fiber ?? 0;
  const fiberDensity = (fiberValue / calories) * 1000;
  const fiberPart = Math.min(35, Math.round(fiberDensity * 2.2));

  const volumePart =
    caloriesPer100g != null && caloriesPer100g > 0
      ? computeMacroVolumePart(caloriesPer100g)
      : 0;

  return fiberPart + volumePart;
}

/**
 * Résout la note brute Macro ingrédient selon le type (viande, féculent, ou formule générique v7).
 */
export function computeIngredientMacroNutritionScoreRaw(
  calories: number | null,
  protein: number | null,
  fiber: number | null,
  options?: IngredientMacroScoreOptions,
): number | null {
  if (calories == null || calories <= 0) return null;

  const per100g = hasIngredientMacrosPer100gBasis(options) ? calories : null;
  const foodType = options?.foodType ?? null;

  if (foodType === "viande") {
    if (protein == null) return null;
    return computeViandeIngredientNutritionScoreRaw(calories, protein, per100g);
  }

  if (foodType === "feculent") {
    return computeFeculentIngredientNutritionScoreRaw(calories, fiber, per100g);
  }

  if (protein == null) return null;
  const base = computeNutritionScoreV7Raw(calories, protein, fiber);
  if (base == null) return null;
  if (!hasIngredientMacrosPer100gBasis(options)) return base;
  return base + computeIngredientCaloricDensityAdjustment(calories);
}

/**
 * Plafonne une note brute Macro ingrédient entre 0 et 100 pour l'affichage badge.
 */
export function clampIngredientMacroNutritionScore(score: number): number {
  return Math.min(100, Math.max(0, score));
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
  const raw = computeIngredientMacroNutritionScoreRaw(
    macros.calories,
    macros.protein,
    macros.fiber,
    options,
  );
  if (raw == null) return null;
  return clampIngredientMacroNutritionScore(raw);
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
  return computeIngredientMacroNutritionScoreRaw(
    macros.calories,
    macros.protein,
    macros.fiber,
    options,
  );
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
