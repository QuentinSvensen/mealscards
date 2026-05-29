import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { normalizeKey, parseIngredientsToLines, serializeIngredients } from "@/lib/ingredientUtils";
import { getExtraMacroBasisLabel, getExtraMacroReferenceMacros, getExtraStoredMacrosFromReference } from "@/lib/extraMacroUtils";

export interface IngredientMacroEntry {
  key: string;
  displayName: string;
  calories: string;
  protein: string;
  recipeCount: number;
  overrideCount: number;
  foodCount: number;
  basisLabel: string | null;
  recipeNames: string[];
  hasConflictingCalories: boolean;
  hasConflictingProtein: boolean;
}

export interface IngredientMacroLibraryItem {
  key: string;
  displayName: string;
  calories: string;
  protein: string;
}

export interface IngredientMacroUpdatePlan {
  mealUpdates: { id: string; ingredients: string }[];
  possibleUpdates: { id: string; ingredients_override: string | null }[];
  foodUpdates: { id: string; calories: string | null; protein: string | null }[];
}

type MacroAccumulator = IngredientMacroEntry & {
  recipeIds: Set<string>;
  overrideIds: Set<string>;
  foodIds: Set<string>;
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
): IngredientMacroLibraryItem | null {
  const displayName = formatIngredientDisplayName(name);
  const key = normalizeKey(displayName);
  if (!key) return null;
  return {
    key,
    displayName,
    calories: calories.trim(),
    protein: protein.trim(),
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
    recipeCount: 0,
    overrideCount: 0,
    foodCount: 0,
    basisLabel: null,
    recipeNames: [],
    hasConflictingCalories: false,
    hasConflictingProtein: false,
    recipeIds: new Set<string>(),
    overrideIds: new Set<string>(),
    foodIds: new Set<string>(),
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
  if (foodItem.grams?.trim()) return "100g";
  if (foodItem.quantity != null && foodItem.quantity > 0) return "Quantité";
  if (foodItem.storage_type === "extras") return getExtraMacroBasisLabel(foodItem);
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
    if (!foodItem.calories?.trim() && !foodItem.protein?.trim()) continue;
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
      if (!calories && !protein) continue;

      const key = normalizeKey(name);
      if (!key) continue;

      const entry = entries.get(key) ?? createMacroAccumulator(key, name);
      mergeMacroValue(entry, sourceId, sourceName, sourceType, calories, protein, getMealLineBasisLabel(line));
      entries.set(key, entry);
    }
  };

  for (const meal of meals) {
    collectFromText(meal.id, meal.name, "recipe", meal.ingredients);
  }

  for (const pm of possibleMeals) {
    collectFromText(pm.id, pm.meals?.name ?? "Possible", "override", pm.ingredients_override);
  }

  for (const foodItem of foodItems) {
    if (!foodItem.name?.trim()) continue;
    const key = normalizeKey(foodItem.name);
    if (!key) continue;
    const entry = entries.get(key);
    if (!entry) continue;
    const basisLabel = getFoodItemBasisLabel(foodItem);
    if (basisLabel) entry.basisLabel = basisLabel;
    entry.foodIds.add(foodItem.id);
    entries.set(key, entry);
  }

  for (const item of macroLibrary) {
    const key = item.key || normalizeKey(item.displayName);
    if (!key) continue;
    const entry = entries.get(key) ?? createMacroAccumulator(key, item.displayName);
    entry.calories = item.calories?.trim() || entry.calories;
    entry.protein = item.protein?.trim() || entry.protein;
    entry.hasConflictingCalories = false;
    entry.hasConflictingProtein = false;
    entries.set(key, entry);
  }

  return [...entries.values()]
    .map(({ recipeIds, overrideIds, foodIds, ...entry }) => ({
      ...entry,
      recipeCount: recipeIds.size,
      overrideCount: overrideIds.size,
      foodCount: foodIds.size,
      recipeNames: entry.recipeNames.sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

// Applique les macros de référence à toutes les occurrences d'un ingrédient dans une chaîne.
export function applyIngredientMacroToText(
  ingredients: string | null | undefined,
  ingredientKey: string,
  calories: string,
  protein: string,
): string | null {
  if (!ingredients?.trim() || !ingredientKey) return null;

  const lines = parseIngredientsToLines(ingredients);
  const nextCalories = calories.trim();
  const nextProtein = protein.trim();
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
  }

  return changed ? serializeIngredients(lines) : null;
}

// Prépare toutes les mises à jour nécessaires pour synchroniser un ingrédient partout.
export function buildIngredientMacroUpdatePlan(
  meals: Meal[],
  possibleMeals: PossibleMeal[],
  foodItems: FoodItem[],
  ingredientKey: string,
  calories: string,
  protein: string,
): IngredientMacroUpdatePlan {
  const mealUpdates = meals.flatMap((meal) => {
    const ingredients = applyIngredientMacroToText(meal.ingredients, ingredientKey, calories, protein);
    return ingredients === null ? [] : [{ id: meal.id, ingredients }];
  });

  const possibleUpdates = possibleMeals.flatMap((pm) => {
    if (pm.ingredients_override == null) return [];
    const ingredients_override = applyIngredientMacroToText(pm.ingredients_override, ingredientKey, calories, protein);
    return ingredients_override === null ? [] : [{ id: pm.id, ingredients_override }];
  });

  const nextCalories = calories.trim() || null;
  const nextProtein = protein.trim() || null;
  const foodUpdates = foodItems.flatMap((foodItem) => {
    if (normalizeKey(foodItem.name || "") !== ingredientKey) return [];
    const storedMacros = getExtraStoredMacrosFromReference(foodItem, calories, protein);
    if ((foodItem.calories ?? null) === storedMacros.calories && (foodItem.protein ?? null) === storedMacros.protein) return [];
    return [{ id: foodItem.id, calories: storedMacros.calories, protein: storedMacros.protein }];
  });

  return { mealUpdates, possibleUpdates, foodUpdates };
}
