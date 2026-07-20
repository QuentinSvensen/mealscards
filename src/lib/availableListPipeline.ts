/**
 * Pipeline pur de la liste « Au choix ».
 *
 * Entrée : listes sources (available / partial / nameMatches / isMeal),
 * prefs (recherche, calories restantes, tri, ratios), helpers macros.
 * Sortie : liste unifiée triée + métadonnées expiration pour les séparateurs.
 *
 * Pas de React ici — uniquement calcul déterministe pour useMemo côté composant.
 */
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { normalizeForMatch, computeCounterDays } from "@/lib/ingredientUtils";
import {
  analyzeMealIngredients,
  compareExpirationWithCounter,
  type FoodItemIndex,
} from "@/lib/stockUtils";

/** Correspondance repas sans ingrédients ↔ aliment en stock. */
export type AvailableNameMatch = {
  meal: Meal;
  fi: FoodItem;
  portionsAvailable: number | null;
};

/** Recette complète réalisable. */
export type AvailableFullItem = {
  meal: Meal;
  multiple: number | null;
  calculatedRatio?: number;
};

/** Recette partielle (ratio stock < 1). */
export type AvailablePartialItem = {
  meal: Meal;
  ratio: number;
  calculatedRatio?: number;
};

/** Buckets typés pour les aliments is_meal (évite le hack `__withDate`). */
export type IsMealBuckets = {
  withoutDate: FoodItem[];
  withDate: FoodItem[];
};

/** Élément unifié de la liste Au choix. */
export type UnifiedAvail =
  | {
      type: "isMeal";
      key: string;
      fi: FoodItem;
      sortDate: string | null;
      sortCounter: number | null;
      sortCalories: number | null;
    }
  | {
      type: "nm";
      key: string;
      nm: AvailableNameMatch;
      nmIdx: number;
      sortDate: string | null;
      sortCounter: number | null;
      sortCalories: number | null;
    }
  | {
      type: "av";
      key: string;
      item: AvailableFullItem;
      sortDate: string | null;
      sortCounter: number | null;
      sortCalories: number | null;
    }
  | {
      type: "partial";
      key: string;
      item: AvailablePartialItem;
      sortDate: string | null;
      sortCounter: number | null;
      sortCalories: number | null;
    };

export type AvailableSortMode = "manual" | "calories" | "protein" | "expiration";

/** Helpers injectés depuis AvailableList (macros / budget calories). */
export type UnifiedPipelineHelpers = {
  getAvailableSortMacroValue: (meal: Meal, field: "calories" | "protein", ratio?: number) => number;
  buildIsMealCalorieMeal: (fi: FoodItem) => Meal;
  buildNameMatchCalorieMeal: (nm: AvailableNameMatch) => Meal;
  tryFitMeal: (meal: Meal, overrideRatio: number | null, isScalable?: boolean) => { show: boolean; newRatio: number | null };
  matchesShowOnlyFullRemainingRecipes: (
    u: UnifiedAvail,
    localCalculatedRatios: Record<string, number>,
  ) => boolean;
};

export type BuildUnifiedAvailableItemsParams = {
  sortedAvailable: AvailableFullItem[];
  sortedNameMatches: AvailableNameMatch[];
  isMealBuckets: IsMealBuckets;
  partialAvailable: AvailablePartialItem[];
  searchQuery: string;
  useRemainingCalories: boolean;
  showOnlyFullRemainingRecipes: boolean;
  customRatios: Record<string, number>;
  sortMode: AvailableSortMode;
  sortAsc: boolean;
  storedOrder: string[];
  foodItems: FoodItem[];
  foodItemIndex: FoodItemIndex;
  helpers: UnifiedPipelineHelpers;
};

/**
 * Sépare les aliments is_meal avec / sans date de péremption.
 */
export function splitIsMealByExpiration(items: FoodItem[]): IsMealBuckets {
  return {
    withoutDate: items.filter((fi) => !fi.expiration_date),
    withDate: items.filter((fi) => !!fi.expiration_date),
  };
}

/**
 * Filtre un item unifié selon la requête de recherche (nom + ingrédients).
 */
export function matchesUnifiedSearch(u: UnifiedAvail, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true;
  const q = normalizeForMatch(searchQuery);
  const name =
    u.type === "isMeal"
      ? normalizeForMatch(u.fi.name)
      : u.type === "nm"
        ? normalizeForMatch(u.nm.meal.name)
        : normalizeForMatch(u.item.meal.name);
  if (name.includes(q)) return true;
  if (u.type === "av" || u.type === "partial") {
    const ing = normalizeForMatch(u.item.meal.ingredients ?? "");
    if (ing.includes(q)) return true;
  }
  return false;
}

/**
 * Nom affiché d'un item unifié (tri / tie-breakers).
 */
export function getUnifiedItemName(u: UnifiedAvail): string {
  if (u.type === "isMeal") return u.fi.name ?? "";
  if (u.type === "nm") return u.nm.meal.name ?? "";
  return u.item.meal.name ?? "";
}

/**
 * Fusionne, filtre et trie toutes les sources Au choix en une liste unique.
 * Inclut le tri cross-type expiration (anciennement dupliqué dans le JSX).
 */
export function buildUnifiedAvailableItems(params: BuildUnifiedAvailableItemsParams): UnifiedAvail[] {
  const {
    sortedAvailable,
    sortedNameMatches,
    isMealBuckets,
    partialAvailable,
    searchQuery,
    useRemainingCalories,
    showOnlyFullRemainingRecipes,
    customRatios,
    sortMode,
    sortAsc,
    storedOrder,
    foodItems,
    foodItemIndex,
    helpers,
  } = params;
  const {
    getAvailableSortMacroValue,
    buildIsMealCalorieMeal,
    buildNameMatchCalorieMeal,
    tryFitMeal,
    matchesShowOnlyFullRemainingRecipes,
  } = helpers;

  const allIsMeal =
    sortMode === "expiration"
      ? [...isMealBuckets.withoutDate, ...isMealBuckets.withDate]
      : [...isMealBuckets.withoutDate, ...isMealBuckets.withDate];

  let items: UnifiedAvail[] = [
    ...sortedNameMatches.map((nm, i) => ({
      type: "nm" as const,
      key: `nm-${nm.meal.id}-${nm.fi.id}`,
      nm,
      nmIdx: i,
      sortDate: nm.fi.expiration_date,
      sortCounter: computeCounterDays(nm.fi.counter_start_date),
      sortCalories: getAvailableSortMacroValue(buildNameMatchCalorieMeal(nm), "calories"),
    })),
    ...sortedAvailable.map((item) => {
      const an = analyzeMealIngredients(item.meal, foodItems, foodItemIndex);
      const ratio = customRatios[item.meal.id] ?? 1;
      return {
        type: "av" as const,
        key: item.meal.id,
        item,
        sortDate: an.earliestExpiration,
        sortCounter: an.maxIngredientCounter,
        sortCalories: getAvailableSortMacroValue(item.meal, "calories", ratio),
      };
    }),
    ...partialAvailable.map((item) => {
      const an = analyzeMealIngredients(item.meal, foodItems, foodItemIndex);
      const ratio = customRatios[`partial-${item.meal.id}`] ?? item.ratio;
      return {
        type: "partial" as const,
        key: `partial-${item.meal.id}`,
        item,
        sortDate: an.earliestExpiration,
        sortCounter: an.maxIngredientCounter,
        sortCalories: getAvailableSortMacroValue(item.meal, "calories", ratio),
      };
    }),
    ...allIsMeal.map((fi) => ({
      type: "isMeal" as const,
      key: `fi-${fi.id}`,
      fi,
      sortDate: fi.expiration_date,
      sortCounter: computeCounterDays(fi.counter_start_date),
      sortCalories: getAvailableSortMacroValue(buildIsMealCalorieMeal(fi), "calories"),
    })),
  ];

  if (searchQuery.trim()) {
    items = items.filter((u) => matchesUnifiedSearch(u, searchQuery));
  }

  const localCalculatedRatios: Record<string, number> = {};

  if (useRemainingCalories) {
    items = items.filter((u) => {
      if (showOnlyFullRemainingRecipes) {
        return matchesShowOnlyFullRemainingRecipes(u, localCalculatedRatios);
      }
      if (u.type === "isMeal") {
        return tryFitMeal(buildIsMealCalorieMeal(u.fi), 1, false).show;
      }
      if (u.type === "nm") {
        return tryFitMeal(buildNameMatchCalorieMeal(u.nm), 1, false).show;
      }
      if (u.type === "av") {
        const ratioToTry = customRatios[u.item.meal.id] ?? 1;
        const fitResult = tryFitMeal(u.item.meal, ratioToTry);
        if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
          localCalculatedRatios[u.item.meal.id] = fitResult.newRatio;
        }
        return fitResult.show;
      }
      if (u.type === "partial") {
        const ratioToTry = customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
        const fitResult = tryFitMeal(u.item.meal, ratioToTry);
        if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
          localCalculatedRatios[`partial-${u.item.meal.id}`] = fitResult.newRatio;
        }
        return fitResult.show;
      }
      return true;
    });

    items = items.map((u) => {
      if (u.type === "av" && localCalculatedRatios[u.item.meal.id] !== undefined) {
        return {
          ...u,
          item: { ...u.item, calculatedRatio: localCalculatedRatios[u.item.meal.id] },
        };
      }
      if (u.type === "partial" && localCalculatedRatios[`partial-${u.item.meal.id}`] !== undefined) {
        return {
          ...u,
          item: { ...u.item, calculatedRatio: localCalculatedRatios[`partial-${u.item.meal.id}`] },
        };
      }
      return u;
    });
  }

  if (sortMode === "manual" && storedOrder.length > 0) {
    const orderMap = new Map(storedOrder.map((k: string, i: number) => [k, i]));
    items.sort((a, b) => {
      const aIsMeal = a.type === "isMeal" ? 1 : 0;
      const bIsMeal = b.type === "isMeal" ? 1 : 0;
      if (aIsMeal !== bIsMeal) return aIsMeal - bIsMeal;
      return (orderMap.get(a.key) ?? Infinity) - (orderMap.get(b.key) ?? Infinity);
    });
  } else if (sortMode === "calories" || sortMode === "protein") {
    const dir = sortAsc ? 1 : -1;
    const getVal = (u: UnifiedAvail): number => {
      if (sortMode === "calories") {
        if (u.type === "isMeal") return getAvailableSortMacroValue(buildIsMealCalorieMeal(u.fi), "calories");
        if (u.type === "nm") return getAvailableSortMacroValue(buildNameMatchCalorieMeal(u.nm), "calories");
        if (u.type === "av") {
          const ratio = u.item.calculatedRatio ?? customRatios[u.item.meal.id] ?? 1;
          return getAvailableSortMacroValue(u.item.meal, "calories", ratio);
        }
        if (u.type === "partial") {
          const ratio = u.item.calculatedRatio ?? customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
          return getAvailableSortMacroValue(u.item.meal, "calories", ratio);
        }
        return 0;
      }
      if (u.type === "isMeal") return getAvailableSortMacroValue(buildIsMealCalorieMeal(u.fi), "protein");
      if (u.type === "nm") return getAvailableSortMacroValue(buildNameMatchCalorieMeal(u.nm), "protein");
      if (u.type === "av") {
        const ratio = u.item.calculatedRatio ?? customRatios[u.item.meal.id] ?? 1;
        return getAvailableSortMacroValue(u.item.meal, "protein", ratio);
      }
      if (u.type === "partial") {
        const ratio = u.item.calculatedRatio ?? customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
        return getAvailableSortMacroValue(u.item.meal, "protein", ratio);
      }
      return 0;
    };
    items.sort((a, b) => {
      const aPinnedBottom = a.type === "isMeal" && !a.fi.expiration_date ? 1 : 0;
      const bPinnedBottom = b.type === "isMeal" && !b.fi.expiration_date ? 1 : 0;
      if (aPinnedBottom !== bPinnedBottom) return aPinnedBottom - bPinnedBottom;
      return dir * (getVal(a) - getVal(b));
    });
  } else if (sortMode === "expiration") {
    items.sort((a, b) => {
      const aPinnedBottom = a.type === "isMeal" && !a.sortDate ? 1 : 0;
      const bPinnedBottom = b.type === "isMeal" && !b.sortDate ? 1 : 0;
      if (aPinnedBottom !== bPinnedBottom) return aPinnedBottom - bPinnedBottom;

      const baseCmp = compareExpirationWithCounter(a.sortDate, b.sortDate, a.sortCounter, b.sortCounter);
      if (baseCmp !== 0) return baseCmp;

      const aFav =
        a.type === "nm" ? !!a.nm.meal.is_favorite : a.type === "av" || a.type === "partial" ? !!a.item.meal.is_favorite : false;
      const bFav =
        b.type === "nm" ? !!b.nm.meal.is_favorite : b.type === "av" || b.type === "partial" ? !!b.item.meal.is_favorite : false;
      if (aFav !== bFav) return aFav ? -1 : 1;

      if (a.sortCalories !== null && b.sortCalories !== null && a.sortCalories !== b.sortCalories) {
        return a.sortCalories - b.sortCalories;
      }
      if (a.sortCalories !== null && b.sortCalories === null) return -1;
      if (a.sortCalories === null && b.sortCalories !== null) return 1;

      return getUnifiedItemName(a).localeCompare(getUnifiedItemName(b));
    });
  } else if (sortMode === "manual" && storedOrder.length === 0) {
    items.sort((a, b) => {
      const aIsMeal = a.type === "isMeal" ? 1 : 0;
      const bIsMeal = b.type === "isMeal" ? 1 : 0;
      return aIsMeal - bIsMeal;
    });
  }

  return items;
}
