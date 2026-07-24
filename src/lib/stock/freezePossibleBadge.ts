import type { FoodItem } from "@/types/food";
import type { FoodItemIndex } from "./foodItemIndex";
import {
  computePossibleFrozenCounterDays,
  resolveFrozenPossibleCounterDays,
  isLotProgOpeningAtMealSlot,
  hasNoFoodCounterEvidenceWhileStockRemains,
  POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
  type PossibleFrozenCounterDaysMap,
} from "./possibleFrozenCounters";

export type BuildFrozenBadgePreferenceParams = {
  pmId: string;
  ingredients: string | null | undefined;
  foodItems: FoodItem[];
  /** Index macros / matching aliments (alias historique `foodMacroIndex`). */
  index?: FoodItemIndex;
  dayKey?: string | null;
  mealTime?: string | null;
  createdAt?: string;
  baseStartDate?: string | null;
  currentMap: PossibleFrozenCounterDaysMap;
};

/**
 * Construit l’entrée de préférence `{ key, value }` pour figer le badge compteur d’une carte Possible.
 * Pure : ne lit ni n’écrit les prefs — l’appelant fournit `currentMap` et applique le résultat.
 */
export function buildFrozenBadgePreferenceEntry(
  params: BuildFrozenBadgePreferenceParams,
): { key: string; value: PossibleFrozenCounterDaysMap } {
  const {
    pmId,
    ingredients,
    foodItems,
    index,
    dayKey,
    mealTime,
    createdAt,
    baseStartDate,
    currentMap,
  } = params;
  const days = computePossibleFrozenCounterDays(
    ingredients,
    foodItems,
    index,
    undefined,
    dayKey,
    mealTime,
    createdAt,
    baseStartDate,
  );
  const lotProgAtSlot = isLotProgOpeningAtMealSlot(
    ingredients, foodItems, dayKey, mealTime, index,
  );
  // Stock présent sans aucun compteur → effacer un Xj fantôme (ex. Cookie replanif ven.→dim.).
  const noFoodCounterEvidence = hasNoFoodCounterEvidenceWhileStockRemains(
    ingredients, foodItems, index,
  );
  const merged = resolveFrozenPossibleCounterDays(currentMap[pmId], days, {
    baseStartDate,
    dayKey,
    mealTime,
    lotProgOpensAtThisSlot: lotProgAtSlot,
    noFoodCounterEvidence,
  });
  return {
    key: POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
    value: { ...currentMap, [pmId]: merged },
  };
}

/** Alias explicite (même logique) pour les appels qui préfèrent ce nom. */
export const buildFreezePossibleBadgePreference = buildFrozenBadgePreferenceEntry;

/**
 * Construit l’entrée de préférence pour supprimer le gel d’une carte Possible.
 * Retourne `null` si la clé est absente (rien à écrire).
 */
export function buildClearFrozenBadgePreferenceEntry(
  pmId: string,
  currentMap: PossibleFrozenCounterDaysMap,
): { key: string; value: PossibleFrozenCounterDaysMap } | null {
  if (!Object.prototype.hasOwnProperty.call(currentMap, pmId)) return null;
  const { [pmId]: _removed, ...rest } = currentMap;
  return { key: POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, value: rest };
}

/**
 * Construit l’entrée de préférence pour copier le gel d’une carte source vers une cible.
 * Retourne `null` si la source n’a pas d’entrée.
 */
export function buildCopyFrozenBadgePreferenceEntry(
  sourcePmId: string,
  targetPmId: string,
  currentMap: PossibleFrozenCounterDaysMap,
): { key: string; value: PossibleFrozenCounterDaysMap } | null {
  if (!Object.prototype.hasOwnProperty.call(currentMap, sourcePmId)) return null;
  return {
    key: POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
    value: { ...currentMap, [targetPmId]: currentMap[sourcePmId] },
  };
}
