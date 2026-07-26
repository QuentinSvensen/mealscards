import { parseMacroDisplay } from "@/lib/stockUtils";
import type { FoodType } from "@/types/food";
import {
  normalizeKey,
  parseIngredientsToLines,
  parseQty,
  strictNameMatch,
  type IngLine,
} from "@/lib/ingredientUtils";
import {
  findFoodItemForIngredientName,
  resolveIngredientLineMacros,
  type IngredientMacroAutofillSources,
} from "@/domain/macros/ingredientMacroDatabase";
import {
  hasIngredientMacrosPer100gBasis,
  normalizeUnitMacrosToPer100g,
  type IngredientMacroScoreOptions,
} from "@/lib/nutritionScore";

/** Options de résolution des macros pour l'indice de satiété (même base que la note Macro). */
export type IngredientSatietyOptions = IngredientMacroScoreOptions;

/**
 * Indice de satiété de base Meals Cards pour **100 g** d'aliment
 * (ou pour 1 unité une fois les macros ramenées au 100 g).
 *
 * Échelle déjà pensée **0–100** : un plat très rassasiant (viande / protéines,
 * peu dense en calories) doit pouvoir approcher 100 ; un snack calorique reste bas.
 *
 * Formule (macros pour 100 g) :
 *   raw = 12 + 3,8×protéines + 3,2×fibres
 *       + bonus_volume (faible densité kcal)
 *       − max(0, kcal − 210) × 0,15            // malus très calorique
 * Bonus volume : plein pour un profil « pomme de terre » (féculent, < 130 kcal,
 * protéines ≤ 3) ; très réduit si aliment dilué (peu de prot. + peu calorique),
 * sinon standard — évite de surestimer un ravioli conserve (~25, pas ~65).
 * Ajustements type :
 *   - viande : +18 + 1,4×protéines
 *   - féculent type pomme de terre : +22
 *   - féculent dense (≥ 200 kcal) : −12
 * Score final : entier dans [5, 100].
 *
 * En recette : contribution = indice_base × (grammes / 100), puis indice carte =
 * round(Σ contributions) — somme pondérée brute (volume déjà dans les grammes),
 * sans plafond à 100 pour l’instant.
 */
export function estimateMealsCardsSatietyIndex(
  caloriesPer100g: number,
  proteinPer100g: number,
  fiberPer100g: number,
  foodType: FoodType = null,
): number {
  const protein = Math.max(0, proteinPer100g);
  const fiber = Math.max(0, fiberPer100g);
  const calories = Math.max(0, caloriesPer100g);

  const volumeBonus = Math.min(38, Math.max(0, 190 - calories) * 0.32);
  // Féculent peu dense + peu protéiné ≈ pomme de terre (cale) ; sinon « dilué » (ravioli…).
  const isPotatoLike =
    foodType === "feculent" && calories < 130 && protein <= 3;
  const isDiluted = protein < 5 && calories < 160;

  let raw = 12 + 3.8 * protein + 3.2 * fiber;
  if (isPotatoLike) {
    raw += volumeBonus;
  } else if (isDiluted) {
    // Conserve / féculent humide : l’eau baisse les kcal sans caler vraiment.
    raw += volumeBonus * 0.05;
  } else {
    raw += volumeBonus;
  }
  raw -= Math.max(0, calories - 210) * 0.15;

  if (foodType === "viande") {
    raw += 18 + 1.4 * protein;
  }
  if (isPotatoLike) {
    raw += 22;
  }
  if (foodType === "feculent" && calories >= 200) {
    raw -= 12;
  }

  return Math.round(Math.max(5, Math.min(100, raw)));
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
 * Estime l'indice de satiété Meals Cards d'un ingrédient Macro (base pour 100 g).
 * En base « Quantité », les macros sont d'abord ramenées au 100 g via le poids/unité.
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

  return estimateMealsCardsSatietyIndex(
    macros.calories,
    macros.protein,
    macros.fiber,
    options?.foodType ?? null,
  );
}

/**
 * Texte court du tooltip pour l'indice de satiété (Macro / base 100 g).
 */
export function formatSatietyIndexTooltip(
  index: number,
  _caloriesPer100g?: number | null,
): string {
  return `Indice de satiété Meals Cards (pour 100 g) : ${index}`;
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
 * Options satiété pour une fiche Aliment déjà enregistrée.
 * Aligné sur Macro : stock en unités (`quantity` > 0) ⇒ base « Quantité »,
 * même sans grammes/unité (ceux-ci peuvent venir des prefs Macro).
 */
export function resolveFoodItemRecordSatietyOptions(item: {
  quantity?: number | null;
  grams?: string | null;
  food_type?: FoodType;
}): IngredientSatietyOptions {
  const unitGrams = parseQty(item.grams);
  if (item.quantity != null && item.quantity > 0) {
    return {
      basisLabel: "Quantité",
      ...(unitGrams > 0 ? { unitGrams } : {}),
      foodType: item.food_type ?? null,
    };
  }
  return { basisLabel: "100g", foodType: item.food_type ?? null };
}

/**
 * Calcule le facteur de portion pour ramener l'indice à la quantité utilisée dans la recette.
 *
 * L'indice est toujours calibré pour **100 g** (y compris après normalisation Quantité).
 * Formule :
 * - grammes Q → Q / 100
 * - N unités + poids/unité U → (N × U) / 100
 * - N unités sans U (base Quantité ou 100 g) → null (évite count seul qui gonfle hors dénominateur)
 * - ni grammes ni unités → 1 (portion de référence entière)
 * Retourne null si le facteur ne peut pas être déterminé de façon fiable.
 */
export function computeSatietyPortionFactor(
  qtyGrams: number,
  count: number,
  options?: IngredientSatietyOptions,
): number | null {
  if (qtyGrams > 0) return qtyGrams / 100;

  if (count > 0) {
    // Toujours convertir via grammes/unité : l'indice Quantité est déjà au 100 g.
    // (Ancien bug : factor = count → densite ≈ indice × 100/U, ex. tranche 40 g → ×2,5.)
    if (options?.unitGrams != null && options.unitGrams > 0) {
      return (count * options.unitGrams) / 100;
    }
    return null;
  }

  return 1;
}

/**
 * Plafonne l'indice satiété d'une carte repas dans [0, 100].
 */
export function clampMealSatietyIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(100, Math.max(0, Math.round(index)));
}

/**
 * Contribution d'un aliment à la satiété totale d'une recette :
 * contribution = indice × facteur_de_portion.
 * Ex. indice 300 pour 100 g et 10 g dans la recette → 300 × 0,1 = 30.
 */
export function computeIngredientSatietyContribution(
  index: number,
  portionFactor: number,
): number {
  return index * portionFactor;
}

/**
 * Regroupe les lignes d'ingrédients en groupes d'alternatives (ignore les optionnels).
 * Structure : groupes → alternatives « | » → items d'un bundle « + ».
 */
function groupIngredientLinesForSatiety(lines: IngLine[]): IngLine[][][] {
  const groups: IngLine[][][] = [];
  let currentGroup: IngLine[][] = [];
  let currentAlt: IngLine[] = [];

  for (const line of lines) {
    if (line.isOptional) continue;

    if (line.isAnd) {
      currentAlt.push(line);
    } else if (line.isOr) {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      currentAlt = [line];
    } else {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [];
      currentAlt = [line];
    }
  }
  if (currentAlt.length > 0) currentGroup.push(currentAlt);
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}

/**
 * Indique si une alternative (bundle « + ») a au moins une contribution satiété calculable.
 */
function alternativeHasSatietyContribution(
  alt: IngLine[],
  sources?: IngredientMacroAutofillSources,
): boolean {
  return alt.some(
    (item) => computeRecipeIngredientSatietyContribution(item, sources) != null,
  );
}

/**
 * Choisit l'alternative retenue pour le calcul de satiété d'un groupe « ou ».
 * Priorité : (1) première alt. en stock avec macros si `isAvailable` est fourni,
 * (2) première alt. avec macros calculables même hors stock (carte catalogue = recette écrite),
 * (3) première alt. du groupe.
 */
function chooseSatietyAlternative(
  alternativeList: IngLine[][],
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): IngLine[] {
  if (isAvailable) {
    for (const alt of alternativeList) {
      if (
        alt[0]?.name &&
        isAvailable(alt[0].name) &&
        alternativeHasSatietyContribution(alt, sources)
      ) {
        return alt;
      }
    }
  }

  for (const alt of alternativeList) {
    if (alternativeHasSatietyContribution(alt, sources)) return alt;
  }

  return alternativeList[0] ?? [];
}

/**
 * Résout le poids d'unité (prefs Macro) pour un nom d'ingrédient, clé exacte puis match tolérant.
 */
function resolveUnitGramsByIngredientName(
  unitGramsByKey: Record<string, number> | undefined,
  ingredientName: string,
): number | undefined {
  if (!unitGramsByKey || !ingredientName.trim()) return undefined;
  const key = normalizeKey(ingredientName);
  const exact = key ? unitGramsByKey[key] : undefined;
  if (exact != null && exact > 0) return exact;
  for (const [mapKey, grams] of Object.entries(unitGramsByKey)) {
    if (grams > 0 && (strictNameMatch(mapKey, key) || strictNameMatch(mapKey, ingredientName))) {
      return grams;
    }
  }
  return undefined;
}

/**
 * Indique si la ligne de recette est exprimée en unités (count) sans grammage.
 */
function isRecipeLineQuantityBasis(line: IngLine): boolean {
  const qtyGrams = parseFloat(String(line.qty ?? "").replace(",", "."));
  const count = parseFloat(String(line.count ?? "").replace(",", "."));
  return (
    Number.isFinite(count) &&
    count > 0 &&
    !(Number.isFinite(qtyGrams) && qtyGrams > 0)
  );
}

/**
 * Indique si la ligne de recette est exprimée en grammes (ex. « 400g Pomme de terre »).
 */
function isRecipeLineGramBasis(line: IngLine): boolean {
  const qtyGrams = parseFloat(String(line.qty ?? "").replace(",", "."));
  return Number.isFinite(qtyGrams) && qtyGrams > 0;
}

/**
 * Résout les options satiété (base 100 g / Quantité, type, poids/unité) pour une ligne de recette.
 * Aligné Macro : une ligne en grammes impose la base 100 g, même si le stock Aliments est en unités
 * (sinon Quantité sans grammes/unité → satiété null, ex. Hachis avec pommes de terre en stock).
 * Base Quantité seulement pour les lignes en count (ex. « 3 Oeufs ») ou stock unités sans grammage recette.
 * Grammes/unité : fiche Aliments, sinon préférence Macro (`unitGramsByKey`).
 */
function resolveRecipeLineSatietyOptions(
  line: IngLine,
  sources?: IngredientMacroAutofillSources,
): IngredientSatietyOptions {
  const foodItem = findFoodItemForIngredientName(sources?.foodItems, line.name);
  const prefUnitGrams = resolveUnitGramsByIngredientName(
    sources?.unitGramsByKey,
    line.name,
  );

  const foodUnitGrams = foodItem ? parseQty(foodItem.grams) : 0;
  const unitGrams = foodUnitGrams > 0 ? foodUnitGrams : prefUnitGrams;
  const foodType = foodItem?.food_type ?? null;
  const foodIsQuantity =
    foodItem != null && foodItem.quantity != null && foodItem.quantity > 0;

  // Recette en grammes → macros au 100 g (ne pas hériter de la base Quantité du stock).
  if (isRecipeLineGramBasis(line)) {
    if (unitGrams != null && unitGrams > 0) {
      return { basisLabel: "100g", unitGrams, foodType };
    }
    return { basisLabel: "100g", foodType };
  }

  if (foodIsQuantity || isRecipeLineQuantityBasis(line)) {
    return {
      basisLabel: "Quantité",
      ...(unitGrams != null && unitGrams > 0 ? { unitGrams } : {}),
      foodType,
    };
  }

  // Base 100 g ; conserver le poids/unité pour convertir un count éventuel.
  if (unitGrams != null && unitGrams > 0) {
    return { basisLabel: "100g", unitGrams, foodType };
  }
  return { basisLabel: "100g", foodType };
}

/**
 * Contribution satiété d'une ligne d'ingrédient (macros inline ou référentiel), ou null si impossible.
 */
export function computeRecipeIngredientSatietyContribution(
  line: IngLine,
  sources?: IngredientMacroAutofillSources,
): number | null {
  if (!line.name.trim()) return null;

  const options = resolveRecipeLineSatietyOptions(line, sources);
  const inlineCal = line.cal?.trim() ?? "";
  const inlinePro = line.pro?.trim() ?? "";
  const inlineFiber = line.fiber?.trim() ?? "";

  const resolved =
    sources && (!inlineCal || !inlinePro || !inlineFiber)
      ? resolveIngredientLineMacros(line, sources)
      : { cal: "", pro: "", fiber: "" };

  const calories = inlineCal || resolved.cal;
  const protein = inlinePro || resolved.pro;
  // Fibre 0 est valide (ex. œuf) ; resolveIngredientLineMacros omet les zéros → "".
  const fiber =
    inlineFiber ||
    resolved.fiber ||
    (calories.trim() && protein.trim() ? "0" : "");

  const index = getIngredientSatietyIndex(calories, protein, fiber, options);
  if (index == null) return null;

  const qtyGrams = parseFloat(String(line.qty ?? "").replace(",", "."));
  const count = parseFloat(String(line.count ?? "").replace(",", "."));
  const portionFactor = computeSatietyPortionFactor(
    Number.isFinite(qtyGrams) ? qtyGrams : 0,
    Number.isFinite(count) ? count : 0,
    options,
  );
  if (portionFactor == null) return null;

  return computeIngredientSatietyContribution(index, portionFactor);
}

/** Détail satiété recette : somme pondérée (sans plafond) + volume en grammes retenu. */
export type MealSatietyDetails = {
  index: number;
  totalGrams: number | null;
};

/**
 * Calcule la satiété totale de la recette + volume (grammes) des alts. retenues.
 *
 * Formule :
 *   indice = round(Σ contributions)
 * avec contribution = indice_base_100g × (grammes / 100).
 *
 * Le volume est intrinsèque à la somme : +grammes d’un aliment augmente Σ.
 * Optionnels exclus ; une seule alt. par groupe « ou ».
 * Une ligne n'entre que si contribution **et** grammes sont connus.
 * Retourne null si aucune ligne exploitable.
 */
export function getMealRecipeSatietyDetails(
  ingredients: string | null | undefined,
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): MealSatietyDetails | null {
  if (!ingredients?.trim()) return null;

  const lines = parseIngredientsToLines(ingredients);
  const groups = groupIngredientLinesForSatiety(lines);
  let total = 0;
  let totalGrams = 0;
  let hasContribution = false;

  for (const alternativeList of groups) {
    const chosen = chooseSatietyAlternative(alternativeList, sources, isAvailable);
    for (const item of chosen) {
      const contribution = computeRecipeIngredientSatietyContribution(item, sources);
      const grams = computeRecipeIngredientGrams(item, sources);
      if (contribution == null || grams == null || !(grams > 0)) continue;
      total += contribution;
      totalGrams += grams;
      hasContribution = true;
    }
  }

  if (!hasContribution || !(totalGrams > 0)) return null;
  const index = normalizeMealRecipeSatietyTotal(total);
  if (index == null) return null;
  return { index, totalGrams };
}

/**
 * Indice satiété totale d'une recette (somme pondérée, sans plafond), ou null si incalculable.
 */
export function getMealRecipeSatietyIndex(
  ingredients: string | null | undefined,
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): number | null {
  return getMealRecipeSatietyDetails(ingredients, sources, isAvailable)?.index ?? null;
}

/**
 * Convertit la somme des contributions satiété d'une recette en indice carte.
 * Somme pondérée brute : round(Σ), sans plafond à 100.
 */
export function normalizeMealRecipeSatietyTotal(rawContributionSum: number): number | null {
  if (!Number.isFinite(rawContributionSum)) return null;
  if (rawContributionSum <= 0) return 0;
  return Math.round(rawContributionSum);
}

/**
 * @deprecated Ancienne densite / 100 g (dilutive). Conservée pour compat. tests / appelants ;
 * les cartes repas utilisent `normalizeMealRecipeSatietyTotal`.
 * densite = min(100, round( somme / grammes × 100 )).
 */
export function normalizeSatietyIndexPer100g(
  rawIndexSum: number,
  totalGrams: number,
): number | null {
  if (!(totalGrams > 0) || !Number.isFinite(rawIndexSum)) return null;
  return clampMealSatietyIndex((rawIndexSum / totalGrams) * 100);
}

/**
 * Estime le poids en grammes d'une ligne de recette (grammes directs, ou count × poids/unité Macro).
 */
export function computeRecipeIngredientGrams(
  line: IngLine,
  sources?: IngredientMacroAutofillSources,
): number | null {
  if (!line.name.trim()) return null;
  const qtyGrams = parseFloat(String(line.qty ?? "").replace(",", "."));
  if (Number.isFinite(qtyGrams) && qtyGrams > 0) return qtyGrams;

  const count = parseFloat(String(line.count ?? "").replace(",", "."));
  if (!(Number.isFinite(count) && count > 0)) return null;

  const options = resolveRecipeLineSatietyOptions(line, sources);
  if (options.unitGrams != null && options.unitGrams > 0) {
    return count * options.unitGrams;
  }
  return null;
}

/** Macros d'une fiche repas utilisées pour le repli satiété (aligné note nutritionnelle). */
export type MealSatietyMacrosSource = {
  name?: string | null;
  calories?: string | null;
  protein?: string | null;
  fiber?: string | null;
  grams?: string | null;
  ingredients?: string | null;
};

/**
 * Estime l'indice Meals Cards à partir des macros d'une fiche repas (repli).
 * Avec grammes de portion → macros ramenées au 100 g, puis contribution totale
 * (indice_base × grammes/100) sans plafond ;
 * sinon macros traitées comme déjà exprimées pour 100 g.
 * N'invente pas de macros manquantes (fibre « 0 » explicite reste valide).
 */
export function estimateMealsCardsSatietyIndexFromMealMacros(
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined,
  grams?: string | null | undefined,
  foodType: FoodType = null,
): number | null {
  const cal = parseMacroDisplay(calories);
  const pro = parseMacroDisplay(protein);
  if (cal == null || !(cal > 0) || pro == null) return null;
  if (fiber == null || !String(fiber).trim()) return null;
  const fib = parseMacroDisplay(fiber);
  if (fib == null) return null;

  const portionGrams = parseQty(grams);
  if (portionGrams > 0) {
    const factor = 100 / portionGrams;
    const cal100 = cal * factor;
    const pro100 = pro * factor;
    const fib100 = fib * factor;
    const baseIndex = estimateMealsCardsSatietyIndex(cal100, pro100, fib100, foodType);
    // Satiété totale de la portion : contribution = indice × grammes/100.
    return normalizeMealRecipeSatietyTotal(
      computeIngredientSatietyContribution(baseIndex, portionGrams / 100),
    );
  }

  return estimateMealsCardsSatietyIndex(cal, pro, fib, foodType);
}

/**
 * Détail satiété d'un repas catalogue / carte (somme pondérée + volume si recette).
 *
 * Priorité :
 * 1) Satiété totale des contributions ingrédients (si au moins une est calculable)
 * 2) Sinon estimateur Meals Cards des macros de la fiche repas
 * 3) Sinon macros de l'aliment homonyme (`foodItems` / is_meal)
 *
 * Sans source fiable → null (badge masqué via hideWhenMissing).
 */
export function getMealSatietyDetails(
  meal: MealSatietyMacrosSource,
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): MealSatietyDetails | null {
  const fromRecipe = getMealRecipeSatietyDetails(meal.ingredients, sources, isAvailable);
  if (fromRecipe != null) return fromRecipe;

  const fromMealMacros = estimateMealsCardsSatietyIndexFromMealMacros(
    meal.calories,
    meal.protein,
    meal.fiber,
    meal.grams,
  );
  if (fromMealMacros != null) {
    const portionGrams = parseQty(meal.grams);
    return {
      index: fromMealMacros,
      totalGrams: portionGrams > 0 ? portionGrams : null,
    };
  }

  const mealName = meal.name?.trim();
  if (!mealName || !sources?.foodItems?.length) return null;

  const foodItem = findFoodItemForIngredientName(sources.foodItems, mealName);
  if (!foodItem) return null;

  const fromFood = estimateMealsCardsSatietyIndexFromMealMacros(
    foodItem.calories,
    foodItem.protein,
    foodItem.fiber,
    foodItem.grams,
    foodItem.food_type ?? null,
  );
  if (fromFood == null) return null;
  const foodGrams = parseQty(foodItem.grams);
  return {
    index: fromFood,
    totalGrams: foodGrams > 0 ? foodGrams : null,
  };
}

/**
 * Indice de satiété d'un repas catalogue / carte (somme pondérée, sans plafond), ou null.
 */
export function getMealSatietyIndex(
  meal: MealSatietyMacrosSource,
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): number | null {
  return getMealSatietyDetails(meal, sources, isAvailable)?.index ?? null;
}

/**
 * Texte du tooltip satiété carte : satiété totale de la recette + volume retenu.
 */
export function formatMealSatietyIndexTooltip(
  index: number,
  totalGrams?: number | null,
): string {
  if (totalGrams != null && totalGrams > 0) {
    return `Satiété de la recette : ${index} · Volume : ${Math.round(totalGrams)} g`;
  }
  return `Satiété Meals Cards (recette) : ${index}`;
}
