import type { FoodItem } from "@/hooks/useFoodItems";
import { getAdaptedCounterDays } from "@/lib/ingredientUtils";
import type { FoodItemIndex } from "./foodItemIndex";
import { getRecipeMaxActiveFoodCounterDays } from "./counterBadge";

/** Clé user_preferences : jours de compteur figés par id de `possible_meals` (`null` = pas de badge). */
export const POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY = "possible_frozen_counter_days";

/** Map pmId → jours figés (`null` = gel sans badge, clé absente = pas encore gelé). */
export type PossibleFrozenCounterDaysMap = Record<string, number | null>;

/**
 * Calcule la valeur à figer sur une carte Possible (max des compteurs Aliments ouverts).
 * Même logique que `getRecipeMaxActiveFoodCounterDays` — à appeler uniquement au moment du gel
 * (arrivée en Possible, ou re-gel one-shot quand on pose jour+créneau), jamais pour l’affichage live.
 *
 * `baseStartDate` (optionnel) : vraie ouverture passée / snapshot (ex. ven. 19h) quand le stock
 * est déjà en Prog. sur le créneau du repas — permet de recalculer 1j (sam. soir) même après Prog.
 */
export function computePossibleFrozenCounterDays(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
  dayKey?: string | null,
  mealTime?: string | null,
  createdAt?: string,
  baseStartDate?: string | null,
): number | null {
  const fromFoods = getRecipeMaxActiveFoodCounterDays(
    ingredients, foodItems, index, fixedNow, dayKey, mealTime, createdAt,
  );
  if (!dayKey?.trim() || !baseStartDate?.trim()) return fromFoods;
  const fromBase = getAdaptedCounterDays(
    baseStartDate, dayKey, createdAt, mealTime, fixedNow,
  );
  if (fromBase === null) return fromFoods;
  if (fromFoods === null) return fromBase;
  return Math.max(fromFoods, fromBase);
}

/**
 * Indique si un gel a déjà été enregistré pour cette carte Possible (y compris `null` = pas de badge).
 */
export function hasFrozenPossibleCounter(
  map: PossibleFrozenCounterDaysMap | null | undefined,
  pmId: string,
): boolean {
  return !!map && Object.prototype.hasOwnProperty.call(map, pmId);
}

/**
 * Lit la valeur figée du badge compteur ; `undefined` si aucun gel n’existe encore pour cette carte.
 */
export function readFrozenPossibleCounterDays(
  map: PossibleFrozenCounterDaysMap | null | undefined,
  pmId: string,
): number | null | undefined {
  if (!hasFrozenPossibleCounter(map, pmId)) return undefined;
  return map![pmId];
}

/**
 * Infobulle du badge compteur figé sur une carte Possible (`undefined` si pas de badge).
 */
export function formatFrozenPossibleCounterTooltip(days: number | null | undefined): string | undefined {
  if (days === null || days === undefined) return undefined;
  return `${days}j (figé)`;
}

/**
 * Fusionne une nouvelle valeur de gel avec l’ancienne pour un pmId.
 * - `null` calculé n’écrase jamais une valeur numérique déjà figée (évite la disparition du badge
 *   après passage des aliments en Prog.).
 * - Un nouveau nombre remplace toujours l’ancien (re-planif dimanche→samedi : 2j → 1j).
 * - Sinon → la nouvelle valeur (`null` si rien n’était figé).
 */
export function mergeFrozenPossibleCounterDays(
  existing: number | null | undefined,
  computed: number | null,
): number | null {
  if (computed === null && typeof existing === "number") return existing;
  return computed;
}

