import type { FoodItem } from "@/hooks/useFoodItems";
import type { PossibleMeal } from "@/hooks/useMeals";
import { parseQty, parseIngredientGroups, strictNameMatch } from "@/lib/ingredientUtils";
import { isFoodItemFullySealed } from "@/lib/stockUtils";
import { expandOrGroupIngredientNames } from "@/domain/stock/consumedIngredients";
import { computePlannedCounterDate } from "@/lib/counters/plannedCounterDate";

/** Au-delà de ce grammage unitaire, on considère un paquet « boîte » (pas d'ouverture virtuelle via planification). */
const MAX_CONTAINER_VIRTUAL_GRAMS = 300;

/**
 * Indique si un repas Possible (planifié ou non) utilise cet aliment dans sa recette.
 */
export function foodItemUsedInPossibleRecipe(fi: FoodItem, pm: PossibleMeal): boolean {
  const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
  if (!pmIngs?.trim()) return false;
  return parseIngredientGroups(pmIngs).some((g) =>
    g.some((altBundle) =>
      altBundle.some(
        (it) =>
          !it.optional &&
          expandOrGroupIngredientNames(it).some((t) => strictNameMatch(fi.name, t)),
      ),
    ),
  );
}

/**
 * Indique si la recette cite l'aliment sans quantité explicite (ex. « Sauce tikka masala » seul).
 */
function recipeUsesBareIngredient(fi: FoodItem, pm: PossibleMeal): boolean {
  const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
  if (!pmIngs?.trim()) return false;
  for (const group of parseIngredientGroups(pmIngs)) {
    for (const bundle of group) {
      for (const item of bundle) {
        if (item.optional) continue;
        if (!expandOrGroupIngredientNames(item).some((t) => strictNameMatch(fi.name, t))) continue;
        if (item.qty > 0 || item.count > 0) return false;
        return true;
      }
    }
  }
  return false;
}

/**
 * Retourne les grammes demandés par la recette d'un repas Possible pour cet aliment
 * (somme des groupes « + », max des branches « ou »).
 */
function getRecipeNeededGramsForFood(fi: FoodItem, pm: PossibleMeal): number {
  const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
  if (!pmIngs?.trim()) return 0;
  let totalNeeded = 0;
  for (const group of parseIngredientGroups(pmIngs)) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    let groupNeeded = 0;
    for (const bundle of group) {
      let bundleNeeded = 0;
      for (const item of bundle) {
        if (item.optional) continue;
        if (!expandOrGroupIngredientNames(item).some((t) => strictNameMatch(fi.name, t))) continue;
        const perUnit = parseQty(fi.grams);
        if (item.qty > 0) bundleNeeded += item.qty;
        else if (item.count > 0) bundleNeeded += item.count * (perUnit > 0 ? perUnit : 0);
        else if (perUnit > 0) bundleNeeded += perUnit;
      }
      groupNeeded = Math.max(groupNeeded, bundleNeeded);
    }
    totalNeeded += groupNeeded;
  }
  return totalNeeded;
}

/**
 * Indique si un créneau planifié passé justifie une ouverture virtuelle (lot encore scellé).
 */
function pastSlotQualifiesForVirtualOpen(
  fi: FoodItem,
  pm: PossibleMeal,
  perUnit: number,
): boolean {
  if (recipeUsesBareIngredient(fi, pm)) return true;
  if (perUnit > MAX_CONTAINER_VIRTUAL_GRAMS) return false;
  const needed = getRecipeNeededGramsForFood(fi, pm);
  return needed > 0 && needed < perUnit - 0.01;
}

/**
 * Indique si un lot encore scellé peut recevoir un compteur via un repas planifié passé.
 * Pots / bocaux : prélèvement partiel ou ingrédient sans quantité (y compris pots > 300g).
 * Boîtes (400g Tenders) : uniquement à l'entame physique — pas d'ouverture virtuelle.
 */
export function isSealedPartialUseInPastPlanning(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): boolean {
  if (!isFoodItemFullySealed(fi)) return false;
  const perUnit = parseQty(fi.grams);
  if (perUnit <= 0) return false;
  if ((fi.quantity ?? 1) > 1) return false;

  const nowMs = (fixedNow ?? new Date()).getTime();
  for (const pm of allPossibleMeals) {
    if (!pm.day_of_week?.trim() || !String(pm.meal_time ?? "").trim()) continue;
    const slotMs = new Date(computePlannedCounterDate(pm.day_of_week, pm.meal_time)).getTime();
    if (Number.isNaN(slotMs) || slotMs > nowMs) continue;
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    if (pastSlotQualifiesForVirtualOpen(fi, pm, perUnit)) return true;
  }
  return false;
}

/**
 * Parcourt les créneaux planifiés passés et retourne le plus ancien ou le plus récent selon `direction`.
 */
function findPastPlannedSlotForFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow: Date,
  mode: "virtual" | "opened",
  direction: "earliest" | "latest",
): string | undefined {
  const perUnit = parseQty(fi.grams);
  const nowMs = fixedNow.getTime();
  let result: string | undefined;
  let resultMs = direction === "earliest" ? Infinity : -Infinity;

  for (const pm of allPossibleMeals) {
    if (!pm.day_of_week?.trim() || !String(pm.meal_time ?? "").trim()) continue;
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    if (mode === "virtual" && !pastSlotQualifiesForVirtualOpen(fi, pm, perUnit)) continue;
    const slotIso = computePlannedCounterDate(pm.day_of_week, pm.meal_time);
    const slotMs = new Date(slotIso).getTime();
    if (Number.isNaN(slotMs) || slotMs > nowMs) continue;
    const isBetter = direction === "earliest" ? slotMs < resultMs : slotMs > resultMs;
    if (isBetter) {
      resultMs = slotMs;
      result = slotIso;
    }
  }
  return result;
}

/**
 * Retourne la date d'ouverture la plus ancienne liée à un repas Possible planifié passé.
 * mode « virtual » : lot scellé, règles pot vs boîte ; mode « opened » : lot déjà entamé.
 */
export function findEarliestPastPlannedSlotForFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow: Date,
  mode: "virtual" | "opened",
): string | undefined {
  return findPastPlannedSlotForFood(fi, allPossibleMeals, fixedNow, mode, "earliest");
}

/**
 * Retourne la date d'ouverture la plus récente liée à un repas Possible planifié passé.
 * Utilisée pour un lot physiquement entamé sans compteur persisté sur la fiche aliment.
 */
export function findLatestPastPlannedSlotForFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow: Date,
  mode: "virtual" | "opened",
): string | undefined {
  return findPastPlannedSlotForFood(fi, allPossibleMeals, fixedNow, mode, "latest");
}

/**
 * Indique si un repas Possible (planifié passé ou non planifié) consomme déjà cet aliment.
 * Un lot entièrement scellé n'est jamais considéré comme ouvert : la consommation concerne
 * d'autres unités déjà retirées (ex. 1 paquet sur 2 consommé, le restant est intact).
 * Les unitaires sans grammes sont aussi « scellés » ici : l'ouverture se détecte par
 * `counter_start_date` sur CE lot ou la baisse de quantité vs baseline — pas par le nom.
 */
export function isFoodItemConsumedByPossibleMeals(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): boolean {
  if (isFoodItemFullySealed(fi)) return false;

  const nowMs = (fixedNow ?? new Date()).getTime();
  for (const pm of allPossibleMeals) {
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    const planned = Boolean(pm.day_of_week?.trim() && String(pm.meal_time ?? "").trim());
    if (!planned) return true;
    const slotMs = new Date(computePlannedCounterDate(pm.day_of_week!, pm.meal_time)).getTime();
    if (!Number.isNaN(slotMs) && slotMs <= nowMs) return true;
  }
  return false;
}

/**
 * Retourne la date d'ouverture la plus ancienne inférée depuis les repas Possible
 * (créneau passé planifié, ou repas non planifié déjà dans la liste).
 */
export function findEarliestOpenDateFromPossibleMeals(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): string | undefined {
  const nowMs = (fixedNow ?? new Date()).getTime();
  let earliest: string | undefined;
  let earliestMs = Infinity;
  for (const pm of allPossibleMeals) {
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    const planned = Boolean(pm.day_of_week?.trim() && String(pm.meal_time ?? "").trim());
    let candidate: string | undefined;
    if (planned) {
      candidate = computePlannedCounterDate(pm.day_of_week!, pm.meal_time);
    } else {
      candidate = (pm.counter_start_date?.trim() || pm.created_at?.trim()) ?? undefined;
    }
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (Number.isNaN(ms) || ms > nowMs) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = candidate;
    }
  }
  return earliest;
}

/**
 * Retourne la date d'ouverture la plus récente inférée depuis les repas Possible
 * (créneau passé planifié, ou repas non planifié déjà dans la liste).
 */
export function findLatestOpenDateFromPossibleMeals(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): string | undefined {
  const nowMs = (fixedNow ?? new Date()).getTime();
  let latest: string | undefined;
  let latestMs = -Infinity;
  for (const pm of allPossibleMeals) {
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    const planned = Boolean(pm.day_of_week?.trim() && String(pm.meal_time ?? "").trim());
    let candidate: string | undefined;
    if (planned) {
      candidate = computePlannedCounterDate(pm.day_of_week!, pm.meal_time);
    } else {
      candidate = (pm.counter_start_date?.trim() || pm.created_at?.trim()) ?? undefined;
    }
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (Number.isNaN(ms) || ms > nowMs) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = candidate;
    }
  }
  return latest;
}

/**
 * Retourne la date d'ouverture la plus ancienne parmi les créneaux planifiés déjà passés
 * où un repas Possible entame virtuellement cet aliment (pot / bocal scellé).
 */
export function findEarliestPastPlannedOpenForFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): string | undefined {
  if (fi.is_infinite || fi.storage_type === "surgele" || fi.no_counter) return undefined;
  if (!isSealedPartialUseInPastPlanning(fi, allPossibleMeals, fixedNow)) return undefined;
  return findEarliestPastPlannedSlotForFood(fi, allPossibleMeals, fixedNow ?? new Date(), "virtual");
}

/**
 * Retourne le créneau planifié futur le plus proche qui utilise cet aliment.
 * Sert à afficher / synchroniser le mode « Prog. » sur la fiche stock.
 */
export function findEarliestFuturePlannedSlotForFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  fixedNow?: Date,
): string | undefined {
  const nowMs = (fixedNow ?? new Date()).getTime();
  let earliest: string | undefined;
  let earliestMs = Infinity;
  for (const pm of allPossibleMeals) {
    if (!foodItemUsedInPossibleRecipe(fi, pm)) continue;
    if (!pm.day_of_week?.trim() || !String(pm.meal_time ?? "").trim()) continue;
    const slotIso = computePlannedCounterDate(pm.day_of_week, pm.meal_time);
    const slotMs = new Date(slotIso).getTime();
    if (Number.isNaN(slotMs) || slotMs <= nowMs) continue;
    if (slotMs < earliestMs) {
      earliestMs = slotMs;
      earliest = slotIso;
    }
  }
  return earliest;
}

/**
 * Indique si un repas Possible NON planifié consomme déjà cet aliment (ouverture réelle maintenant).
 * Dans ce cas on ne bascule pas le compteur en « Prog. » futur.
 */
export function hasUnplannedPossibleConsumingFood(
  fi: FoodItem,
  allPossibleMeals: PossibleMeal[],
  excludePmId?: string | null,
): boolean {
  return allPossibleMeals.some((pm) => {
    if (excludePmId && pm.id === excludePmId) return false;
    if (pm.day_of_week?.trim() && String(pm.meal_time ?? "").trim()) return false;
    return foodItemUsedInPossibleRecipe(fi, pm);
  });
}
