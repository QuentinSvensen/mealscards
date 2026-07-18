import type { FoodItem } from "@/hooks/useFoodItems";
import type { PossibleMeal } from "@/hooks/useMeals";
import { differenceInCalendarDays } from "date-fns";
import { parseIngredientGroups, strictNameMatch, computeCounterDays } from "@/lib/ingredientUtils";
import {
  isFoodItemFullySealed,
  isFoodItemPhysicallyOpened,
  isCountOnlyFoodItem,
} from "@/lib/stockUtils";
import { expandOrGroupIngredientNames } from "@/domain/stock/consumedIngredients";
import { computePlannedCounterDate } from "@/lib/counters/plannedCounterDate";
import {
  foodItemUsedInPossibleRecipe,
  isSealedPartialUseInPastPlanning,
  isFoodItemConsumedByPossibleMeals,
  findEarliestOpenDateFromPossibleMeals,
  findLatestOpenDateFromPossibleMeals,
  findEarliestPastPlannedOpenForFood,
  findEarliestFuturePlannedSlotForFood,
  hasUnplannedPossibleConsumingFood,
  findEarliestPastPlannedSlotForFood,
  findLatestPastPlannedSlotForFood,
} from "@/lib/counters/possibleMealUsage";
import {
  clearFoodCounterManualOverride,
  isFoodCounterManuallyStarted,
  isFoodCounterManuallyStopped,
} from "@/lib/counters/manualCounterOverrides";

/**
 * Indique si une date de compteur correspond au créneau planifié d'un repas utilisant cet aliment.
 * Sert à distinguer un « prog. » posé par la planification d'un compteur manuel sur lot scellé.
 */
export function counterMatchesPlannedSlot(
  fi: FoodItem,
  counterIso: string,
  allPossibleMeals: PossibleMeal[],
): boolean {
  const ctrMs = new Date(counterIso).getTime();
  if (Number.isNaN(ctrMs)) return false;
  for (const pm of allPossibleMeals) {
    if (!pm.day_of_week?.trim() || !String(pm.meal_time ?? "").trim()) continue;
    const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
    if (!pmIngs?.trim()) continue;
    const uses = parseIngredientGroups(pmIngs).some((g) =>
      g.some((altBundle) =>
        altBundle.some(
          (it) =>
            !it.optional &&
            expandOrGroupIngredientNames(it).some((t) => strictNameMatch(fi.name, t)),
        ),
      ),
    );
    if (!uses) continue;
    const slotMs = new Date(computePlannedCounterDate(pm.day_of_week, pm.meal_time)).getTime();
    if (!Number.isNaN(slotMs) && Math.abs(ctrMs - slotMs) < 120_000) return true;
  }
  return false;
}

/**
 * Indique si un counter_start_date persisté est un démarrage manuel affichable
 * (passé/présent, hors prog. planifié fantôme).
 */
function isDisplayableManualStoredCounter(
  fi: FoodItem,
  stored: string,
  allPossibleMeals: PossibleMeal[],
  nowMs: number,
): boolean {
  const storedMs = new Date(stored).getTime();
  if (Number.isNaN(storedMs) || storedMs > nowMs) return false;
  if (counterMatchesPlannedSlot(fi, stored, allPossibleMeals)) return false;
  return true;
}

/**
 * Résout la date de compteur à afficher sur la fiche aliment.
 * Entamé (reliquat, sous le poids d'origine, ou quantité unitaire réduite sur CE lot) → compteur.
 * Si un créneau futur planifié utilise ce lot (et aucun Possible non planifié) → mode « Prog. ».
 * Boîte pleine / paquet homonyme intact → pas de compteur.
 * Exception : démarrage manuel (Compteur) honoré même sur lot encore scellé.
 */
export function resolveFoodItemCounterStartForDisplay(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
  baselineTotalGrams?: number | null,
  baselineQuantity?: number | null,
): string | null {
  if (fi.is_infinite || fi.storage_type === "surgele" || fi.no_counter) return null;

  const now = fixedNow ?? new Date();
  const nowMs = now.getTime();
  const stored = fi.counter_start_date?.trim() || "";

  // Arrêt manuel (session) : masque l'inventaire d'affichage tant que la DB n'a pas repose un compteur.
  if (isFoodCounterManuallyStopped(fi.id)) {
    if (stored) {
      clearFoodCounterManualOverride(fi.id);
    } else {
      return null;
    }
  }

  const physicallyOpened = isFoodItemPhysicallyOpened(fi, baselineTotalGrams, baselineQuantity);
  const consumedByPossible = isFoodItemConsumedByPossibleMeals(fi, allPossibleMeals, now);
  const logicallyOpened = physicallyOpened || consumedByPossible;
  const virtualOpen =
    !logicallyOpened && isSealedPartialUseInPastPlanning(fi, allPossibleMeals, now);

  // Unitaire : uniquement CE lot (baseline qty ou compteur posé à la déduction) —
  // jamais tous les homonymes via le nom du repas Possible.
  const countOnlyOpenedOnThisLot =
    isCountOnlyFoodItem(fi) &&
    (physicallyOpened || Boolean(stored));

  /** Compteur persisté affichable suite à un clic Compteur (session ou DB sans fantôme). */
  const resolveManualSealedCounter = (): string | null => {
    if (!stored) return null;
    if (isFoodCounterManuallyStarted(fi.id)) return stored;
    if (!isDisplayableManualStoredCounter(fi, stored, allPossibleMeals, nowMs)) return null;
    // Orphelin multi-paquets ou unité restante encore liée à un Possible → masquer.
    if ((fi.quantity ?? 1) > 1) return null;
    if (allPossibleMeals.some((pm) => foodItemUsedInPossibleRecipe(fi, pm))) return null;
    return stored;
  };

  // Paquet unitaire intact (qty = baseline) : masquer prog. fantôme, mais honorer un démarrage manuel.
  if (
    isCountOnlyFoodItem(fi) &&
    baselineQuantity != null &&
    baselineQuantity > 0 &&
    (fi.quantity ?? 1) >= baselineQuantity
  ) {
    return resolveManualSealedCounter();
  }

  // Lot grammes encore scellé : pas d'inférence planning, mais compteur manuel oui.
  if (!logicallyOpened && !virtualOpen && !countOnlyOpenedOnThisLot) {
    return resolveManualSealedCounter();
  }

  const futureProg = findEarliestFuturePlannedSlotForFood(fi, allPossibleMeals, now);
  const blockedByUnplanned = hasUnplannedPossibleConsumingFood(fi, allPossibleMeals);

  // Lot entamé / unitaire prélevé + repas planifié plus tard → toujours « Prog. »
  // (même si la déduction a posé « maintenant » avant la planification).
  if (
    (physicallyOpened || countOnlyOpenedOnThisLot || logicallyOpened) &&
    futureProg &&
    !blockedByUnplanned
  ) {
    return futureProg;
  }

  // Lot physiquement entamé ou unitaire prélevé : le compteur persisté prime.
  if (physicallyOpened || countOnlyOpenedOnThisLot) {
    if (stored) {
      const storedMs = new Date(stored).getTime();
      if (!Number.isNaN(storedMs)) return stored;
    }
    const latestInferred =
      findLatestOpenDateFromPossibleMeals(fi, allPossibleMeals, now) ??
      findLatestPastPlannedSlotForFood(fi, allPossibleMeals, now, "opened");
    if (latestInferred) {
      const ageDays = differenceInCalendarDays(now, new Date(latestInferred));
      if (ageDays <= 2) return latestInferred;
    }
    return physicallyOpened || logicallyOpened ? now.toISOString() : null;
  }

  if (stored) {
    const storedMs = new Date(stored).getTime();
    if (!Number.isNaN(storedMs)) {
      const futureProgOnSealedBox =
        !logicallyOpened &&
        isFoodItemFullySealed(fi) &&
        !isCountOnlyFoodItem(fi) &&
        storedMs > nowMs &&
        counterMatchesPlannedSlot(fi, stored, allPossibleMeals);
      if (!futureProgOnSealedBox && storedMs <= nowMs) return stored;
    }
  }

  if (logicallyOpened) {
    return (
      findEarliestOpenDateFromPossibleMeals(fi, allPossibleMeals, now) ??
      findEarliestPastPlannedSlotForFood(fi, allPossibleMeals, now, "opened") ??
      (stored && new Date(stored).getTime() <= nowMs ? stored : null)
    );
  }

  return findEarliestPastPlannedOpenForFood(fi, allPossibleMeals, now) ?? null;
}

/** Résumé visuel du stock pour distinguer paquet entier, entamé et usage dans Possible. */
export interface FoodItemStockVisualHint {
  isFullSealed: boolean;
  isPhysicallyOpened: boolean;
  isUsedInPossible: boolean;
  counterExpected: boolean;
  counterActive: boolean;
  counterPersisted: boolean;
}

/**
 * Calcule les indicateurs visuels (badges / bordures) pour une fiche aliment :
 * entier scellé, entamé, lié à un repas Possible, compteur attendu ou actif.
 */
export function resolveFoodItemStockVisualHint(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  effectiveCounterStart: string | null,
  fixedNow?: Date,
  baselineTotalGrams?: number | null,
  baselineQuantity?: number | null,
): FoodItemStockVisualHint {
  const inactive: FoodItemStockVisualHint = {
    isFullSealed: false,
    isPhysicallyOpened: false,
    isUsedInPossible: false,
    counterExpected: false,
    counterActive: false,
    counterPersisted: false,
  };
  if (fi.is_infinite || fi.storage_type === "surgele" || fi.no_counter) return inactive;

  const now = fixedNow ?? new Date();
  const nowMs = now.getTime();
  const physicallyOpened = isFoodItemPhysicallyOpened(fi, baselineTotalGrams, baselineQuantity);
  const consumedByPossible = isFoodItemConsumedByPossibleMeals(fi, allPossibleMeals, now);
  const isUsedInPossible = allPossibleMeals.some((pm) => foodItemUsedInPossibleRecipe(fi, pm));
  const isFullSealed = isFoodItemFullySealed(fi) && !physicallyOpened && !isCountOnlyFoodItem(fi);
  const virtualOpen =
    !physicallyOpened &&
    !consumedByPossible &&
    isSealedPartialUseInPastPlanning(fi, allPossibleMeals, now);
  const counterExpected = physicallyOpened || consumedByPossible || virtualOpen;
  const stored = fi.counter_start_date?.trim();
  const counterPersisted = !!(
    stored &&
    !Number.isNaN(new Date(stored).getTime()) &&
    new Date(stored).getTime() <= nowMs
  );
  const counterActive = !!(
    effectiveCounterStart &&
    computeCounterDays(effectiveCounterStart) !== null
  );

  return {
    isFullSealed,
    isPhysicallyOpened: physicallyOpened,
    isUsedInPossible,
    counterExpected,
    counterActive,
    counterPersisted,
  };
}
