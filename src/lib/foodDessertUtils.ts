import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import { formatNumeric, parseQty } from "@/lib/ingredientUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";
import { getMealMultiple, type StockInfo } from "@/lib/stockUtils";

/** Clé de préférence : ids des aliments marqués « dessert » (extras planning). */
export const DESSERT_FOOD_PREF_KEY = "dessert_food_item_ids";

const FOOD_DESSERT_EXTRA_ID_PREFIX = "food-dessert::";

/** Construit l'id d'extra planning pour un aliment dessert. */
export function buildFoodDessertExtraId(foodItemId: string): string {
  return `${FOOD_DESSERT_EXTRA_ID_PREFIX}${foodItemId}`;
}

/** Extrait l'id aliment depuis un id d'extra dessert, ou null. */
export function parseFoodDessertExtraId(extraId: string): string | null {
  if (!extraId.startsWith(FOOD_DESSERT_EXTRA_ID_PREFIX)) return null;
  const id = extraId.slice(FOOD_DESSERT_EXTRA_ID_PREFIX.length).trim();
  return id || null;
}

/**
 * Construit une recette fictive à un ingrédient pour déduire une unité du stock
 * lors de la sélection d'un dessert dans le planning.
 */
export function buildFoodDessertMealPayload(fi: FoodItem): Meal {
  const perUnit = parseQty(fi.grams);
  const ingredients =
    perUnit > 0 ? `${formatNumeric(perUnit)}g ${fi.name}` : `1 ${fi.name}`;
  const macros = getExtraPortionMacros(fi, { perUnit: true });

  return {
    id: fi.id,
    name: fi.name,
    category: "dessert",
    calories: macros.cal > 0 ? String(macros.cal) : fi.calories,
    protein: macros.pro > 0 ? String(macros.pro) : fi.protein,
    fiber: macros.fiber > 0 ? String(macros.fiber) : fi.fiber,
    grams: perUnit > 0 ? `${formatNumeric(perUnit)}g` : null,
    ingredients,
    sort_order: fi.sort_order ?? 0,
    created_at: fi.created_at ?? "",
    is_available: true,
    is_favorite: false,
    oven_temp: null,
    oven_minutes: null,
  };
}

/** Compte combien de portions dessert restent en stock pour cet aliment. */
export function getFoodDessertStockCount(
  fi: FoodItem,
  stockMap: Map<string, StockInfo>,
): number {
  if (fi.is_infinite) return Infinity;
  const payload = buildFoodDessertMealPayload(fi);
  return Math.max(0, Math.floor(getMealMultiple(payload, stockMap) ?? 0));
}

export interface FoodDessertExtraEntry {
  id: string;
  name: string;
  cal: number;
  prot: number;
  fiber: number;
  mealPayload: Meal;
  foodItemId: string;
  sortExpiry: string | null;
}

/**
 * Construit les entrées extras planning à partir des aliments marqués dessert.
 * Macros par unité ; le décompte stock est fait côté planning via mealPayload.
 */
export function buildFoodDessertExtras(
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
): FoodDessertExtraEntry[] {
  const idSet = new Set(dessertFoodItemIds);

  return foodItems
    .filter((fi) => idSet.has(fi.id))
    .map((fi) => {
      const mealPayload = buildFoodDessertMealPayload(fi);
      const macros = getExtraPortionMacros(fi, { perUnit: true });
      return {
        id: buildFoodDessertExtraId(fi.id),
        name: fi.name,
        cal: macros.cal,
        prot: macros.pro,
        fiber: macros.fiber,
        mealPayload,
        foodItemId: fi.id,
        sortExpiry: fi.expiration_date,
      };
    })
    .sort((a, b) => {
      if (a.sortExpiry && b.sortExpiry) return a.sortExpiry.localeCompare(b.sortExpiry);
      if (a.sortExpiry) return -1;
      if (b.sortExpiry) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
}
