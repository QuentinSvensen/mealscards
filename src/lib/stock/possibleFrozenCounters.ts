import type { FoodItem } from "@/types/food";
import {
  getAdaptedCounterDays,
  formatPlannedCounterOpenFr,
  getTargetDate,
} from "@/lib/ingredientUtils";
import { parseISO } from "date-fns";
import type { FoodItemIndex } from "./foodItemIndex";
import {
  findEarliestActiveCounterDate,
  findEarliestFutureCounterDate,
  getRecipeMaxActiveFoodCounterDays,
  recipeHasMatchingFoodItemsInStock,
} from "./counterBadge";

/** Clé user_preferences : jours de compteur figés par id de `possible_meals` (`null` = pas de badge). */
export const POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY = "possible_frozen_counter_days";

/** Map pmId → jours figés (`null` = gel sans badge, clé absente = pas encore gelé). */
export type PossibleFrozenCounterDaysMap = Record<string, number | null>;

/**
 * Indique si la date de début du compteur coïncide avec le créneau planifié (±1 min).
 * Sert à détecter « cette carte ouvre le lot à son Midi/Soir » (badge attendu = absent).
 */
export function isCounterStartAlignedWithMealSlot(
  startIso: string | null | undefined,
  dayKey?: string | null,
  mealTime?: string | null,
  fixedNow?: Date,
): boolean {
  if (!startIso?.trim() || !dayKey?.trim()) return false;
  const start = parseISO(startIso);
  if (Number.isNaN(start.getTime())) return false;
  const target = getTargetDate(dayKey, fixedNow ?? new Date(), null, mealTime);
  return Math.abs(target.getTime() - start.getTime()) <= 60_000;
}

/**
 * Indique si le lot n’a plus qu’un compteur Prog. aligné sur le créneau de cette carte
 * (cette carte ouvre le lot → aucun badge Xj légitime, même avec un baseStartDate carte périmé).
 */
export function isLotProgOpeningAtMealSlot(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  dayKey?: string | null,
  mealTime?: string | null,
  index?: FoodItemIndex,
  fixedNow?: Date,
): boolean {
  if (!dayKey?.trim()) return false;
  if (findEarliestActiveCounterDate(ingredients, foodItems, index, fixedNow)) return false;
  const prog = findEarliestFutureCounterDate(ingredients, foodItems, index, fixedNow);
  if (!prog) return false;
  return isCounterStartAlignedWithMealSlot(prog, dayKey, mealTime, fixedNow);
}

/**
 * Calcule la valeur à figer sur une carte Possible (max des compteurs Aliments ouverts).
 * Même logique que `getRecipeMaxActiveFoodCounterDays` — à appeler uniquement au moment du gel
 * (arrivée en Possible, ou re-gel one-shot quand on pose jour+créneau), jamais pour l’affichage live.
 *
 * `baseStartDate` (optionnel) :
 * - renforce un compteur déjà dérivé des aliments (ex. ven. 19h → sam. soir = 1j) ;
 * - OU, s’il est encore FUTUR et non aligné sur CE créneau, sert d’ouverture héritée d’une
 *   autre carte planifiée plus tôt (ex. Sandwich jeu. → Pâtes ven. = 1j) même si le lot
 *   unitaire n’a pas encore de `counter_start_date` en base (l’UI Aliments montre déjà « Prog. »).
 * Un `baseStartDate` passé seul (Cookie replanif ven.→dim.) ne crée pas de badge fantôme.
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
  // Stock uniquement en Prog. sur le créneau de cette carte → pas de badge Xj
  // (ex. Sandwich + Blanc de dinde Prog. au même soir : l’ancien baseStartDate carte ne doit pas refaire un 7j).
  if (isLotProgOpeningAtMealSlot(ingredients, foodItems, dayKey, mealTime, index, fixedNow)) {
    return null;
  }

  const fromFoods = getRecipeMaxActiveFoodCounterDays(
    ingredients, foodItems, index, fixedNow, dayKey, mealTime, createdAt,
  );
  if (fromFoods === null) {
    // Sans compteur DB : n’accepter qu’une ouverture FUTURE héritée (autre carte plus tôt).
    if (!dayKey?.trim() || !baseStartDate?.trim()) return null;
    const start = parseISO(baseStartDate);
    const nowMs = (fixedNow ?? new Date()).getTime();
    if (Number.isNaN(start.getTime()) || start.getTime() <= nowMs) return null;
    if (isCounterStartAlignedWithMealSlot(baseStartDate, dayKey, mealTime, fixedNow)) return null;
    return getAdaptedCounterDays(baseStartDate, dayKey, createdAt, mealTime, fixedNow);
  }
  if (!dayKey?.trim() || !baseStartDate?.trim()) return fromFoods;
  const fromBase = getAdaptedCounterDays(
    baseStartDate, dayKey, createdAt, mealTime, fixedNow,
  );
  if (fromBase === null) return fromFoods;
  return Math.max(fromFoods, fromBase);
}

/**
 * Jours de compteur à afficher sur une carte Possible : la valeur figée si elle existe,
 * sinon repli sur l’ouverture future héritée d’une carte planifiée plus tôt
 * (ex. « Sandwich » jeu. 19h entame le lot → « Pâtes jambon » ven. soir = 1j, ven. midi = 0j),
 * même quand le gel a échoué faute de `counter_start_date` en base sur l’aliment.
 */
export function resolveDisplayedPossibleCounterDays(
  frozenDays: number | null | undefined,
  inheritedFutureOpeningIso: string | null | undefined,
  dayKey?: string | null,
  mealTime?: string | null,
  fixedNow?: Date,
): number | null {
  if (typeof frozenDays === "number") return frozenDays;
  if (!inheritedFutureOpeningIso?.trim() || !dayKey?.trim()) return frozenDays ?? null;
  const start = parseISO(inheritedFutureOpeningIso);
  const nowMs = (fixedNow ?? new Date()).getTime();
  if (Number.isNaN(start.getTime()) || start.getTime() <= nowMs) return frozenDays ?? null;
  // Ouverture alignée sur CE créneau = cette carte ouvre le lot → pas de badge.
  if (isCounterStartAlignedWithMealSlot(inheritedFutureOpeningIso, dayKey, mealTime, fixedNow)) {
    return frozenDays ?? null;
  }
  const days = getAdaptedCounterDays(
    inheritedFutureOpeningIso, dayKey, undefined, mealTime, fixedNow,
  );
  return days !== null ? days : (frozenDays ?? null);
}

/**
 * Indique s’il faut masquer un badge Xj figé faute de compteur aliment réel (actif ou Prog.).
 * - Lot uniquement Prog. sur CE créneau → masquer.
 * - Fiches stock encore présentes mais sans aucun compteur → masquer (fantôme replanif Cookie),
 *   SAUF si `inheritedFutureOpeningIso` prouve une ouverture Prog. héritée d’une carte plus tôt.
 * - Stock entièrement consommé (plus de fiche) → ne pas masquer (conserver le figé légitime).
 */
export function shouldSuppressFrozenPossibleCounterBadge(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  dayKey?: string | null,
  mealTime?: string | null,
  index?: FoodItemIndex,
  fixedNow?: Date,
  inheritedFutureOpeningIso?: string | null,
): boolean {
  if (isLotProgOpeningAtMealSlot(ingredients, foodItems, dayKey, mealTime, index, fixedNow)) {
    return true;
  }
  if (findEarliestActiveCounterDate(ingredients, foodItems, index, fixedNow)) return false;
  if (findEarliestFutureCounterDate(ingredients, foodItems, index, fixedNow)) return false;
  // Ouverture future héritée (affichage Aliments « Prog. » sans counter DB) → badge Xj / 0j légitime.
  if (
    inheritedFutureOpeningIso?.trim() &&
    dayKey?.trim() &&
    !isCounterStartAlignedWithMealSlot(inheritedFutureOpeningIso, dayKey, mealTime, fixedNow)
  ) {
    const start = parseISO(inheritedFutureOpeningIso);
    const nowMs = (fixedNow ?? new Date()).getTime();
    if (!Number.isNaN(start.getTime()) && start.getTime() > nowMs) {
      const days = getAdaptedCounterDays(
        inheritedFutureOpeningIso, dayKey, undefined, mealTime, fixedNow,
      );
      if (days !== null) return false;
    }
  }
  return recipeHasMatchingFoodItemsInStock(ingredients, foodItems, index);
}

/**
 * Indique si aucun aliment de la recette n’a de compteur actif ni Prog., alors que le stock
 * de la recette est encore présent — signal pour effacer un Xj figé fantôme au re-gel.
 */
export function hasNoFoodCounterEvidenceWhileStockRemains(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
): boolean {
  if (findEarliestActiveCounterDate(ingredients, foodItems, index, fixedNow)) return false;
  if (findEarliestFutureCounterDate(ingredients, foodItems, index, fixedNow)) return false;
  return recipeHasMatchingFoodItemsInStock(ingredients, foodItems, index);
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
 * Si une date de début est fournie, l’ajoute (même format que les fiches Aliments).
 * Pour un 0j, précise les heures jusqu’au créneau quand elles sont connues.
 */
export function formatFrozenPossibleCounterTooltip(
  days: number | null | undefined,
  counterStartIso?: string | null,
  hoursUntilSlot?: number | null,
): string | undefined {
  if (days === null || days === undefined) return undefined;
  const base =
    days === 0 && hoursUntilSlot != null && hoursUntilSlot > 0
      ? `0j (de ${hoursUntilSlot}h)`
      : `${days}j`;
  const iso = counterStartIso?.trim();
  if (!iso) return base;
  try {
    const when = formatPlannedCounterOpenFr(iso);
    return `${base} · Démarré : ${when}`;
  } catch {
    return base;
  }
}

/**
 * Libellé visible du badge compteur Possible (ex. « 1j », « 0j »).
 * Les heures détaillées restent dans l’infobulle, pas sur le badge.
 */
export function formatPossibleCounterBadgeLabel(
  days: number | null | undefined,
  _hoursUntilSlot?: number | null,
): string | null {
  if (days === null || days === undefined) return null;
  return `${days}j`;
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

export type ResolveFrozenPossibleCounterOptions = {
  baseStartDate?: string | null;
  dayKey?: string | null;
  mealTime?: string | null;
  fixedNow?: Date;
  /**
   * True si le stock n’ouvre qu’en Prog. sur le créneau de cette carte.
   * Efface alors un Xj figé (fantôme) : l’aliment affiche Prog., la carte ne doit plus montrer Nj.
   */
  lotProgOpensAtThisSlot?: boolean;
  /**
   * True si le stock de la recette est encore là mais sans aucun compteur actif/Prog.
   * Efface un Xj figé hérité d’un `counter_start_date` carte / décalage de replanif.
   */
  noFoodCounterEvidence?: boolean;
};

/**
 * Résout la valeur figée après un calcul de gel.
 * Comme `mergeFrozenPossibleCounterDays`, sauf si `null` vient d’une ouverture alignée
 * sur le créneau de la carte, d’un lot uniquement Prog. sur ce créneau, ou d’une absence
 * totale de compteur aliment : on efface un Xj fantôme.
 */
export function resolveFrozenPossibleCounterDays(
  existing: number | null | undefined,
  computed: number | null,
  options?: ResolveFrozenPossibleCounterOptions,
): number | null {
  if (computed === null && typeof existing === "number") {
    if (options?.lotProgOpensAtThisSlot) return null;
    if (options?.noFoodCounterEvidence) return null;
    if (
      isCounterStartAlignedWithMealSlot(
        options?.baseStartDate,
        options?.dayKey,
        options?.mealTime,
        options?.fixedNow,
      )
    ) {
      return null;
    }
  }
  return mergeFrozenPossibleCounterDays(existing, computed);
}

