import type { Meal, PossibleMeal } from "@/types/meals";
import type { FoodItem } from "@/types/food";
import {
  getFoodItemTotalGrams,
  normalizeKey,
  parseIngredientsToLines,
  parseQty,
  serializeIngredients,
  strictNameMatch,
  type IngLine,
} from "@/lib/ingredientUtils";
import {
  getExtraMacroBasisLabel,
  getExtraMacroReferenceMacros,
  getExtraStoredMacrosFromReference,
  hasNonZeroMacro,
  parseFoodMacroValue,
} from "@/lib/extraMacroUtils";

export interface IngredientMacroEntry {
  key: string;
  displayName: string;
  calories: string;
  protein: string;
  fiber: string;
  recipeCount: number;
  overrideCount: number;
  foodCount: number;
  basisLabel: string | null;
  recipeNames: string[];
  hasConflictingCalories: boolean;
  hasConflictingProtein: boolean;
  hasConflictingFiber: boolean;
}

export interface IngredientMacroLibraryItem {
  key: string;
  displayName: string;
  calories: string;
  protein: string;
  fiber?: string;
}

export interface IngredientMacroAutofillSources {
  foodItems?: FoodItem[];
  macroLibrary?: IngredientMacroLibraryItem[];
  mealMacros?: Map<string, { cal: string; pro: string; fiber?: string }>;
  /**
   * Grammes par unité saisis dans l'onglet Macro (préférence `ingredient_macro_unit_grams`).
   * Sert à la satiété recette quand la fiche Aliments n'a pas de poids d'unité.
   */
  unitGramsByKey?: Record<string, number>;
}

export interface IngredientMacroUpdatePlan {
  mealUpdates: { id: string; ingredients: string }[];
  possibleUpdates: { id: string; ingredients_override: string | null }[];
  foodUpdates: { id: string; calories: string | null; protein: string | null; fiber: string | null }[];
}

type MacroAccumulator = IngredientMacroEntry & {
  recipeIds: Set<string>;
  overrideIds: Set<string>;
  foodIds: Set<string>;
  /** Au moins une ligne recette/possible utilise des grammes pour cet ingrédient. */
  recipeHasGramBasis: boolean;
  /** Au moins une ligne recette/possible utilise une quantité unitaire. */
  recipeHasQuantityBasis: boolean;
};

// Met en forme le nom affiché d'un ingrédient pour que chaque entrée commence par une majuscule.
function formatIngredientDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLocaleUpperCase("fr-FR") + trimmed.slice(1);
}

// Crée une entrée persistable du référentiel à partir d'un nom et de macros saisies.
export function createIngredientMacroLibraryItem(
  name: string,
  calories: string,
  protein: string,
  fiber: string = "",
): IngredientMacroLibraryItem | null {
  const displayName = formatIngredientDisplayName(name);
  const key = normalizeKey(displayName);
  if (!key) return null;
  return {
    key,
    displayName,
    calories: calories.trim(),
    protein: protein.trim(),
    fiber: fiber.trim(),
  };
}

// Ajoute ou remplace un ingrédient dans le référentiel macros persisté.
export function upsertIngredientMacroLibraryItem(
  library: IngredientMacroLibraryItem[],
  item: IngredientMacroLibraryItem,
): IngredientMacroLibraryItem[] {
  const others = library.filter((entry) => entry.key !== item.key);
  return [...others, item].sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

// Ajoute au référentiel Macro un aliment dont les calories ou protéines ont été saisies dans l'onglet Aliments.
export function upsertFoodItemMacroLibraryItem(
  library: IngredientMacroLibraryItem[],
  foodName: string,
  calories: string | null | undefined,
  protein: string | null | undefined,
  fiber: string | null | undefined = "",
): IngredientMacroLibraryItem[] {
  const item = createIngredientMacroLibraryItem(foodName, calories ?? "", protein ?? "", fiber ?? "");
  if (!item || (!item.calories && !item.protein && !item.fiber)) return library;

  const existing = library.find((entry) => entry.key === item.key);
  if (
    existing?.displayName === item.displayName &&
    existing.calories === item.calories &&
    existing.protein === item.protein &&
    (existing.fiber ?? "") === item.fiber
  ) {
    return library;
  }

  return upsertIngredientMacroLibraryItem(library, item);
}

// Persiste les lignes Macro découvertes automatiquement pour qu'elles survivent à la disparition des sources.
export function persistMissingIngredientMacroEntries(
  library: IngredientMacroLibraryItem[],
  entries: IngredientMacroEntry[],
  ignoredKeys: Set<string> = new Set(),
): IngredientMacroLibraryItem[] {
  let nextLibrary = library;
  const existingKeys = new Set(library.map((entry) => entry.key));

  for (const entry of entries) {
    if (existingKeys.has(entry.key) || ignoredKeys.has(entry.key)) continue;
    if (!entry.calories.trim() && !entry.protein.trim() && !entry.fiber.trim()) continue;

    const item = createIngredientMacroLibraryItem(entry.displayName, entry.calories, entry.protein, entry.fiber);
    if (!item) continue;
    nextLibrary = upsertIngredientMacroLibraryItem(nextLibrary, item);
    existingKeys.add(item.key);
  }

  return nextLibrary;
}

// Compare deux référentiels Macro pour éviter des sauvegardes en boucle quand seule la référence change.
export function areIngredientMacroLibrariesEqual(
  left: IngredientMacroLibraryItem[],
  right: IngredientMacroLibraryItem[],
): boolean {
  if (left.length !== right.length) return false;
  const rightByKey = new Map(right.map((entry) => [entry.key, entry]));
  for (const entry of left) {
    const other = rightByKey.get(entry.key);
    if (!other) return false;
    if (
      entry.displayName !== other.displayName ||
      entry.calories !== other.calories ||
      entry.protein !== other.protein ||
      (entry.fiber ?? "") !== (other.fiber ?? "")
    ) {
      return false;
    }
  }
  return true;
}

// Retire un ingrédient du référentiel macros persisté.
export function removeIngredientMacroLibraryItem(
  library: IngredientMacroLibraryItem[],
  ingredientKey: string,
): IngredientMacroLibraryItem[] {
  return library.filter((entry) => entry.key !== ingredientKey);
}

// Crée l'entrée interne qui regroupe les macros connues pour un ingrédient donné.
function createMacroAccumulator(key: string, displayName: string): MacroAccumulator {
  return {
    key,
    displayName: formatIngredientDisplayName(displayName),
    calories: "",
    protein: "",
    fiber: "",
    recipeCount: 0,
    overrideCount: 0,
    foodCount: 0,
    basisLabel: null,
    recipeNames: [],
    hasConflictingCalories: false,
    hasConflictingProtein: false,
    hasConflictingFiber: false,
    recipeIds: new Set<string>(),
    overrideIds: new Set<string>(),
    foodIds: new Set<string>(),
    recipeHasGramBasis: false,
    recipeHasQuantityBasis: false,
  };
}

// Déduit la base macro d'une ligne de repas selon qu'elle utilise des grammes ou une quantité.
function getMealLineBasisLabel(line: { qty?: string; count?: string }): string | null {
  if (line.qty?.trim()) return "100g";
  if (line.count?.trim()) return "Quantité";
  return null;
}

// Déduit la base macro depuis la fiche Aliment quand l'ingrédient existe dans le stock.
function getFoodItemBasisLabel(foodItem: FoodItem): string | null {
  if (foodItem.storage_type === "extras") return getExtraMacroBasisLabel(foodItem);
  // Quantité prioritaire : les macros saisies sont par unité, pas au 100 g.
  if (foodItem.quantity != null && foodItem.quantity > 0) return "Quantité";
  if (foodItem.grams?.trim()) return "100g";
  return null;
}

// Alimente une entrée de référentiel avec les valeurs trouvées dans une recette ou un override.
function mergeMacroValue(
  entry: MacroAccumulator,
  sourceId: string,
  sourceName: string,
  sourceType: "recipe" | "override",
  calories: string,
  protein: string,
  fiber: string,
  basisLabel: string | null,
) {
  if (sourceType === "recipe") {
    entry.recipeIds.add(sourceId);
    if (!entry.recipeNames.includes(sourceName)) entry.recipeNames.push(sourceName);
  } else if (sourceType === "override") {
    entry.overrideIds.add(sourceId);
  }

  if (calories) {
    entry.calories = calories;
    entry.hasConflictingCalories = false;
  }

  if (protein) {
    entry.protein = protein;
    entry.hasConflictingProtein = false;
  }

  if (fiber) {
    entry.fiber = fiber;
    entry.hasConflictingFiber = false;
  }

  if (basisLabel === "100g") entry.recipeHasGramBasis = true;
  if (basisLabel === "Quantité") entry.recipeHasQuantityBasis = true;
  if (basisLabel) entry.basisLabel = basisLabel;
}

// Alimente une entrée de référentiel depuis une fiche de l'onglet Aliments.
function mergeFoodItemMacro(entry: MacroAccumulator, foodItem: FoodItem) {
  entry.foodIds.add(foodItem.id);
  const basisLabel = getFoodItemBasisLabel(foodItem);
  if (basisLabel) entry.basisLabel = basisLabel;

  const referenceMacros = getExtraMacroReferenceMacros(foodItem);

  if (referenceMacros.cal) {
    entry.calories = referenceMacros.cal;
    entry.hasConflictingCalories = false;
  }

  if (referenceMacros.pro) {
    entry.protein = referenceMacros.pro;
    entry.hasConflictingProtein = false;
  }

  if (referenceMacros.fiber) {
    entry.fiber = referenceMacros.fiber;
    entry.hasConflictingFiber = false;
  }
}

// Extrait la base de macros depuis les ingrédients annotés des recettes et des overrides Possible.
export function collectIngredientMacroEntries(
  meals: Meal[],
  possibleMeals: PossibleMeal[] = [],
  macroLibrary: IngredientMacroLibraryItem[] = [],
  foodItems: FoodItem[] = [],
): IngredientMacroEntry[] {
  const entries = new Map<string, MacroAccumulator>();

  for (const foodItem of foodItems) {
    if (!foodItem.name?.trim()) continue;
    if (!foodItem.calories?.trim() && !foodItem.protein?.trim() && !foodItem.fiber?.trim()) continue;
    const key = normalizeKey(foodItem.name);
    if (!key) continue;
    const entry = entries.get(key) ?? createMacroAccumulator(key, foodItem.name);
    mergeFoodItemMacro(entry, foodItem);
    entries.set(key, entry);
  }

  // Parcourt une chaîne d'ingrédients pour récupérer les macros annotées ligne par ligne.
  const collectFromText = (
    sourceId: string,
    sourceName: string,
    sourceType: "recipe" | "override",
    ingredients: string | null | undefined,
  ) => {
    if (!ingredients?.trim()) return;

    for (const line of parseIngredientsToLines(ingredients)) {
      const name = line.name.trim();
      if (!name) continue;

      const calories = line.cal?.trim() || "";
      const protein = line.pro?.trim() || "";
      const fiber = line.fiber?.trim() || "";
      if (!calories && !protein && !fiber) continue;

      const key = normalizeKey(name);
      if (!key) continue;

      const entry = entries.get(key) ?? createMacroAccumulator(key, name);
      mergeMacroValue(entry, sourceId, sourceName, sourceType, calories, protein, fiber, getMealLineBasisLabel(line));
      entries.set(key, entry);
    }
  };

  for (const meal of meals) {
    collectFromText(meal.id, meal.name, "recipe", meal.ingredients);
  }

  for (const pm of possibleMeals) {
    collectFromText(pm.id, pm.meals?.name ?? "Possible", "override", pm.ingredients_override);
  }

  for (const item of macroLibrary) {
    const key = item.key || normalizeKey(item.displayName);
    if (!key) continue;
    const entry = entries.get(key) ?? createMacroAccumulator(key, item.displayName);
    entry.calories = item.calories?.trim() || entry.calories;
    entry.protein = item.protein?.trim() || entry.protein;
    entry.fiber = item.fiber?.trim() || entry.fiber;
    // Les entrées persistées seules viennent du référentiel Macro, dont les valeurs sont au 100 g.
    if (!entry.basisLabel) entry.basisLabel = "100g";
    entry.hasConflictingCalories = false;
    entry.hasConflictingProtein = false;
    entry.hasConflictingFiber = false;
    entries.set(key, entry);
  }

  // Base affichée : les recettes en grammes prime sur la quantité de stock Aliments
  // (ex. Fuet stocké en unités mais toujours utilisé en « 50g Fuet » dans les recettes).
  for (const foodItem of foodItems) {
    if (!foodItem.name?.trim()) continue;
    const key = normalizeKey(foodItem.name);
    if (!key) continue;
    const entry = entries.get(key);
    if (!entry) continue;
    entry.foodIds.add(foodItem.id);
    if (!entry.recipeHasGramBasis && !entry.recipeHasQuantityBasis) {
      const basisLabel = getFoodItemBasisLabel(foodItem);
      if (basisLabel) entry.basisLabel = basisLabel;
    }
    entries.set(key, entry);
  }

  return [...entries.values()]
    .map(({ recipeIds, overrideIds, foodIds, recipeHasGramBasis, recipeHasQuantityBasis, ...entry }) => {
      // Résolution finale : grammes recettes > quantité recettes > fiche Aliments / défaut.
      let basisLabel = entry.basisLabel;
      if (recipeHasGramBasis) basisLabel = "100g";
      else if (recipeHasQuantityBasis) basisLabel = "Quantité";
      return {
        ...entry,
        basisLabel,
        recipeCount: recipeIds.size,
        overrideCount: overrideIds.size,
        foodCount: foodIds.size,
        recipeNames: entry.recipeNames.sort((a, b) => a.localeCompare(b, "fr")),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

// Applique les macros de référence à toutes les occurrences d'un ingrédient dans une chaîne.
export function applyIngredientMacroToText(
  ingredients: string | null | undefined,
  ingredientKey: string,
  calories: string,
  protein: string,
  fiber: string = "",
): string | null {
  if (!ingredients?.trim() || !ingredientKey) return null;

  const lines = parseIngredientsToLines(ingredients);
  const nextCalories = calories.trim();
  const nextProtein = protein.trim();
  const nextFiber = fiber.trim();
  let changed = false;

  for (const line of lines) {
    const key = normalizeKey(line.name || "");
    if (key !== ingredientKey) continue;

    if ((line.cal || "") !== nextCalories) {
      line.cal = nextCalories;
      changed = true;
    }
    if ((line.pro || "") !== nextProtein) {
      line.pro = nextProtein;
      changed = true;
    }
    if ((line.fiber || "") !== nextFiber) {
      line.fiber = nextFiber;
      changed = true;
    }
  }

  return changed ? serializeIngredients(lines) : null;
}

// Prépare les mises à jour Macro en propageant les valeurs aux recettes, cartes Possible et fiches Aliment.
export function buildIngredientMacroUpdatePlan(
  meals: Meal[],
  possibleMeals: PossibleMeal[],
  foodItems: FoodItem[],
  ingredientKey: string,
  calories: string,
  protein: string,
  fiber: string = "",
): IngredientMacroUpdatePlan {
  const mealUpdates = meals.flatMap((meal) => {
    const ingredients = applyIngredientMacroToText(meal.ingredients, ingredientKey, calories, protein, fiber);
    return ingredients === null ? [] : [{ id: meal.id, ingredients }];
  });

  const possibleUpdates = possibleMeals.flatMap((pm) => {
    if (pm.ingredients_override == null) return [];
    const ingredients_override = applyIngredientMacroToText(pm.ingredients_override, ingredientKey, calories, protein, fiber);
    return ingredients_override === null ? [] : [{ id: pm.id, ingredients_override }];
  });

  const foodUpdates = foodItems.flatMap((foodItem) => {
    if (normalizeKey(foodItem.name || "") !== ingredientKey) return [];
    const storedMacros =
      foodItem.storage_type === "extras"
        ? getExtraStoredMacrosFromReference(foodItem, calories, protein, fiber)
        : {
            calories: calories.trim() || null,
            protein: protein.trim() || null,
            fiber: fiber.trim() || null,
          };
    if ((foodItem.calories ?? null) === storedMacros.calories && (foodItem.protein ?? null) === storedMacros.protein && (foodItem.fiber ?? null) === storedMacros.fiber) return [];
    return [{ id: foodItem.id, calories: storedMacros.calories, protein: storedMacros.protein, fiber: storedMacros.fiber }];
  });

  return { mealUpdates, possibleUpdates, foodUpdates };
}

// Formate une valeur numérique de macro pour l'affichage dans l'éditeur d'ingrédients.
// Autorise les négatifs (ajustement « Négatif » en base) ; 0 / NaN → chaîne vide.
function formatLineMacroValue(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "";
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded).replace(".", ",");
}

/**
 * Trouve la fiche Aliments correspondant à un nom de ligne recette.
 * Exact via normalizeKey, puis match tolérant (pluriel / petite variante), comme le stock.
 */
export function findFoodItemForIngredientName(
  foodItems: FoodItem[] | undefined,
  ingredientName: string,
): FoodItem | undefined {
  if (!foodItems?.length || !ingredientName.trim()) return undefined;
  const key = normalizeKey(ingredientName);
  const exact = foodItems.find((item) => normalizeKey(item.name) === key);
  if (exact) return exact;
  return foodItems.find((item) => strictNameMatch(item.name, ingredientName));
}

/**
 * Trouve une entrée du référentiel Macro pour un nom d'ingrédient (clé exacte puis match tolérant).
 */
function findMacroLibraryItemForIngredientName(
  library: IngredientMacroLibraryItem[] | undefined,
  ingredientName: string,
): IngredientMacroLibraryItem | undefined {
  if (!library?.length || !ingredientName.trim()) return undefined;
  const key = normalizeKey(ingredientName);
  const exact = library.find((entry) => entry.key === key);
  if (exact) return exact;
  return library.find(
    (entry) =>
      strictNameMatch(entry.displayName, ingredientName) ||
      strictNameMatch(entry.key, key),
  );
}

/**
 * Trouve des macros déjà vues dans d'autres recettes (clé exacte puis match tolérant).
 */
function findMealMacroForIngredientName(
  mealMacros: Map<string, { cal: string; pro: string; fiber?: string }> | undefined,
  ingredientName: string,
): { cal: string; pro: string; fiber?: string } | undefined {
  if (!mealMacros?.size || !ingredientName.trim()) return undefined;
  const key = normalizeKey(ingredientName);
  const exact = mealMacros.get(key);
  if (exact) return exact;
  for (const [mapKey, value] of mealMacros) {
    if (strictNameMatch(mapKey, key) || strictNameMatch(mapKey, ingredientName)) {
      return value;
    }
  }
  return undefined;
}

// Indique si les macros d'une ligne peuvent être recalculées depuis le garde-manger ou le référentiel Macro.
export function hasScalableIngredientMacroSource(
  line: Pick<IngLine, "name">,
  sources: IngredientMacroAutofillSources,
): boolean {
  if (!normalizeKey(line.name)) return false;

  const foodItem = findFoodItemForIngredientName(sources.foodItems, line.name);
  if (foodItem) {
    const ref = getExtraMacroReferenceMacros(foodItem);
    if (hasNonZeroMacro(parseFoodMacroValue(ref.cal)) || hasNonZeroMacro(parseFoodMacroValue(ref.pro)) || hasNonZeroMacro(parseFoodMacroValue(ref.fiber))) return true;
  }

  const libraryItem = findMacroLibraryItemForIngredientName(sources.macroLibrary, line.name);
  if (libraryItem && (hasNonZeroMacro(parseFoodMacroValue(libraryItem.calories)) || hasNonZeroMacro(parseFoodMacroValue(libraryItem.protein)) || hasNonZeroMacro(parseFoodMacroValue(libraryItem.fiber)))) {
    return true;
  }

  return false;
}

// Résout les calories, protéines et fibres d'une ligne à partir du garde-manger, du référentiel Macro ou des recettes existantes.
export function resolveIngredientLineMacros(
  line: Pick<IngLine, "name" | "qty" | "count">,
  sources: IngredientMacroAutofillSources,
): { cal: string; pro: string; fiber: string } {
  if (!normalizeKey(line.name)) return { cal: "", pro: "", fiber: "" };

  const foodItem = findFoodItemForIngredientName(sources.foodItems, line.name);

  if (foodItem) {
    const ref = getExtraMacroReferenceMacros(foodItem);
    const calRef = parseFoodMacroValue(ref.cal);
    const proRef = parseFoodMacroValue(ref.pro);
    const fiberRef = parseFoodMacroValue(ref.fiber);
    if (hasNonZeroMacro(calRef) || hasNonZeroMacro(proRef) || hasNonZeroMacro(fiberRef)) {
      return {
        cal: hasNonZeroMacro(calRef) ? formatLineMacroValue(calRef) : "",
        pro: hasNonZeroMacro(proRef) ? formatLineMacroValue(proRef) : "",
        fiber: hasNonZeroMacro(fiberRef) ? formatLineMacroValue(fiberRef) : "",
      };
    }
  }

  const libraryItem = findMacroLibraryItemForIngredientName(sources.macroLibrary, line.name);
  if (libraryItem) {
    const calRef = parseFoodMacroValue(libraryItem.calories);
    const proRef = parseFoodMacroValue(libraryItem.protein);
    const fiberRef = parseFoodMacroValue(libraryItem.fiber);
    if (hasNonZeroMacro(calRef) || hasNonZeroMacro(proRef) || hasNonZeroMacro(fiberRef)) {
      return {
        cal: hasNonZeroMacro(calRef) ? formatLineMacroValue(calRef) : "",
        pro: hasNonZeroMacro(proRef) ? formatLineMacroValue(proRef) : "",
        fiber: hasNonZeroMacro(fiberRef) ? formatLineMacroValue(fiberRef) : "",
      };
    }
  }

  const mealMacro = findMealMacroForIngredientName(sources.mealMacros, line.name);
  if (mealMacro && (mealMacro.cal || mealMacro.pro || mealMacro.fiber)) {
    return { cal: mealMacro.cal || "", pro: mealMacro.pro || "", fiber: mealMacro.fiber || "" };
  }

  return { cal: "", pro: "", fiber: "" };
}

export interface UnParUnMacroDisplay {
  calDisplay: number | null;
  proDisplay: number | null;
  per100Cal: number | null;
  per100Pro: number | null;
  hasGrams: boolean;
}

/**
 * Résout les macros affichées dans « Un par un » depuis le référentiel « Macro ingrédients » (/100g).
 * Ignore les valeurs de la fiche aliment et des recettes pour éviter les totaux ligne mal interprétés.
 */
export function resolveUnParUnFoodItemMacros(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[] = [],
): UnParUnMacroDisplay {
  const key = normalizeKey(fi.name);
  const libraryItem = macroLibrary.find((entry) => entry.key === key);
  const per100Cal = libraryItem ? parseFoodMacroValue(libraryItem.calories) : 0;
  const per100Pro = libraryItem ? parseFoodMacroValue(libraryItem.protein) : 0;
  const totalG = getFoodItemTotalGrams(fi);
  const hasGrams = totalG > 0;

  if (!hasGrams) {
    return {
      calDisplay: hasNonZeroMacro(per100Cal) ? per100Cal : null,
      proDisplay: hasNonZeroMacro(per100Pro) ? per100Pro : null,
      per100Cal: null,
      per100Pro: null,
      hasGrams: false,
    };
  }

  return {
    per100Cal: hasNonZeroMacro(per100Cal) ? per100Cal : null,
    per100Pro: hasNonZeroMacro(per100Pro) ? per100Pro : null,
    calDisplay: hasNonZeroMacro(per100Cal) ? Math.round((per100Cal * totalG) / 100) : null,
    proDisplay: hasNonZeroMacro(per100Pro) ? Math.round((per100Pro * totalG) / 100) : null,
    hasGrams: true,
  };
}

export interface ConsumeDialogMacroPreview {
  cal: number | null;
  pro: number | null;
}

/**
 * Calcule les macros prévisionnelles du dialogue « Consommer » à partir de la saisie en cours.
 * Utilise le référentiel « Macro ingrédients » (/100g) et la même logique de déduction que le déplacement.
 */
export function resolveConsumeDialogMacros(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[] = [],
  consumeQty: string,
  consumeGrams: string,
): ConsumeDialogMacroPreview {
  const key = normalizeKey(fi.name);
  const libraryItem = macroLibrary.find((entry) => entry.key === key);
  const per100Cal = libraryItem ? parseFoodMacroValue(libraryItem.calories) : 0;
  const per100Pro = libraryItem ? parseFoodMacroValue(libraryItem.protein) : 0;
  if (!hasNonZeroMacro(per100Cal) && !hasNonZeroMacro(per100Pro)) return { cal: null, pro: null };

  const unitG = parseQty(fi.grams);
  const qtyParsed = consumeQty.trim() ? parseInt(consumeQty, 10) : NaN;
  const gramsParsed = consumeGrams.trim() ? parseFloat(consumeGrams.replace(",", ".")) : NaN;
  const hasQty = Number.isFinite(qtyParsed) && qtyParsed > 0;
  const hasGrams = Number.isFinite(gramsParsed) && gramsParsed > 0;

  if (unitG > 0) {
    if (!hasQty && !hasGrams) return { cal: null, pro: null };
    const effectiveGrams = (hasQty ? qtyParsed : 0) * unitG + (hasGrams ? gramsParsed : 0);
    if (effectiveGrams <= 0) return { cal: null, pro: null };
    return {
      cal: hasNonZeroMacro(per100Cal) ? Math.round((per100Cal * effectiveGrams) / 100) : null,
      pro: hasNonZeroMacro(per100Pro) ? Math.round((per100Pro * effectiveGrams) / 100) : null,
    };
  }

  if (!hasQty) return { cal: null, pro: null };
  return {
    cal: hasNonZeroMacro(per100Cal) ? Math.round(per100Cal * qtyParsed) : null,
    pro: hasNonZeroMacro(per100Pro) ? Math.round(per100Pro * qtyParsed) : null,
  };
}

// Complète les macros manquantes sur chaque ligne sans écraser une saisie manuelle existante.
export function autofillIngredientLinesMacros(
  lines: IngLine[],
  sources: IngredientMacroAutofillSources,
): IngLine[] {
  return lines.map((line) => {
    if (!line.name.trim()) return line;

    const scalable = hasScalableIngredientMacroSource(line, sources);
    const hasCal = Boolean(line.cal?.trim());
    const hasPro = Boolean(line.pro?.trim());
    const hasFiber = Boolean(line.fiber?.trim());
    // Source Macro / garde-manger : toujours resynchroniser (ex. « Négatif » −316/−11
    // déjà corrompu en positif dans la ligne).
    if (hasCal && hasPro && hasFiber && !scalable) return line;

    const resolved = resolveIngredientLineMacros(line, sources);
    if (!resolved.cal && !resolved.pro && !resolved.fiber) return line;

    if (scalable) {
      return {
        ...line,
        cal: resolved.cal || line.cal,
        pro: resolved.pro || line.pro,
        fiber: resolved.fiber || line.fiber,
      };
    }

    return {
      ...line,
      cal: hasCal ? line.cal : (resolved.cal || line.cal),
      pro: hasPro ? line.pro : (resolved.pro || line.pro),
      fiber: hasFiber ? line.fiber : (resolved.fiber || line.fiber),
    };
  });
}
