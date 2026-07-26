/**
 * Helpers de tri pour les listes Repas (Tous / Au choix) :
 * note nutritionnelle et indice de satiété, avec croissant / décroissant.
 */
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import { getMealNutritionScore } from "@/lib/nutritionScore";
import { getMealSatietyIndex } from "@/lib/satietyIndex";
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
