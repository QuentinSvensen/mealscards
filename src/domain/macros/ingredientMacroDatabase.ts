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
  getExtraPortionMacros,
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
  /**
   * Recettes catalogue (Tous) : repli quand la fiche aliment et Macro n’ont pas de kcal
   * (repas homonyme sans ingrédients, macros saisies sur la carte).
   */
  catalogMeals?: Meal[];
}

export interface IngredientMacroUpdatePlan {
  mealUpdates: { id: string; ingredients: string }[];
  possibleUpdates: { id: string; ingredients_override: string | null }[];
  foodUpdates: { id: string; calories: string | null; protein: string | null; fiber: string | null }[];
}

/** Plan de renommage d’un ingrédient dans recettes, possibles et fiches Aliments. */
export interface IngredientRenameUpdatePlan {
  mealUpdates: { id: string; ingredients: string }[];
  possibleUpdates: { id: string; ingredients_override: string | null }[];
  foodUpdates: { id: string; name: string }[];
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
    // Le référentiel Macro est la source de vérité (sinon les fiches Aliments masquent la saisie OK).
    entry.calories = (item.calories ?? "").trim();
    entry.protein = (item.protein ?? "").trim();
    entry.fiber = (item.fiber ?? "").trim();
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

/**
 * Renomme toutes les occurrences d’un ingrédient (clé normalisée) dans une chaîne
 * d’ingrédients structurés ; conserve qty / macros / notes de chaque ligne.
 */
export function applyIngredientRenameToText(
  ingredients: string | null | undefined,
  oldIngredientKey: string,
  newDisplayName: string,
): string | null {
  if (!ingredients?.trim() || !oldIngredientKey) return null;
  const nextName = formatIngredientDisplayName(newDisplayName);
  if (!nextName || !normalizeKey(nextName)) return null;

  const lines = parseIngredientsToLines(ingredients);
  let changed = false;

  for (const line of lines) {
    const key = normalizeKey(line.name || "");
    if (key !== oldIngredientKey) continue;
    if (line.name === nextName) continue;
    line.name = nextName;
    changed = true;
  }

  return changed ? serializeIngredients(lines) : null;
}

/**
 * Prépare les mises à jour de renommage : recettes, overrides Possible, fiches Aliments.
 */
export function buildIngredientRenamePlan(
  meals: Meal[],
  possibleMeals: PossibleMeal[],
  foodItems: FoodItem[],
  oldIngredientKey: string,
  newDisplayName: string,
): IngredientRenameUpdatePlan {
  const nextName = formatIngredientDisplayName(newDisplayName);

  const mealUpdates = meals.flatMap((meal) => {
    const ingredients = applyIngredientRenameToText(meal.ingredients, oldIngredientKey, nextName);
    return ingredients === null ? [] : [{ id: meal.id, ingredients }];
  });

  const possibleUpdates = possibleMeals.flatMap((pm) => {
    if (pm.ingredients_override == null) return [];
    const ingredients_override = applyIngredientRenameToText(
      pm.ingredients_override,
      oldIngredientKey,
      nextName,
    );
    return ingredients_override === null ? [] : [{ id: pm.id, ingredients_override }];
  });

  const foodUpdates = foodItems.flatMap((foodItem) => {
    if (normalizeKey(foodItem.name || "") !== oldIngredientKey) return [];
    if ((foodItem.name || "").trim() === nextName) return [];
    return [{ id: foodItem.id, name: nextName }];
  });

  return { mealUpdates, possibleUpdates, foodUpdates };
}

/**
 * Remplace l’entrée Macro `oldKey` par le nouveau nom (nouvelle clé si besoin).
 * Ne gère pas les collisions : le caller doit vérifier avant.
 */
export function renameIngredientMacroLibraryItem(
  library: IngredientMacroLibraryItem[],
  oldKey: string,
  newDisplayName: string,
  calories: string,
  protein: string,
  fiber: string = "",
): IngredientMacroLibraryItem[] | null {
  const item = createIngredientMacroLibraryItem(newDisplayName, calories, protein, fiber);
  if (!item) return null;
  const withoutOld = removeIngredientMacroLibraryItem(library, oldKey);
  return upsertIngredientMacroLibraryItem(withoutOld, item);
}

// Formate une valeur numérique de macro pour l'affichage dans l'éditeur d'ingrédients.
// Autorise les négatifs (ajustement « Négatif » en base).
// Par défaut 0 → "" ; avec allowZero (fibres) → "0".
function formatLineMacroValue(value: number, options?: { allowZero?: boolean }): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return options?.allowZero ? "0" : "";
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

/**
 * Convertit des valeurs numériques de référence en champs cal/pro/fib pour l'éditeur de lignes.
 */
function formatMacroTripletFromRefs(
  calRef: number,
  proRef: number,
  fiberRef: number,
): { cal: string; pro: string; fiber: string } {
  const hasCalOrPro = hasNonZeroMacro(calRef) || hasNonZeroMacro(proRef);
  if (!hasCalOrPro && !hasNonZeroMacro(fiberRef)) {
    return { cal: "", pro: "", fiber: "" };
  }
  return {
    cal: hasNonZeroMacro(calRef) ? formatLineMacroValue(calRef) : "",
    pro: hasNonZeroMacro(proRef) ? formatLineMacroValue(proRef) : "",
    fiber: hasNonZeroMacro(fiberRef)
      ? formatLineMacroValue(fiberRef)
      : hasCalOrPro
        ? formatLineMacroValue(0, { allowZero: true })
        : "",
  };
}

/** Complète les champs vides d'un triplet macro sans écraser les valeurs déjà présentes. */
function fillEmptyMacroTriplet(
  base: { cal: string; pro: string; fiber: string },
  fill: { cal: string; pro: string; fiber: string },
): { cal: string; pro: string; fiber: string } {
  return {
    cal: base.cal || fill.cal,
    pro: base.pro || fill.pro,
    fiber: base.fiber || fill.fiber,
  };
}

/** Indique si une ligne a déjà une macro saisie (le « 0 » placeholder n'est pas considéré comme saisi). */
function lineHasNonZeroMacroField(value: string | undefined): boolean {
  return Boolean(value?.trim()) && hasNonZeroMacro(parseFoodMacroValue(value));
}

// Résout les calories, protéines et fibres d'une ligne à partir du référentiel Macro, du garde-manger ou des recettes existantes.
export function resolveIngredientLineMacros(
  line: Pick<IngLine, "name" | "qty" | "count">,
  sources: IngredientMacroAutofillSources,
): { cal: string; pro: string; fiber: string } {
  if (!normalizeKey(line.name)) return { cal: "", pro: "", fiber: "" };

  let result = { cal: "", pro: "", fiber: "" };

  // Référentiel Macro ingrédients en premier : source canonique /100g pour les lignes de recette.
  const libraryItem = findMacroLibraryItemForIngredientName(sources.macroLibrary, line.name);
  if (libraryItem) {
    result = formatMacroTripletFromRefs(
      parseFoodMacroValue(libraryItem.calories),
      parseFoodMacroValue(libraryItem.protein),
      parseFoodMacroValue(libraryItem.fiber ?? ""),
    );
  }

  const foodItem = findFoodItemForIngredientName(sources.foodItems, line.name);
  if (foodItem) {
    const ref = getExtraMacroReferenceMacros(foodItem);
    result = fillEmptyMacroTriplet(
      result,
      formatMacroTripletFromRefs(
        parseFoodMacroValue(ref.cal),
        parseFoodMacroValue(ref.pro),
        parseFoodMacroValue(ref.fiber),
      ),
    );
  }

  const mealMacro = findMealMacroForIngredientName(sources.mealMacros, line.name);
  if (mealMacro && (mealMacro.cal || mealMacro.pro || mealMacro.fiber || mealMacro.fiber === "0")) {
    const fiberRaw = (mealMacro.fiber ?? "").trim();
    result = fillEmptyMacroTriplet(result, {
      cal: mealMacro.cal || "",
      pro: mealMacro.pro || "",
      fiber: fiberRaw === "" ? "0" : fiberRaw,
    });
  }

  return result;
}

export interface UnParUnMacroDisplay {
  calDisplay: number | null;
  proDisplay: number | null;
  per100Cal: number | null;
  per100Pro: number | null;
  hasGrams: boolean;
}

export interface FoodItemPortionMacros {
  calories: string | null;
  protein: string | null;
  fiber: string | null;
}

/**
 * Trouve l’aliment homonyme d’un repas (préférence is_meal).
 */
function findHomonymFoodItem(
  mealName: string,
  foodItems: FoodItem[] | undefined,
): FoodItem | undefined {
  if (!foodItems?.length || !mealName.trim()) return undefined;
  return (
    foodItems.find((item) => item.is_meal && strictNameMatch(item.name, mealName)) ??
    foodItems.find((item) => strictNameMatch(item.name, mealName))
  );
}

/** Indique si un objet macros portion contient au moins une valeur utile. */
function hasPortionMacros(macros: FoodItemPortionMacros | null | undefined): macros is FoodItemPortionMacros {
  if (!macros) return false;
  return Boolean(macros.calories || macros.protein || macros.fiber);
}

/**
 * Convertit des macros /100 g en macros de portion (grammes × extraRatio).
 * Sans grammage, affiche les valeurs /100 g (repli visible).
 */
function scalePer100MacrosToPortion(
  per100Cal: number,
  per100Pro: number,
  per100Fiber: number,
  grams: number,
  extraRatio: number,
): FoodItemPortionMacros {
  const factor = extraRatio * (grams > 0 ? grams / 100 : 1);
  return {
    calories: hasNonZeroMacro(per100Cal) ? String(Math.round(per100Cal * factor)) : null,
    protein: hasNonZeroMacro(per100Pro) ? String(Math.round(per100Pro * factor)) : null,
    fiber: hasNonZeroMacro(per100Fiber) ? String(Math.round(per100Fiber * factor)) : null,
  };
}

/**
 * Lit des macros déjà en /100 g (Macro ou annotations recettes) et les scale à la portion.
 */
function portionMacrosFromPer100Source(
  cal: string | null | undefined,
  pro: string | null | undefined,
  fiber: string | null | undefined,
  grams: number,
  extraRatio: number,
): FoodItemPortionMacros | null {
  const per100Cal = parseFoodMacroValue(cal);
  const per100Pro = parseFoodMacroValue(pro);
  const per100Fiber = parseFoodMacroValue(fiber);
  if (!hasNonZeroMacro(per100Cal) && !hasNonZeroMacro(per100Pro) && !hasNonZeroMacro(per100Fiber)) {
    return null;
  }
  return scalePer100MacrosToPortion(per100Cal, per100Pro, per100Fiber, grams, extraRatio);
}

/**
 * Trouve un repas catalogue homonyme sans ingrédients (macros saisies sur la fiche Tous).
 */
function findCatalogMealMacros(catalogMeals: Meal[] | undefined, mealName: string): Meal | undefined {
  if (!catalogMeals?.length || !mealName.trim()) return undefined;
  return catalogMeals.find(
    (entry) =>
      strictNameMatch(entry.name, mealName) &&
      !entry.ingredients?.trim() &&
      (hasNonZeroMacro(parseFoodMacroValue(entry.calories)) ||
        hasNonZeroMacro(parseFoodMacroValue(entry.protein)) ||
        hasNonZeroMacro(parseFoodMacroValue(entry.fiber))),
  );
}

/**
 * Recalcule les macros d’un repas via aliment homonyme, Macro, recettes ou catalogue
 * (fiche vide, ex. Nouille protéinée) ; scale selon meal.grams et extraRatio.
 * Fonctionne même si l’aliment a déjà été consommé (plus en stock).
 */
export function computeHomonymFoodMealMacros(
  meal: { name?: string | null; grams?: string | null },
  foodItems: FoodItem[] | undefined,
  macroSources?: IngredientMacroAutofillSources,
  extraRatio: number = 1,
): FoodItemPortionMacros | null {
  const name = meal.name ?? "";
  const extra = extraRatio || 1;
  const mealG = parseQty(meal.grams);
  const prefG = name ? macroSources?.unitGramsByKey?.[normalizeKey(name)] : undefined;
  const gramsForPer100 =
    mealG > 0 ? mealG : typeof prefG === "number" && prefG > 0 ? prefG : 0;

  const fi = findHomonymFoodItem(name, foodItems ?? macroSources?.foodItems);
  if (fi) {
    const unitG =
      parseQty(fi.grams) ||
      (typeof macroSources?.unitGramsByKey?.[normalizeKey(fi.name)] === "number"
        ? macroSources.unitGramsByKey[normalizeKey(fi.name)]
        : 0);
    const gramsRatio = unitG > 0 && mealG > 0 ? mealG / unitG : 1;
    const macros = computeFoodItemPortionMacros(fi, {
      ratio: gramsRatio * extra,
      macroSources,
    });
    if (hasPortionMacros(macros)) return macros;
  }

  const libraryItem = findMacroLibraryItemForIngredientName(macroSources?.macroLibrary, name);
  if (libraryItem) {
    const fromLib = portionMacrosFromPer100Source(
      libraryItem.calories,
      libraryItem.protein,
      libraryItem.fiber,
      gramsForPer100,
      extra,
    );
    if (fromLib) return fromLib;
  }

  const mealMacro = findMealMacroForIngredientName(macroSources?.mealMacros, name);
  if (mealMacro) {
    const fromRecipes = portionMacrosFromPer100Source(
      mealMacro.cal,
      mealMacro.pro,
      mealMacro.fiber,
      gramsForPer100,
      extra,
    );
    if (fromRecipes) return fromRecipes;
  }

  const catalog = findCatalogMealMacros(macroSources?.catalogMeals, name);
  if (catalog) {
    const catG = parseQty(catalog.grams);
    const ratio = catG > 0 && mealG > 0 ? (mealG / catG) * extra : extra;
    const cal = parseFoodMacroValue(catalog.calories);
    const pro = parseFoodMacroValue(catalog.protein);
    const fiber = parseFoodMacroValue(catalog.fiber);
    if (hasNonZeroMacro(cal) || hasNonZeroMacro(pro) || hasNonZeroMacro(fiber)) {
      return {
        calories: hasNonZeroMacro(cal) ? String(Math.round(cal * ratio)) : null,
        protein: hasNonZeroMacro(pro) ? String(Math.round(pro * ratio)) : null,
        fiber: hasNonZeroMacro(fiber) ? String(Math.round(fiber * ratio)) : null,
      };
    }
  }

  return null;
}

/**
 * Calcule les macros d’une portion (1 unité) d’aliment-repas pour les cartes Au choix.
 * Ordre : fiche aliment → référentiel Macro (/100 g × grammage unitaire) → macros recettes.
 */
export function computeFoodItemPortionMacros(
  fi: FoodItem,
  opts?: { ratio?: number; macroSources?: IngredientMacroAutofillSources },
): FoodItemPortionMacros {
  const ratio = opts?.ratio ?? 1;
  /** Formate une macro numérique en chaîne après application du ratio de portion. */
  const scale = (n: number): string => String(Math.round(n * ratio));

  /**
   * Grammes d’une unité : fiche aliment, sinon préférence Macro (g/unité).
   */
  const resolveUnitGrams = (): number => {
    const fromFi = parseQty(fi.grams);
    if (fromFi > 0) return fromFi;
    const key = normalizeKey(fi.name);
    const fromPref = opts?.macroSources?.unitGramsByKey?.[key];
    return typeof fromPref === "number" && fromPref > 0 ? fromPref : 0;
  };

  // 1) Macros déjà sur la fiche → portion unitaire
  const fromFiche = getExtraPortionMacros(fi, { perUnit: true });
  if (fromFiche.cal > 0 || fromFiche.pro > 0 || fromFiche.fiber > 0) {
    return {
      calories: fromFiche.cal > 0 ? scale(fromFiche.cal) : null,
      protein: fromFiche.pro > 0 ? scale(fromFiche.pro) : null,
      fiber: fromFiche.fiber > 0 ? scale(fromFiche.fiber) : null,
    };
  }

  const unitG = resolveUnitGrams();
  const per100Factor = unitG > 0 ? unitG / 100 : 1;

  // 2) Référentiel Macro (/100 g)
  const libraryItem = findMacroLibraryItemForIngredientName(
    opts?.macroSources?.macroLibrary,
    fi.name,
  );
  if (libraryItem) {
    const per100Cal = parseFoodMacroValue(libraryItem.calories);
    const per100Pro = parseFoodMacroValue(libraryItem.protein);
    const per100Fiber = parseFoodMacroValue(libraryItem.fiber);
    if (hasNonZeroMacro(per100Cal) || hasNonZeroMacro(per100Pro) || hasNonZeroMacro(per100Fiber)) {
      return {
        calories: hasNonZeroMacro(per100Cal) ? scale(per100Cal * per100Factor) : null,
        protein: hasNonZeroMacro(per100Pro) ? scale(per100Pro * per100Factor) : null,
        fiber: hasNonZeroMacro(per100Fiber) ? scale(per100Fiber * per100Factor) : null,
      };
    }
  }

  // 3) Macros déjà vues dans des recettes (annotations {cal} [pro]) — valeurs /100 g
  if (opts?.macroSources?.mealMacros?.size) {
    const mealMacro = findMealMacroForIngredientName(opts.macroSources.mealMacros, fi.name);
    if (mealMacro) {
      const calRef = parseFoodMacroValue(mealMacro.cal);
      const proRef = parseFoodMacroValue(mealMacro.pro);
      const fiberRef = parseFoodMacroValue(mealMacro.fiber);
      if (hasNonZeroMacro(calRef) || hasNonZeroMacro(proRef) || hasNonZeroMacro(fiberRef)) {
        return {
          calories: hasNonZeroMacro(calRef) ? scale(calRef * per100Factor) : null,
          protein: hasNonZeroMacro(proRef) ? scale(proRef * per100Factor) : null,
          fiber: hasNonZeroMacro(fiberRef) ? scale(fiberRef * per100Factor) : null,
        };
      }
    }
  }

  // 4) resolveIngredientLineMacros (homonymes / autres sources)
  if (opts?.macroSources) {
    const resolved = resolveIngredientLineMacros(
      { name: fi.name, qty: unitG > 0 ? String(unitG) : "", count: "1" },
      opts.macroSources,
    );
    const calRef = parseFoodMacroValue(resolved.cal);
    const proRef = parseFoodMacroValue(resolved.pro);
    const fiberRef = parseFoodMacroValue(resolved.fiber);
    if (hasNonZeroMacro(calRef) || hasNonZeroMacro(proRef) || hasNonZeroMacro(fiberRef)) {
      return {
        calories: hasNonZeroMacro(calRef) ? scale(calRef * per100Factor) : null,
        protein: hasNonZeroMacro(proRef) ? scale(proRef * per100Factor) : null,
        fiber: hasNonZeroMacro(fiberRef) ? scale(fiberRef * per100Factor) : null,
      };
    }
  }

  // 5) Fiche repas catalogue homonyme (macros totales de la portion Tous)
  const catalog = findCatalogMealMacros(opts?.macroSources?.catalogMeals, fi.name);
  if (catalog) {
    const catG = parseQty(catalog.grams);
    const gramsRatio = catG > 0 && unitG > 0 ? unitG / catG : 1;
    const cal = parseFoodMacroValue(catalog.calories);
    const pro = parseFoodMacroValue(catalog.protein);
    const fiber = parseFoodMacroValue(catalog.fiber);
    if (hasNonZeroMacro(cal) || hasNonZeroMacro(pro) || hasNonZeroMacro(fiber)) {
      return {
        calories: hasNonZeroMacro(cal) ? scale(cal * gramsRatio) : null,
        protein: hasNonZeroMacro(pro) ? scale(pro * gramsRatio) : null,
        fiber: hasNonZeroMacro(fiber) ? scale(fiber * gramsRatio) : null,
      };
    }
  }

  return { calories: null, protein: null, fiber: null };
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
    const hasCal = lineHasNonZeroMacroField(line.cal);
    const hasPro = lineHasNonZeroMacroField(line.pro);
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
