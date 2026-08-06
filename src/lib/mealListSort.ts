/**
 * Helpers de tri pour les listes Repas (Tous / Au choix) :
 * note nutritionnelle et indice de satiété, avec croissant / décroissant.
 */
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import { getMealNutritionScore } from "@/lib/nutritionScore";
import { getMealSatietyIndex } from "@/lib/satietyIndex";
import { getDisplayedCalories } from "@/lib/stock/displayedMacros";
import type { Meal } from "@/hooks/useMeals";

/** Modes de tri catalogue Master (Tous). */
export type MasterSortMode =
  | "manual"
  | "calories"
  | "protein"
  | "note"
  | "satiety"
  | "favorites"
  | "ingredients";

/** Modes de tri Au choix (Available). */
export type AvailableSortMode =
  | "manual"
  | "calories"
  | "protein"
  | "note"
  | "satiety"
  | "expiration";

/** Options pour le tri catalogue Master. */
export type SortMealsByMasterModeOptions = {
  /** true = croissant (défaut), false = décroissant. */
  ascending?: boolean;
  /** Filtre stock pour la note (aligné MealCard). */
  isIngredientAvailable?: (name: string) => boolean;
  /** Sources macros pour l’indice de satiété. */
  satietySources?: IngredientMacroAutofillSources;
};

/**
 * Compare deux valeurs numériques optionnelles pour un tri croissant/décroissant.
 * Les valeurs manquantes (null/undefined) sont poussées en fin de liste ;
 * en cas d'égalité, départage par nom (locale fr).
 */
export function compareNullableSortValues(
  aVal: number | null | undefined,
  bVal: number | null | undefined,
  ascending: boolean,
  nameA: string,
  nameB: string,
): number {
  const byName = () => nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
  if (aVal == null && bVal == null) return byName();
  if (aVal == null) return 1;
  if (bVal == null) return -1;
  if (aVal !== bVal) return (ascending ? 1 : -1) * (aVal - bVal);
  return byName();
}

/**
 * Compare deux repas par note nutritionnelle affichée sur les cartes.
 * Valeurs manquantes en fin ; tie-break par nom.
 */
export function compareMealsByNutritionNote(
  a: Meal,
  b: Meal,
  ascending: boolean,
  isAvailable?: (name: string) => boolean,
): number {
  return compareNullableSortValues(
    getMealNutritionScore(a, isAvailable),
    getMealNutritionScore(b, isAvailable),
    ascending,
    a.name ?? "",
    b.name ?? "",
  );
}

/**
 * Compare deux repas par indice de satiété (carte, sur 100).
 * Valeurs manquantes en fin ; tie-break par nom.
 * Aligné MealCard : sources macros optionnelles, sans filtre stock par défaut.
 */
export function compareMealsBySatiety(
  a: Meal,
  b: Meal,
  ascending: boolean,
  sources?: IngredientMacroAutofillSources,
  isAvailable?: (name: string) => boolean,
): number {
  return compareNullableSortValues(
    getMealSatietyIndex(a, sources, isAvailable),
    getMealSatietyIndex(b, sources, isAvailable),
    ascending,
    a.name ?? "",
    b.name ?? "",
  );
}

/**
 * Parse les protéines d’un repas (nombre ; 0 si invalide).
 */
function parseMealProtein(meal: Meal): number {
  return parseFloat((meal.protein || "0").replace(/[^0-9.]/g, "")) || 0;
}

/**
 * Compte les groupes d’ingrédients d’un repas (séparateurs virgule / saut de ligne).
 */
function countMealIngredientGroups(meal: Meal): number {
  return meal.ingredients ? meal.ingredients.split(/[,\n]+/).filter(Boolean).length : 0;
}

/**
 * Trie une liste de repas catalogue comme la liste « Tous »
 * (manuel, calories, protéines, note, satiété, favoris, ingrédients).
 */
export function sortMealsByMasterMode(
  meals: Meal[],
  mode: MasterSortMode,
  options: SortMealsByMasterModeOptions = {},
): Meal[] {
  if (mode === "manual") return meals;
  const ascending = options.ascending !== false;
  const items = [...meals];

  if (mode === "calories") {
    return items.sort((a, b) => {
      const ca = getDisplayedCalories(a) ?? 0;
      const cb = getDisplayedCalories(b) ?? 0;
      return ascending ? ca - cb : cb - ca;
    });
  }
  if (mode === "protein") {
    return items.sort((a, b) => {
      const pa = parseMealProtein(a);
      const pb = parseMealProtein(b);
      return ascending ? pa - pb : pb - pa;
    });
  }
  if (mode === "note") {
    return items.sort((a, b) =>
      compareMealsByNutritionNote(a, b, ascending, options.isIngredientAvailable),
    );
  }
  if (mode === "satiety") {
    return items.sort((a, b) =>
      compareMealsBySatiety(a, b, ascending, options.satietySources),
    );
  }
  if (mode === "favorites") {
    return items.sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
  }
  if (mode === "ingredients") {
    return items.sort(
      (a, b) => countMealIngredientGroups(a) - countMealIngredientGroups(b),
    );
  }
  return meals;
}

/**
 * Passe au mode de tri Master suivant :
 * Manuel → Calories → Protéines → Note → Satiété → Favoris → Ingrédients → Manuel.
 */
export function cycleMasterSortMode(mode: MasterSortMode): MasterSortMode {
  if (mode === "manual") return "calories";
  if (mode === "calories") return "protein";
  if (mode === "protein") return "note";
  if (mode === "note") return "satiety";
  if (mode === "satiety") return "favorites";
  if (mode === "favorites") return "ingredients";
  return "manual";
}

/**
 * Passe au mode de tri Available suivant :
 * Manuel → Calories → Protéines → Note → Satiété → Péremption → Manuel.
 */
export function cycleAvailableSortMode(mode: AvailableSortMode): AvailableSortMode {
  if (mode === "manual") return "calories";
  if (mode === "calories") return "protein";
  if (mode === "protein") return "note";
  if (mode === "note") return "satiety";
  if (mode === "satiety") return "expiration";
  return "manual";
}
