import { parseMacroDisplay } from "@/lib/stockUtils";
import type { FoodType } from "@/types/food";
import { parseQty } from "@/lib/ingredientUtils";
import {
  hasIngredientMacrosPer100gBasis,
  normalizeUnitMacrosToPer100g,
  type IngredientMacroScoreOptions,
} from "@/lib/nutritionScore";

/** Options de résolution des macros pour l'indice de satiété (même base que la note Macro). */
export type IngredientSatietyOptions = IngredientMacroScoreOptions;

/**
 * Portion iso-énergétique de référence dans l'étude Holt et al. 1995 (1 000 kJ ≈ 240 kcal).
 * L'indice compare la satiété **pour la même énergie**, pas pour 100 g.
 */
export const HOLT_ISO_CALORIE_PORTION_KCAL = 240;

/** Grammes de pain blanc (~265 kcal/100 g) pour absorber 240 kcal — ancre Holt = 100. */
const HOLT_WHITE_BREAD_GRAMS_PER_PORTION = (HOLT_ISO_CALORIE_PORTION_KCAL / 265) * 100;

/**
 * Calcule le poids en grammes d'une portion de 240 kcal à partir des kcal pour 100 g.
 * Ex. pomme de terre 82 kcal/100 g → ~293 g ; pâtes 131 kcal/100 g → ~183 g.
 */
export function computeHoltPortionGrams(caloriesPer100g: number): number {
  if (!(caloriesPer100g > 0)) return 0;
  return (HOLT_ISO_CALORIE_PORTION_KCAL / caloriesPer100g) * 100;
}

/**
 * Dérive les macros d'une portion Holt (240 kcal) à partir des valeurs pour 100 g.
 */
export function computeHoltPortionMacros(
  caloriesPer100g: number,
  proteinPer100g: number,
  fiberPer100g: number,
): { grams: number; protein: number; fiber: number } {
  const grams = computeHoltPortionGrams(caloriesPer100g);
  const factor = grams / 100;
  return {
    grams,
    protein: proteinPer100g * factor,
    fiber: fiberPer100g * factor,
  };
}

/**
 * Estime l'indice Holt (pain blanc = 100) pour une portion de 240 kcal.
 * Calibré sur les ancres de l'étude : pomme de terre bouillie ~323, pain ~100, pâtes ~119, poisson ~225.
 * Le poids de la portion (corr. r≈0,66 chez Holt) est le levier principal.
 */
export function estimateHoltSatietyIndex(
  caloriesPer100g: number,
  proteinPer100g: number,
  fiberPer100g: number,
  foodType: FoodType = null,
): number {
  const { grams, protein, fiber } = computeHoltPortionMacros(
    caloriesPer100g,
    proteinPer100g,
    fiberPer100g,
  );

  const gramsAboveBread = grams - HOLT_WHITE_BREAD_GRAMS_PER_PORTION;

  // Féculents peu denses (type pomme de terre) : fort lien portion 240 kcal ↔ satiété
  if (foodType === "feculent" && caloriesPer100g < 130) {
    const raw = 68 + 0.75 * grams + 3.6 * fiber;
    return Math.round(Math.max(80, Math.min(350, raw)));
  }

  // Féculents plus caloriques (pâtes, riz cuit…) : malus « amidon raffiné » calibré sur pâtes blanches ~119
  if (foodType === "feculent") {
    const volumePart = 68 + 0.75 * grams + 3.6 * fiber;
    const refinedFactor = 0.52;
    const raw = volumePart * refinedFactor;
    return Math.round(Math.max(70, Math.min(220, raw)));
  }

  // Viandes / protéines : portion 240 kcal + boost protéines (poisson ling ~225)
  if (foodType === "viande") {
    const raw =
      88 +
      0.35 * Math.max(0, gramsAboveBread) +
      2.5 * protein +
      1.2 * fiber -
      0.12 * Math.max(0, caloriesPer100g - 180);
    return Math.round(Math.max(70, Math.min(280, raw)));
  }

  // Sans type : modèle générique Holt (log du ratio de portion vs pain)
  const potatoGrams = computeHoltPortionGrams(77);
  const logRatio =
    Math.log(grams / HOLT_WHITE_BREAD_GRAMS_PER_PORTION) /
    Math.log(potatoGrams / HOLT_WHITE_BREAD_GRAMS_PER_PORTION);
  const logFactor = Math.max(0, Math.min(1.12, logRatio));

  let raw = 100 + logFactor * 223 + 1.5 * (protein - 8) + 2.2 * (fiber - 2.27);

  if (caloriesPer100g > 200 && grams < 200) {
    raw -= (caloriesPer100g - 200) * 0.12;
  }
  if (caloriesPer100g >= 120 && caloriesPer100g <= 180) {
    raw *= 0.58;
  }

  return Math.round(Math.max(45, Math.min(350, raw)));
}

/**
 * Résout les macros numériques au 100 g pour le calcul de satiété (identique à la note Macro).
 */
export function resolveIngredientMacrosForSatiety(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  options?: IngredientSatietyOptions,
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
 * Estime l'indice de satiété Holt d'un ingrédient Macro (pain blanc = 100 pour 240 kcal).
 * Basé sur une portion iso-calorique de 240 kcal, pas sur 100 g.
 */
export function getIngredientSatietyIndex(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  options?: IngredientSatietyOptions,
): number | null {
  const macros = resolveIngredientMacrosForSatiety(calories, protein, fiber, options);
  if (macros.calories == null || macros.calories <= 0) return null;
  if (macros.protein == null || macros.fiber == null) return null;

  if (options?.basisLabel === "Quantité" && !hasIngredientMacrosPer100gBasis(options)) {
    return null;
  }

  return estimateHoltSatietyIndex(
    macros.calories,
    macros.protein,
    macros.fiber,
    options?.foodType ?? null,
  );
}

/**
 * Texte du tooltip pour l'indice de satiété affiché dans Macro.
 */
export function formatSatietyIndexTooltip(
  index: number,
  caloriesPer100g?: number | null,
): string {
  const grams =
    caloriesPer100g != null && caloriesPer100g > 0
      ? Math.round(computeHoltPortionGrams(caloriesPer100g))
      : null;
  const portionHint =
    grams != null
      ? ` Pour 240 kcal (méthode Holt) ≈ ${grams} g.`
      : "";
  return `Indice de satiété Holt estimé : ${index} (pain blanc = 100 pour 240 kcal).${portionHint} Valeurs de l'étude pour aliments non listés : approximation.`;
}

/**
 * Déduit la base Macro (100 g ou Quantité) depuis le formulaire Aliments (quantité + grammes/unité).
 */
export function resolveFoodItemSatietyOptions(
  quantity: string | null | undefined,
  grams: string | null | undefined,
  foodType: FoodType = null,
): IngredientSatietyOptions {
  const qty = quantity?.trim() ? parseInt(quantity.trim(), 10) : NaN;
  const unitGrams = parseQty(grams);
  if (Number.isFinite(qty) && qty > 0 && unitGrams > 0) {
    return { basisLabel: "Quantité", unitGrams, foodType };
  }
  return { basisLabel: "100g", foodType };
}

/**
 * Options satiété pour une fiche Aliment déjà enregistrée (même logique que le référentiel Macro).
 */
export function resolveFoodItemRecordSatietyOptions(item: {
  quantity?: number | null;
  grams?: string | null;
  food_type?: FoodType;
}): IngredientSatietyOptions {
  const unitGrams = parseQty(item.grams);
  if (item.quantity != null && item.quantity > 0 && unitGrams > 0) {
    return {
      basisLabel: "Quantité",
      unitGrams,
      foodType: item.food_type ?? null,
    };
  }
  return { basisLabel: "100g", foodType: item.food_type ?? null };
}
