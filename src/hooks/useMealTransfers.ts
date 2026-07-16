/**
 * Hook centralisé pour la logique de transfert de stock entre les listes de repas.
 * 
 * Gère :
 * - Déduction des ingrédients du stock lors du déplacement vers "Possible"
 * - Restauration du stock lors du retour d'un repas
 * - Ajustement delta lors de la modification des ingrédients d'une carte "Possible"
 * - Déduction par correspondance de nom (repas sans ingrédients)
 * - Synchronisation des compteurs d'ouverture avec le planning
 * 
 * Chaque appel Supabase est wrappé dans safeMutate pour gérer les erreurs réseau.
 */

import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups, parseIngredientLine, parsePartialQty,
  extractIngredientMacros, extractMetrics, parseIngredientLineRaw,
  computeCounterDays,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  sortStockDeductionPriority,
  isFoodItemFullySealed,
  isFoodItemPhysicallyOpened,
  isCountOnlyFoodItem,
} from "@/lib/stockUtils";
import {
  attachPortionDeduction,
  getPortionDeduction,
  hasPortionDeductionMeta,
  stripPortionDeductionMeta,
} from "@/lib/stockDeductionSnapshot";
import {
  DESSERT_FOOD_PREF_KEY,
  DESSERT_FOOD_NAME_KEYS_PREF_KEY,
  patchDessertPrefsAfterStockDeletes,
} from "@/lib/foodDessertUtils";

type UserPreferenceRow = { id: string; key: string; value: unknown };

/**
 * Met à jour le cache des noms dessert mémorisés quand une fiche dessert est supprimée du stock.
 */
function syncDessertNameMemoryAfterDeletes(
  qc: ReturnType<typeof useQueryClient>,
  deletedSnapshots: FoodItem[],
) {
  if (deletedSnapshots.length === 0) return;
  const prefs = qc.getQueryData<UserPreferenceRow[]>(["user_preferences"]) ?? [];
  const dessertIds = (prefs.find((p) => p.key === DESSERT_FOOD_PREF_KEY)?.value ?? []) as string[];
  const nameKeys = (prefs.find((p) => p.key === DESSERT_FOOD_NAME_KEYS_PREF_KEY)?.value ?? []) as string[];
  const patched = patchDessertPrefsAfterStockDeletes(deletedSnapshots, dessertIds, nameKeys);
  if (!patched.changed) return;
  qc.setQueryData<UserPreferenceRow[]>(["user_preferences"], (old) => {
    if (!old) return old;
    return old.map((pref) => {
      if (pref.key === DESSERT_FOOD_NAME_KEYS_PREF_KEY) return { ...pref, value: patched.nameKeys };
      return pref;
    });
  });
}

/** Table de correspondance jour français → index (0=Lun) */
const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/** Normalise une ligne Supabase `food_items` vers le type FoodItem du client. */
function mapFoodItemRow(d: any): FoodItem {
  return {
    ...d,
    is_meal: d.is_meal ?? false,
    is_infinite: d.is_infinite ?? false,
    is_dry: d.is_dry ?? false,
    is_indivisible: d.is_indivisible ?? false,
    no_counter: d.no_counter ?? false,
    storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
    quantity: d.quantity ?? null,
    food_type: d.food_type ?? null,
    protein: d.protein ?? null,
    fiber: d.fiber ?? null,
  } as FoodItem;
}

/** Charge toutes les fiches aliment depuis Supabase (après restauration de stock). */
async function fetchAllFoodItems(): Promise<FoodItem[]> {
  const { data } = await supabase.from("food_items").select("*").order("sort_order", { ascending: true });
  return (data ?? []).map(mapFoodItemRow);
}

/** Aligné sur getTargetDate (ingredientUtils) : matin 8h, midi 12h, soir 19h */
function setMealTimeHours(d: Date, mealTime: string | null) {
  const low = (mealTime || "").trim().toLowerCase();
  if (low === "soir") d.setHours(19, 0, 0, 0);
  else if (low === "matin") d.setHours(8, 0, 0, 0);
  else if (low === "midi") d.setHours(12, 0, 0, 0);
  // Pas de défaut « midi » si absent : évite une fausse heure (12h) quand le créneau n’est pas encore choisi
}

/**
 * Calcule la date ISO du compteur d'ouverture pour un repas planifié.
 * Matin = 8h, midi = 12h, soir = 19h. Accepte les jours nommés ("lundi") ou les dates ISO.
 */
/**
 * Retourne les noms d’ingrédients (déjà normalisés comme dans `ParsedIngredient.name`) à comparer au stock
 * pour une ligne de recette qui peut contenir des choix « A ou B ou C », souvent entre parenthèses.
 * Sans cela, `updateFoodItemCountersForPlanning` ne trouve jamais le « Jambon blanc » d’un croque, etc.
 */
function expandOrGroupIngredientNames(item: ParsedIngredient): string[] {
  const out = new Set<string>();
  const push = (n: string | null | undefined) => {
    const t = (n ?? "").trim();
    if (t) out.add(t);
  };
  push(item.name);
  const raw = item.name.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  if (/\bou\b/i.test(raw)) {
    for (const chunk of raw.split(/\s+ou\s+/i)) {
      const parsed = parseIngredientLine(chunk.trim());
      if (parsed.name) push(parsed.name);
    }
  }
  return [...out];
}

/**
 * Construit une chaîne d'ingrédients basée uniquement sur les alternatives réellement consommées.
 * Sert à afficher sur la carte "Possible" uniquement les choix "ou" effectivement déduits du stock.
 * Reprend les suffixes {cal} / [pro] depuis la recette maître pour l’éditeur et les calculs.
 * Les quantités unitaires utilisent « 4 Pain » (pas « x4 Pain ») pour rester parsables en colonnes.
 */
function buildConsumedIngredientsOverride(pickedAlternatives: ParsedIngredient[][], mealIngredients: string): string | null {
  /** Remet une majuscule initiale pour un affichage propre côté carte Possible. */
  const withLeadingUppercase = (value: string): string => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  };

  const macroMap = extractIngredientMacros(mealIngredients);

  /** Associe chaque nom normalisé au nom original de la recette pour préserver apostrophes et accents. */
  const buildOriginalDisplayNameMap = (ingredients: string): Map<string, string> => {
    const out = new Map<string, string>();
    ingredients
      .split(/(?:\n|,(?!\d))/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((group) => {
        group
          .split(/\|/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((alt) => {
            alt
              .split(/\+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((rawItem) => {
                const cleanItem = rawItem.startsWith("?") ? rawItem.slice(1).trim() : rawItem;
                const { text: withoutMetrics } = extractMetrics(cleanItem);
                const parsed = parseIngredientLineRaw(withoutMetrics);
                if (parsed.rawName?.trim()) out.set(normalizeKey(parsed.name), withLeadingUppercase(parsed.rawName));
              });
          });
      });
    return out;
  };
  const originalDisplayNameByKey = buildOriginalDisplayNameMap(mealIngredients);

  /** Réinjecte les macros par nom (clé normalisée), comme serializeIngredients. */
  const macroSuffixForDisplayName = (displayName: string): string => {
    const m = macroMap.get(normalizeKey(displayName));
    if (!m) return "";
    let s = "";
    if (m.cal) s += `{${m.cal}}`;
    if (m.pro) s += ` [${m.pro}]`;
    return s;
  };

  const lines: string[] = [];
  for (const altBundle of pickedAlternatives) {
    const parts = altBundle
      .filter((item) => !item.optional)
      .map((item) => {
        const displayName = originalDisplayNameByKey.get(normalizeKey(item.name)) ?? withLeadingUppercase(item.name || "");
        if (!displayName) return "";
        const macros = macroSuffixForDisplayName(displayName);
        if (item.qty > 0) return `${formatNumeric(item.qty)}g ${displayName}${macros}`.trim();
        if (item.count > 0) return `${formatNumeric(item.count)} ${displayName}${macros}`.trim();
        return `${displayName}${macros}`;
      })
      .filter(Boolean);
    if (parts.length > 0) lines.push(parts.join(" + "));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function computePlannedCounterDate(dayOfWeek: string, mealTime: string | null): string {
  // Si c'est déjà une date ISO (YYYY-MM-DD), l'utiliser directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    const d = parseISO(dayOfWeek);
    setMealTimeHours(d, mealTime);
    return d.toISOString();
  }

  const today = new Date();
  const todayDow = today.getDay(); // 0=Dim
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Lun
  const targetIdx = DAY_KEY_TO_INDEX[dayOfWeek] ?? 0;
  const diff = targetIdx - todayIdx;

  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  setMealTimeHours(d, mealTime);
  return d.toISOString();
}

/** Réexport pour compatibilité (source : stockUtils). */
export { isFoodItemFullySealed } from "@/lib/stockUtils";

/** Alias interne pour la logique de déduction existante. */
function isFoodFullySealed(fi: FoodItem): boolean {
  return isFoodItemFullySealed(fi);
}

/**
 * Indique si un repas Possible (planifié ou non) utilise cet aliment dans sa recette.
 */
function foodItemUsedInPossibleRecipe(fi: FoodItem, pm: PossibleMeal): boolean {
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

/** Au-delà de ce grammage unitaire, on considère un paquet « boîte » (pas d'ouverture virtuelle via planification). */
const MAX_CONTAINER_VIRTUAL_GRAMS = 300;

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
function findEarliestPastPlannedSlotForFood(
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
function findLatestPastPlannedSlotForFood(
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

/**
 * Résout la date de compteur à afficher sur la fiche aliment.
 * Entamé (reliquat, sous le poids d'origine, ou quantité unitaire réduite sur CE lot) → compteur.
 * Si un créneau futur planifié utilise ce lot (et aucun Possible non planifié) → mode « Prog. ».
 * Boîte pleine / paquet homonyme intact → pas de compteur.
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
  const physicallyOpened = isFoodItemPhysicallyOpened(fi, baselineTotalGrams, baselineQuantity);
  const consumedByPossible = isFoodItemConsumedByPossibleMeals(fi, allPossibleMeals, now);
  const logicallyOpened = physicallyOpened || consumedByPossible;
  const virtualOpen =
    !logicallyOpened && isSealedPartialUseInPastPlanning(fi, allPossibleMeals, now);

  // Unitaire : uniquement CE lot (baseline qty ou compteur posé à la déduction) —
  // jamais tous les homonymes via le nom du repas Possible.
  const countOnlyOpenedOnThisLot =
    isCountOnlyFoodItem(fi) &&
    (physicallyOpened || Boolean(fi.counter_start_date?.trim()));

  // Paquet unitaire intact (qty = baseline) : masquer même un prog. fantôme posé par erreur.
  if (
    isCountOnlyFoodItem(fi) &&
    baselineQuantity != null &&
    baselineQuantity > 0 &&
    (fi.quantity ?? 1) >= baselineQuantity
  ) {
    return null;
  }

  if (!logicallyOpened && !virtualOpen && !countOnlyOpenedOnThisLot) return null;

  const stored = fi.counter_start_date?.trim();
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

/**
 * Indique si une date de compteur correspond au créneau planifié d'un repas utilisant cet aliment.
 * Sert à distinguer un « prog. » posé par la planification d'un compteur manuel sur lot scellé.
 */
function counterMatchesPlannedSlot(
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
 * Hook principal de transfert de stock.
 * Fournit toutes les opérations de mutation du stock liées aux repas.
 */
/**
 * Empreinte stable du planning Possible (id + jour + créneau).
 * Sert à relancer la synchro Prog. à chaque changement, pas seulement au 1er chargement.
 */
export function buildPossiblePlanningSnapshot(possibleMeals: PossibleMeal[]): string {
  return possibleMeals
    .map((pm) => `${pm.id}:${pm.day_of_week ?? ""}:${String(pm.meal_time ?? "")}`)
    .sort()
    .join("|");
}

/** Options de repli lors d'une restauration estimée sans snapshot de déduction. */
export type RestoreIngredientsOptions = {
  fallbackCounterDate?: string | null;
  fallbackExpirationDate?: string | null;
};

export function useMealTransfers(foodItems: FoodItem[]) {
  const qc = useQueryClient();

  /**
   * Retourne la version la plus récente du stock depuis le cache React Query.
   * Sert à éviter d'utiliser une fermeture stale de `foodItems` pendant les déductions.
   */
  const getLiveFoodItems = (): FoodItem[] => {
    const cached = qc.getQueryData<FoodItem[]>(["food_items"]);
    if (Array.isArray(cached)) return cached;
    return foodItems;
  };

  // Signale à la subscription realtime globale qu'un update optimiste vient d'être appliqué :
  // elle doit ignorer son invalidation automatique pendant plusieurs secondes pour laisser la
  // réplique Supabase rattraper son retard et ne pas écraser notre cache local.
  const suppressStockRealtimeBriefly = () => {
    try {
      (window as any).__suppressStockRealtimeUntil = Date.now() + 6000;
    } catch {
      // no-op
    }
  };

  /** Exécute une mutation Supabase avec gestion d'erreur centralisée */
  const safeMutate = async (label: string, fn: () => any): Promise<any> => {
    try {
      const res = await fn();
      if (res && res.error) throw new Error(res.error.message);
      if (Array.isArray(res)) {
        const err = res.find(r => r?.error);
        if (err) throw new Error(err.error.message);
      }
      return res;
    } catch (err: any) {
      console.error(`${label} Error:`, err);
      toast({ title: "Erreur réseau", description: `${label} : ${err?.message ?? "erreur inconnue"}`, variant: "destructive" });
      return null;
    }
  };

  // ─── Helpers internes pour la gestion des compteurs ──────────────────────

  /**
   * Détermine si un aliment doit recevoir un compteur d'ouverture.
   * Conditions : stock fini, non surgelé, pas marqué no_counter.
   */
  const shouldStartCounter = (fi: FoodItem) =>
    !fi.is_infinite && fi.storage_type !== "surgele" && !fi.no_counter;

  /**
   * Résout péremption et compteur lors de la recréation d'un aliment absent du stock
   * (repli si le snapshot de déduction est introuvable).
   */
  const resolveRecreatedFoodItemMeta = (
    templateFi: FoodItem | undefined,
    name: string,
    storageFallback: FoodItem["storage_type"],
    options?: RestoreIngredientsOptions,
  ): { expiration_date: string | null; counter_start_date: string | null } => {
    const expiration_date = templateFi?.expiration_date ?? options?.fallbackExpirationDate ?? null;
    const counterCandidate = templateFi?.counter_start_date ?? options?.fallbackCounterDate ?? null;
    const counterProbe: FoodItem = templateFi ?? {
      id: "",
      name,
      grams: null,
      calories: null,
      protein: null,
      fiber: null,
      expiration_date,
      counter_start_date: counterCandidate,
      sort_order: 0,
      created_at: "",
      is_meal: false,
      is_infinite: false,
      is_dry: false,
      is_indivisible: false,
      no_counter: false,
      storage_type: storageFallback,
      quantity: null,
      food_type: null,
    };
    const counter_start_date =
      counterCandidate && shouldStartCounter(counterProbe) ? counterCandidate : null;
    return { expiration_date, counter_start_date };
  };

  /**
   * Retourne la date de compteur la plus ancienne entre deux dates (ignore les valeurs nulles).
   * Sert à conserver la date d'ouverture d'origine (ex. « ouvert vendredi midi ») lors d'un retour de portion.
   */
  const earlierCounterDate = (a?: string | null, b?: string | null): string | null => {
    if (!a) return b ?? null;
    if (!b) return a;
    return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  };

  /**
   * Vérifie si le compteur doit être mis à jour (pas déjà en cours ou forcé).
   * Protège les compteurs manuels existants qui sont déjà dans le passé.
   */
  const needsCounterUpdate = (fi: FoodItem, counterToSet: string, forcedCounterDate?: string) => {
    if (!shouldStartCounter(fi)) return false;
    if (!fi.counter_start_date) return true;
    const isFuture = new Date(fi.counter_start_date) > new Date(counterToSet);
    return isFuture || !!forcedCounterDate;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION DU STOCK (déplacement vers "Possible")
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit les ingrédients du stock lors du déplacement d'un repas vers "Possible".
   * 
   * Pour chaque ingrédient requis :
   * 1. Choisit la meilleure alternative en stock
   * 2. Déduit la quantité nécessaire (grammes ou unités)
   * 3. Démarre un compteur d'ouverture si applicable
   * 4. Sauvegarde un snapshot de l'état avant déduction (pour restauration)
   * 
   * @returns snapshots (état avant déduction), consumedIds (items supprimés), oldestCounter (compteur le plus ancien)
   */
  const deductIngredientsFromStock = async (meal: Meal, forcedCounterDate?: string): Promise<{ snapshots: FoodItem[]; consumedIds: string[]; oldestCounter: string | null; consumedIngredients: string | null }> => {
    if (!meal.ingredients?.trim()) return { snapshots: [], consumedIds: [], oldestCounter: null, consumedIngredients: null };
    const liveFoodItems = getLiveFoodItems();
    const groups = parseIngredientGroups(meal.ingredients);
    const pickedAlternatives: ParsedIngredient[][] = [];
    const stockMap = buildStockMap(liveFoodItems);
    const snapshotsById = new Map<string, FoodItem>();
    /** Grammes / unités retirés par aliment pour cette carte Possible (restauration additive). */
    const portionDeltasById = new Map<string, { grams: number; quantity: number }>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };
    const addPortionDelta = (fiId: string, grams: number, quantity: number) => {
      const prev = portionDeltasById.get(fiId) ?? { grams: 0, quantity: 0 };
      portionDeltasById.set(fiId, {
        grams: prev.grams + grams,
        quantity: prev.quantity + quantity,
      });
    };
    let oldestCounter: string | null = null;
    /** Date ISO d’ouverture réellement appliquée sur le stock pendant cette déduction (ex. « maintenant »). */
    let openedAtDeduction: string | null = null;

    /**
     * Enregistre la date utilisée pour démarrer ou avancer le compteur lors de cette déduction.
     * Sert quand aucun lot n’avait encore un compteur « passé » à réutiliser (ex. lot seulement programmé jeudi).
     */
    const registerDeductionOpenDate = (iso: string) => {
      if (!openedAtDeduction || new Date(iso) < new Date(openedAtDeduction)) openedAtDeduction = iso;
    };

    /**
     * Collecte le compteur le plus ancien parmi les items déjà ouverts.
     * Ne prend en compte que les compteurs déjà actifs (pas dans le futur).
     * `referenceDate` doit être la date effective (souvent « maintenant »), pas `forcedCounter` seul.
     */
    const trackOldestCounter = (fi: FoodItem, referenceDate: string) => {
      if (fi.counter_start_date && new Date(fi.counter_start_date) <= new Date(referenceDate)) {
        if (!oldestCounter || new Date(fi.counter_start_date) < new Date(oldestCounter)) {
          oldestCounter = fi.counter_start_date;
        }
      }
    };

    for (const group of groups) {
      // Ignorer les groupes entièrement optionnels
      if (group.every(alt => alt.every(item => item.optional))) continue;
      const altBundle = pickBestAlternative(group, stockMap);
      if (!altBundle) continue;
      pickedAlternatives.push(altBundle);

      for (const alt of altBundle) {
        if (alt.optional) continue;
        const { qty: neededGrams, count: neededCount, name } = alt;
        const key = findStockKey(stockMap, name);
        if (!key) continue;
        const stockInfo = stockMap.get(key);
        if (!stockInfo || stockInfo.infinite) continue;

        // Trier pour consommer en priorité les items déjà ouverts
        const matchingItems = liveFoodItems
          .filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite)
          .sort(sortStockDeductionPriority);

        if (neededCount > 0) {
          // --- Déduction par comptage (ex: "2 oeufs") ---
          let toDeduct = neededCount;
          for (const fi of matchingItems) {
            if (toDeduct <= 0) break;
            const fiCount = fi.quantity ?? 1;
            const deduct = Math.min(fiCount, toDeduct);
            const remaining = fiCount - deduct;
            toDeduct -= deduct;
            rememberSnapshot(fi);
            addPortionDelta(fi.id, 0, deduct);

            const counterToSet = forcedCounterDate;
            const effectiveCounterDate = counterToSet || new Date().toISOString();
            trackOldestCounter(fi, effectiveCounterDate);

            // Stock épuisé : toujours supprimer la ligne (même si compteur planifié).
            // Sinon une carte 0g reste visible ; le "programmé demain" vit sur la carte repas, pas sur un aliment fantôme.
            if (remaining <= 0) {
              updatesById.set(fi.id, { id: fi.id, delete: true });
            } else {
              const bumpCounter = needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate);
              // Ne pas effacer le compteur des unitaires restants (toujours « scellés » au sens grammes).
              const clearCtr =
                !bumpCounter &&
                !!fi.counter_start_date &&
                isFoodFullySealed({ ...fi, quantity: remaining } as FoodItem) &&
                !isCountOnlyFoodItem(fi);
              if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: Math.ceil(remaining),
                ...(bumpCounter ? { counter_start_date: effectiveCounterDate } : {}),
                ...(clearCtr ? { counter_start_date: null } : {}),
              });
            }
          }
        } else if (neededGrams > 0) {
          // --- Déduction par grammes (ex: "150g poulet") ---
          let toDeduct = neededGrams;
          for (const fi of matchingItems) {
            if (toDeduct <= 0) break;
            const perUnit = parseQty(fi.grams);
            if (perUnit <= 0) continue;
            const totalAvailable = getFoodItemTotalGrams(fi);
            const deduct = Math.min(totalAvailable, toDeduct);
            const remaining = totalAvailable - deduct;
            toDeduct -= deduct;
            rememberSnapshot(fi);
            addPortionDelta(fi.id, deduct, 0);

            const counterToSet = forcedCounterDate;
            const effectiveCounterDate = counterToSet || new Date().toISOString();
            trackOldestCounter(fi, effectiveCounterDate);

            if (remaining <= 0) {
              updatesById.set(fi.id, { id: fi.id, delete: true });
              continue;
            }

            if (fi.quantity && fi.quantity >= 1) {
              // Item multi-unités : recalculer unités complètes + reliquat
              const fullUnits = Math.floor(remaining / perUnit);
              const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              if (remainder > 0) {
                // Ouverture d'une nouvelle unité (reliquat > 0)
                const partialBefore = parsePartialQty(fi.grams);
                const hadOpenPartial = partialBefore > 0 && partialBefore < perUnit;
                const consumedPastFirstPartial = hadOpenPartial && deduct > partialBefore;
                const restartForNewPack =
                  consumedPastFirstPartial && shouldStartCounter(fi);
                const openingFromSealed = !hadOpenPartial && deduct > 0;
                const bumpCounter =
                  restartForNewPack ||
                  openingFromSealed ||
                  needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate);
                const counterUpdate = bumpCounter ? { counter_start_date: effectiveCounterDate } : {};
                if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
                updatesById.set(fi.id, {
                  id: fi.id,
                  quantity: Math.max(1, fullUnits + 1),
                  grams: encodeStoredGrams(perUnit, remainder),
                  ...counterUpdate,
                });
              } else if (fullUnits > 0) {
                // Unités complètes restantes → pas d'ouverture, reset du compteur
                updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
              } else {
                updatesById.set(fi.id, { id: fi.id, delete: true });
              }
            } else {
              // Item simple (sans multi-unités) : conserver l'unité d'origine (ex. 450|225)
              const openedPartial = remaining > 0 && remaining < perUnit;
              const bumpCounter =
                shouldStartCounter(fi) &&
                (needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate) || openedPartial);
              if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
              updatesById.set(fi.id, {
                id: fi.id,
                grams: encodeStoredGrams(perUnit, openedPartial ? remaining : null),
                ...(bumpCounter ? { counter_start_date: effectiveCounterDate } : {}),
              });
            }
          }
        }
      }
    }

    // Désactiver la subscription realtime AVANT les writes : sinon l'événement Supabase peut
    // déclencher un refetch avec une version répliquée en retard qui annule notre update.
    suppressStockRealtimeBriefly();

    // Identifiants des lignes concernées (avant exécution des writes).
    const updatedIds = Array.from(updatesById.values()).map((u) => u.id);
    const deletedIds = new Set(
      Array.from(updatesById.values()).filter((u) => u.delete).map((u) => u.id),
    );

    // Applique les UPDATE / DELETE en parallèle.
    // Chaque UPDATE chaîne `.select("*").single()` : on récupère la ligne renvoyée PAR LE PRIMAIRE
    // après écriture (fortement cohérente). Ça évite qu'une relecture séparée tape une réplique en
    // retard et réaffiche un stock périmé (bug « badge xN reste à x7 après déplacement »).
    const results = await safeMutate("Déduction du stock", () =>
      Promise.all(Array.from(updatesById.values()).map((u) =>
        u.delete
          ? supabase.from("food_items").delete().eq("id", u.id)
          : supabase.from("food_items").update({
            ...(u.grams !== undefined ? { grams: u.grams } : {}),
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
          } as any).eq("id", u.id).select("*").single()
      ))
    );

    // Construit un index id → ligne authoritative renvoyée par l'UPDATE (avant DELETE).
    const authoritativeById = new Map<string, FoodItem>();
    if (Array.isArray(results)) {
      for (const res of results) {
        if (!res || res.error) continue;
        const row = (res as { data?: FoodItem | null }).data;
        if (row && row.id && !deletedIds.has(row.id)) {
          authoritativeById.set(row.id, row as FoodItem);
        }
      }
    }

    // Mise à jour synchronisée du cache "food_items" :
    // 1) Optimistic update (instantané) pour que l'UI recalcule tout de suite (badge xN, etc.).
    // 2) Remplacement par les lignes authoritatives renvoyées par l'UPDATE lui-même.
    await qc.cancelQueries({ queryKey: ["food_items"] });
    const applyOptimistic = (old: FoodItem[] | undefined): FoodItem[] | undefined => {
      if (!Array.isArray(old)) return old;
      const next: FoodItem[] = [];
      for (const fi of old) {
        const u = updatesById.get(fi.id);
        if (!u) { next.push(fi); continue; }
        if (u.delete) continue;
        // Privilégier la ligne authoritative si disponible, sinon appliquer nos deltas.
        const auth = authoritativeById.get(fi.id);
        if (auth) { next.push(auth); continue; }
        next.push({
          ...fi,
          ...(u.grams !== undefined ? { grams: u.grams } : {}),
          ...(u.quantity !== undefined ? { quantity: u.quantity as number | null } : {}),
          ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
        } as FoodItem);
      }
      return next;
    };
    qc.setQueryData<FoodItem[]>(["food_items"], applyOptimistic);
    suppressStockRealtimeBriefly();
    const deletedSnapshots = Array.from(updatesById.values())
      .filter((u) => u.delete)
      .map((u) => snapshotsById.get(u.id))
      .filter((fi): fi is FoodItem => !!fi);
    syncDessertNameMemoryAfterDeletes(qc, deletedSnapshots);
    const consumedIngredients = buildConsumedIngredientsOverride(pickedAlternatives, meal.ingredients);
    return {
      snapshots: Array.from(snapshotsById.values()).map((fi) => {
        const delta = portionDeltasById.get(fi.id);
        return delta ? attachPortionDeduction(fi, delta) : fi;
      }),
      consumedIds: Array.from(updatesById.values()).filter(u => u.delete).map(u => u.id),
      oldestCounter: oldestCounter || openedAtDeduction,
      consumedIngredients,
    };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RESTAURATION DU STOCK (retour d'un repas)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Accumulateur de writes stock : mémorise les lignes autoritatives renvoyées par le primaire
   * (read-after-write via `.select()`), les suppressions et les insertions, afin de patcher le cache
   * React Query immédiatement (latence visuelle ≤ 1s) sans refetch sur une réplique en retard.
   */
  type StockWriteAccumulator = {
    authoritativeById: Map<string, FoodItem>;
    deletedIds: Set<string>;
    insertedItems: FoodItem[];
    working: FoodItem[];
  };

  /** Crée un accumulateur de writes stock à partir d'une base d'items (copie défensive). */
  const createStockAccumulator = (base: FoodItem[]): StockWriteAccumulator => ({
    authoritativeById: new Map(),
    deletedIds: new Set(),
    insertedItems: [],
    working: base.map((d) => ({ ...d })),
  });

  /** UPDATE avec read-after-write : mémorise la ligne renvoyée par le primaire dans l'accumulateur. */
  const accStockUpdate = async (
    acc: StockWriteAccumulator,
    label: string,
    id: string,
    payload: Record<string, unknown>,
  ) => {
    const res = await safeMutate(label, () =>
      supabase.from("food_items").update(payload as any).eq("id", id).select("*").single(),
    );
    if (res?.data?.id) {
      const mapped = mapFoodItemRow(res.data);
      acc.authoritativeById.set(id, mapped);
      const idx = acc.working.findIndex((f) => f.id === id);
      if (idx >= 0) acc.working[idx] = mapped;
    }
  };

  /** INSERT avec read-after-write : mémorise la ligne créée dans l'accumulateur. */
  const accStockInsert = async (
    acc: StockWriteAccumulator,
    label: string,
    row: Record<string, unknown>,
  ) => {
    const res = await safeMutate(label, () =>
      (supabase as any).from("food_items").insert(row).select("*").single(),
    );
    if (res?.data?.id) {
      const mapped = mapFoodItemRow(res.data);
      acc.insertedItems.push(mapped);
      acc.working.push(mapped);
    }
  };

  /** DELETE : mémorise l'id supprimé dans l'accumulateur. */
  const accStockDelete = async (acc: StockWriteAccumulator, label: string, id: string) => {
    await safeMutate(label, () => supabase.from("food_items").delete().eq("id", id));
    acc.deletedIds.add(id);
    acc.authoritativeById.delete(id);
    const idx = acc.working.findIndex((f) => f.id === id);
    if (idx >= 0) acc.working.splice(idx, 1);
  };

  /**
   * Applique immédiatement l'accumulateur au cache React Query et re-bloque le realtime,
   * au lieu d'un invalidate + refetch qui pourrait retomber sur une réplique Supabase en retard.
   */
  const commitStockAccumulator = async (acc: StockWriteAccumulator) => {
    await qc.cancelQueries({ queryKey: ["food_items"] });
    qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
      if (!Array.isArray(old)) return acc.working;
      const next = old
        .filter((fi) => !acc.deletedIds.has(fi.id))
        .map((fi) => acc.authoritativeById.get(fi.id) ?? fi);
      for (const ins of acc.insertedItems) {
        if (!next.some((f) => f.id === ins.id)) next.push(ins);
      }
      return next;
    });
    suppressStockRealtimeBriefly();
  };

  /**
   * Rend au stock uniquement la portion déduite pour une carte Possible (grammes ou unités).
   * Écrit via l'accumulateur (read-after-write) et travaille sur `acc.working` pour rester cohérent
   * entre plusieurs snapshots sans refetch intermédiaire.
   */
  const addPortionBackToStockItem = async (
    snap: FoodItem,
    portion: { grams: number; quantity: number },
    acc: StockWriteAccumulator,
  ) => {
    const { grams: neededGrams, quantity: neededCount } = portion;
    if (neededGrams <= 0 && neededCount <= 0) return;

    const name = snap.name;
    const matchingItems = acc.working
      .filter((fi) => (snap.id ? fi.id === snap.id : strictNameMatch(fi.name, name)) && !fi.is_infinite)
      .sort(sortStockDeductionPriority);

    if (matchingItems.length === 0) {
      const template = stripPortionDeductionMeta(snap);
      const { id: _id, created_at: _ca, ...rest } = template as Record<string, unknown>;
      if (neededCount > 0) {
        await accStockInsert(acc, "Restauration portion (recréation count)", {
          ...rest,
          quantity: neededCount,
        });
      } else if (neededGrams > 0) {
        const unitGrams = parseQty(template.grams);
        if (unitGrams > 0) {
          const fullUnits = Math.floor(neededGrams / unitGrams);
          const rem = Math.round((neededGrams - fullUnits * unitGrams) * 10) / 10;
          await accStockInsert(acc, "Restauration portion (recréation grams)", {
            ...rest,
            quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
            grams: encodeStoredGrams(unitGrams, rem > 0 ? rem : null),
          });
        } else {
          await accStockInsert(acc, "Restauration portion (recréation simple)", {
            ...rest,
            grams: formatNumeric(neededGrams),
          });
        }
      }
      return;
    }

    const fi = matchingItems[0];
    // On revient à l'état d'ouverture d'AVANT le passage en Possible : le snapshot fait foi.
    // - snapshot ouvert (ex. portion ouverte vendredi midi) → on garde la date la plus ancienne.
    // - snapshot scellé (pas de compteur) → on N'hérite PAS du compteur « maintenant » posé par la
    //   déduction ; sinon le compteur resterait lancé après le retour dans « au choix ».
    const restoredCounter = snap.counter_start_date
      ? earlierCounterDate(fi.counter_start_date, snap.counter_start_date)
      : null;
    if (neededCount > 0) {
      const newQty = (fi.quantity ?? 1) + neededCount;
        const synthetic = { ...fi, quantity: newQty } as FoodItem;
        const clearCtr = isFoodFullySealed(synthetic);
        const counterUpdate = { counter_start_date: clearCtr ? null : restoredCounter };
        await accStockUpdate(acc, "Restauration portion (count)", fi.id, {
          quantity: Math.ceil(newQty),
          ...counterUpdate,
        });
    }
    if (neededGrams > 0) {
      const fiGrams = parseQty(fi.grams);
      if (fi.quantity && fi.quantity >= 1 && fiGrams > 0) {
        const currentTotal = getFoodItemTotalGrams(fi);
        const newTotal = currentTotal + neededGrams;
        const fullUnits = Math.floor(newTotal / fiGrams);
        const remainder = Math.round((newTotal - fullUnits * fiGrams) * 10) / 10;
        const newQty = remainder > 0 ? fullUnits + 1 : fullUnits;
        const newGramsStr = encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null);
        const synthetic = { ...fi, quantity: newQty, grams: newGramsStr } as FoodItem;
        const clearCtr = isFoodFullySealed(synthetic);
        const counterUpdate = { counter_start_date: clearCtr ? null : restoredCounter };
        await accStockUpdate(acc, "Restauration portion (grams)", fi.id, {
          quantity: newQty,
          grams: newGramsStr,
          ...counterUpdate,
        });
      } else {
        const currentTotal = fiGrams;
        const newG = formatNumeric(currentTotal + neededGrams);
        const synthetic = { ...fi, grams: newG } as FoodItem;
        const clearCtr = isFoodFullySealed(synthetic);
        const counterUpdate = { counter_start_date: clearCtr ? null : restoredCounter };
        await accStockUpdate(acc, "Restauration portion (simple)", fi.id, {
          grams: newG,
          ...counterUpdate,
        });
      }
    }
  };

  /**
   * Restaure les ingrédients dans le stock.
   * 
   * Deux modes :
   * 1. Avec snapshots → portion déduite (delta) si métadonnées présentes, sinon upsert legacy
   * 2. Sans snapshots → estimation en ajoutant les quantités de la recette
   */
  const restoreIngredientsToStock = async (
    meal: Meal,
    snapshots?: FoodItem[],
    options?: RestoreIngredientsOptions,
  ): Promise<FoodItem[]> => {
    // Bloquer le realtime avant les writes pour que le refetch réplica ne réécrase pas notre cache.
    suppressStockRealtimeBriefly();

    if (snapshots && snapshots.length > 0) {
      const usePortionRestore = snapshots.some(hasPortionDeductionMeta);
      if (usePortionRestore) {
        // Base = cache React Query (déjà à jour après la déduction), enrichi au fil des writes.
        const acc = createStockAccumulator(getLiveFoodItems());
        for (const snap of snapshots) {
          const portion = getPortionDeduction(snap);
          await addPortionBackToStockItem(snap, portion, acc);
        }
        await commitStockAccumulator(acc);
        return acc.working;
      }

      // Mode legacy : upsert de l'état complet (anciens snapshots sans delta).
      // Read-after-write via `.select()` pour patcher le cache immédiatement, sans refetch stale.
      const acc = createStockAccumulator(getLiveFoodItems());
      const results = await safeMutate("Restauration du stock", () =>
        Promise.all(snapshots.map((fi) => {
          const clean = stripPortionDeductionMeta(fi);
          const sealed = isFoodFullySealed(clean);
          return (supabase as any).from("food_items").upsert({
            id: clean.id, name: clean.name, grams: clean.grams, calories: clean.calories,
            protein: clean.protein, is_indivisible: clean.is_indivisible,
            expiration_date: clean.expiration_date,
            counter_start_date: sealed ? null : clean.counter_start_date,
            no_counter: clean.no_counter,
            sort_order: clean.sort_order, created_at: clean.created_at, is_meal: clean.is_meal,
            is_infinite: clean.is_infinite, is_dry: clean.is_dry, storage_type: clean.storage_type,
            quantity: clean.quantity, food_type: clean.food_type,
          }).select("*").single();
        }))
      );
      if (Array.isArray(results)) {
        for (const res of results) {
          const row = res?.data;
          if (!row?.id) continue;
          const mapped = mapFoodItemRow(row);
          const idx = acc.working.findIndex((f) => f.id === mapped.id);
          if (idx >= 0) { acc.working[idx] = mapped; acc.authoritativeById.set(mapped.id, mapped); }
          else { acc.working.push(mapped); acc.insertedItems.push(mapped); }
        }
      }
      await commitStockAccumulator(acc);
      return acc.working;
    }

    // Mode 2 : restauration estimée depuis la recette
    if (!meal.ingredients?.trim()) return [];

    // Base = cache React Query (à jour après déduction), enrichi au fil des writes read-after-write.
    const acc = createStockAccumulator(getLiveFoodItems());
    const currentFoodItems = acc.working;

    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      // Pour la restauration on prend le premier bundle (celui qui a été déduit à l'origine),
      // PAS pickBestAlternative qui choisirait en fonction du stock actuel (post-déduction).
      const altBundle = group[0];
      if (!altBundle) continue;

      for (const alt of altBundle) {
        const { qty: neededGrams, count: neededCount, name } = alt;
        if (neededGrams <= 0 && neededCount <= 0) continue;
        const hasInfiniteMatch = currentFoodItems.some((fi) => strictNameMatch(fi.name, name) && fi.is_infinite);
        if (hasInfiniteMatch) continue;
        const matchingItems = currentFoodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite).sort(sortStockDeductionPriority);

        if (matchingItems.length === 0) {
          // Aliment entièrement consommé et supprimé du stock → le recréer à partir de la
          // bibliothèque ou en créant un minimum viable pour que le stock soit cohérent.
          const templateFi = foodItems.find(fi => strictNameMatch(fi.name, name) && !fi.is_infinite);
          const storageFallback = templateFi?.storage_type ?? 'frigo';
          const unitGrams = templateFi ? parseQty(templateFi.grams) : 0;
          const recreatedMeta = resolveRecreatedFoodItemMeta(templateFi, name, storageFallback, options);

          if (neededCount > 0) {
            await accStockInsert(acc, "Restauration stock (recréation count)", {
              name: templateFi?.name ?? name,
              quantity: neededCount,
              grams: templateFi?.grams ?? null,
              calories: templateFi?.calories ?? null,
              protein: templateFi?.protein ?? null,
              is_indivisible: templateFi?.is_indivisible ?? false,
              expiration_date: recreatedMeta.expiration_date,
              counter_start_date: recreatedMeta.counter_start_date,
              no_counter: templateFi?.no_counter ?? false,
              is_meal: templateFi?.is_meal ?? false,
              is_infinite: false,
              is_dry: templateFi?.is_dry ?? false,
              storage_type: storageFallback,
              food_type: templateFi?.food_type ?? null,
            });
          } else if (neededGrams > 0 && unitGrams > 0) {
            const fullUnits = Math.floor(neededGrams / unitGrams);
            const rem = Math.round((neededGrams - fullUnits * unitGrams) * 10) / 10;
            await accStockInsert(acc, "Restauration stock (recréation grams)", {
              name: templateFi?.name ?? name,
              quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
              grams: encodeStoredGrams(unitGrams, rem > 0 ? rem : null),
              calories: templateFi?.calories ?? null,
              protein: templateFi?.protein ?? null,
              is_indivisible: templateFi?.is_indivisible ?? false,
              expiration_date: recreatedMeta.expiration_date,
              counter_start_date: recreatedMeta.counter_start_date,
              no_counter: templateFi?.no_counter ?? false,
              is_meal: templateFi?.is_meal ?? false,
              is_infinite: false,
              is_dry: templateFi?.is_dry ?? false,
              storage_type: storageFallback,
              food_type: templateFi?.food_type ?? null,
            });
          } else if (neededGrams > 0) {
            await accStockInsert(acc, "Restauration stock (recréation simple)", {
              name: templateFi?.name ?? name,
              grams: formatNumeric(neededGrams),
              calories: templateFi?.calories ?? null,
              protein: templateFi?.protein ?? null,
              is_indivisible: templateFi?.is_indivisible ?? false,
              expiration_date: recreatedMeta.expiration_date,
              counter_start_date: recreatedMeta.counter_start_date,
              no_counter: templateFi?.no_counter ?? false,
              is_meal: templateFi?.is_meal ?? false,
              is_infinite: false,
              is_dry: templateFi?.is_dry ?? false,
              storage_type: storageFallback,
              food_type: templateFi?.food_type ?? null,
            });
          }
          continue;
        }

        const fi = matchingItems[0];
        if (neededCount > 0) {
          const newQty = (fi.quantity ?? 1) + neededCount;
          await accStockUpdate(acc, "Restauration stock (count)", fi.id, { quantity: Math.ceil(newQty) });
        } else if (neededGrams > 0) {
          const fiGrams = parseQty(fi.grams);
          if (fi.quantity && fi.quantity >= 1 && fiGrams > 0) {
            const currentTotal = getFoodItemTotalGrams(fi);
            const newTotal = currentTotal + neededGrams;
            const fullUnits = Math.floor(newTotal / fiGrams);
            const remainder = Math.round((newTotal - fullUnits * fiGrams) * 10) / 10;
            const newQty = remainder > 0 ? fullUnits + 1 : fullUnits;
            const newGramsStr = encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null);
            const synthetic = { ...fi, quantity: newQty, grams: newGramsStr } as FoodItem;
            const clearCtr = isFoodFullySealed(synthetic);
            await accStockUpdate(acc, "Restauration stock (grams)", fi.id, {
              quantity: newQty,
              grams: newGramsStr,
              ...(clearCtr ? { counter_start_date: null } : {}),
            });
          } else {
            const currentTotal = fiGrams;
            const newG = formatNumeric(currentTotal + neededGrams);
            const synthetic = { ...fi, grams: newG } as FoodItem;
            const clearCtr = isFoodFullySealed(synthetic);
            await accStockUpdate(acc, "Restauration stock (simple)", fi.id, {
              grams: newG,
              ...(clearCtr ? { counter_start_date: null } : {}),
            });
          }
        }
      }
    }
    // Restauration par correspondance de nom (repas sans ingrédients)
    const mealGrams = parseQty(meal.grams);
    if (mealGrams > 0) {
      const nameMatch = currentFoodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch) {
        const unit = parseQty(nameMatch.grams);
        if (nameMatch.quantity && nameMatch.quantity >= 1 && unit > 0) {
          const currentTotal = getFoodItemTotalGrams(nameMatch);
          const newTotal = currentTotal + mealGrams;
          const fullUnits = Math.floor(newTotal / unit);
          const remainder = Math.round((newTotal - fullUnits * unit) * 10) / 10;
          const newQty = remainder > 0 ? fullUnits + 1 : fullUnits;
          const newGramsStr = encodeStoredGrams(unit, remainder > 0 ? remainder : null);
          const synthetic = { ...nameMatch, quantity: newQty, grams: newGramsStr } as FoodItem;
          const clearCtr = isFoodFullySealed(synthetic);
          await accStockUpdate(acc, "Restauration nom", nameMatch.id, {
            quantity: newQty,
            grams: newGramsStr,
            ...(clearCtr ? { counter_start_date: null } : {}),
          });
        } else {
          const newG = formatNumeric(unit + mealGrams);
          const synthetic = { ...nameMatch, grams: newG } as FoodItem;
          const clearCtr = isFoodFullySealed(synthetic);
          await accStockUpdate(acc, "Restauration nom (simple)", nameMatch.id, {
            grams: newG,
            ...(clearCtr ? { counter_start_date: null } : {}),
          });
        }
      }
    }
    await commitStockAccumulator(acc);
    return acc.working;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // AJUSTEMENT DELTA (modification des ingrédients d'une carte Possible)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Ajuste le stock quand les ingrédients d'un repas "Possible" sont modifiés.
   * 
   * Calcule le delta entre ancien et nouveau pour chaque ingrédient :
   * - Delta positif → déduire plus du stock
   * - Delta négatif → rendre au stock
   * 
   * Récupère les données fraîches de Supabase pour éviter les erreurs de concurrence.
   * Retourne les nouveaux snapshots créés pour les items nouvellement affectés.
   */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null, snapshots?: FoodItem[]): Promise<FoodItem[]> => {
    const newSnapshots: FoodItem[] = [];
    const existingSnapshotIds = new Set(snapshots?.map(s => s.id) ?? []);

    // Préférer le cache React Query (déjà à jour après une déduction précédente) pour éviter
    // de recalculer les deltas sur une lecture réplica potentiellement en retard.
    const cachedItems = qc.getQueryData<FoodItem[]>(["food_items"]);
    const currentFoodItems: FoodItem[] = Array.isArray(cachedItems) && cachedItems.length > 0
      ? cachedItems.map((d) => ({ ...d }))
      : (await fetchAllFoodItems()).map((d) => ({ ...d }));

    const deletedIds = new Set<string>();
    const authoritativeById = new Map<string, FoodItem>();
    const insertedItems: FoodItem[] = [];

    /** Persiste une mise à jour et mémorise la ligne renvoyée par le primaire (pas de refetch). */
    const persistStockUpdate = async (label: string, id: string, payload: Record<string, unknown>) => {
      const res = await safeMutate(label, () =>
        supabase.from("food_items").update(payload as any).eq("id", id).select("*").single(),
      );
      const row = res?.data;
      if (row?.id) {
        const mapped = mapFoodItemRow(row);
        authoritativeById.set(id, mapped);
        const idx = currentFoodItems.findIndex((f) => f.id === id);
        if (idx >= 0) currentFoodItems[idx] = mapped;
      }
    };

    /** Supprime une fiche stock et retire-la du cache local de travail. */
    const persistStockDelete = async (label: string, id: string) => {
      await safeMutate(label, () => supabase.from("food_items").delete().eq("id", id));
      deletedIds.add(id);
      authoritativeById.delete(id);
      const idx = currentFoodItems.findIndex((f) => f.id === id);
      if (idx >= 0) currentFoodItems.splice(idx, 1);
    };

    /** Recrée une fiche stock et mémorise la ligne créée. */
    const persistStockInsert = async (label: string, row: Record<string, unknown>) => {
      const res = await safeMutate(label, () =>
        supabase.from("food_items").insert(row as any).select("*").single(),
      );
      const data = res?.data;
      if (data?.id) {
        const mapped = mapFoodItemRow(data);
        insertedItems.push(mapped);
        currentFoodItems.push(mapped);
      }
    };

    // Bloquer le realtime avant les writes (évite qu'un refetch réplica écrase le cache).
    suppressStockRealtimeBriefly();

    // Construire les maps d'utilisation ancien vs nouveau
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];

    /** Construit une map nom → { grams, count } des quantités utilisées (ignore les optionnels). */
    const buildUsageMap = (groups: any[][][]) => {
      const map = new Map<string, { grams: number; count: number }>();
      for (const group of groups) {
        if (group.every(alt => alt.every((item: any) => item.optional))) continue;
        if (group.length > 0) {
          const bundle = group[0]; // On prend la première alternative par défaut pour le delta
          for (const item of bundle) {
            if (item.optional) continue;
            const prev = map.get(item.name) ?? { grams: 0, count: 0 };
            map.set(item.name, { grams: prev.grams + (item.qty || 0), count: prev.count + (item.count || 0) });
          }
        }
      }
      return map;
    };

    const oldUsage = buildUsageMap(oldGroups);
    const newUsage = buildUsageMap(newGroups);
    const allKeys = new Set([...oldUsage.keys(), ...newUsage.keys()]);

    for (const ingName of allKeys) {
      const oldU = oldUsage.get(ingName) ?? { grams: 0, count: 0 };
      const newU = newUsage.get(ingName) ?? { grams: 0, count: 0 };
      const deltaGrams = newU.grams - oldU.grams;
      const deltaCount = newU.count - oldU.count;
      if (deltaGrams === 0 && deltaCount === 0) continue;

      const matchingItems = currentFoodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite).sort(sortStockDeductionPriority);

      // --- Delta grammes positif : déduire plus ---
      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          if (deletedIds.has(fi.id)) continue;
          const liveFi = authoritativeById.get(fi.id) ?? fi;
          const totalAvail = getFoodItemTotalGrams(liveFi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...liveFi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await persistStockDelete("Ajustement stock", fi.id);
          } else {
            const perUnit = parseQty(liveFi.grams);
            if (liveFi.quantity && liveFi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              const shouldStart = rem > 0 && !liveFi.counter_start_date && shouldStartCounter(liveFi);
              const shouldClear = rem <= 0 && liveFi.counter_start_date;
              await persistStockUpdate("Ajustement stock", fi.id, {
                quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits,
                grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}),
                ...(shouldClear ? { counter_start_date: null } : {}),
              });
            } else {
              const shouldStart = remaining > 0 && remaining < parseQty(liveFi.grams) && !liveFi.counter_start_date && shouldStartCounter(liveFi);
              await persistStockUpdate("Ajustement stock", fi.id, {
                grams: formatNumeric(remaining),
                ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}),
              });
            }
          }
        }
      }
      // --- Delta grammes négatif : rendre au stock ---
      else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi
          ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null)
          : (matchingItems.find((f) => !deletedIds.has(f.id)) ?? null);

        if (fi && !deletedIds.has(fi.id)) {
          const liveFi = authoritativeById.get(fi.id) ?? fi;
          const perUnit = parseQty(liveFi.grams);
          if (liveFi.quantity && liveFi.quantity >= 1 && perUnit > 0) {
            const currentTotal = getFoodItemTotalGrams(liveFi);
            const newTotal = currentTotal + toAdd;
            const fullUnits = Math.floor(newTotal / perUnit);
            const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
            const shouldClear = rem <= 0 && liveFi.counter_start_date;
            await persistStockUpdate("Ajustement stock", fi.id, {
              quantity: rem > 0 ? fullUnits + 1 : fullUnits,
              grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
              ...(shouldClear ? { counter_start_date: null } : {}),
            });
          } else {
            const current = parseQty(liveFi.grams);
            await persistStockUpdate("Ajustement stock", fi.id, {
              grams: formatNumeric(current + toAdd),
            });
          }
        } else if (snapshotFi) {
          // Item entièrement consommé et supprimé → le recréer depuis le snapshot
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          const perUnit = parseQty(snapshotFi.grams);
          if (snapshotFi.quantity !== null && snapshotFi.quantity >= 1 && perUnit > 0) {
            const fullUnits = Math.floor(toAdd / perUnit);
            const rem = Math.round((toAdd - fullUnits * perUnit) * 10) / 10;
            await persistStockInsert("Ajustement stock (recréation)", {
              ...rest,
              quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
              grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
              counter_start_date: snapshotFi.counter_start_date,
            });
          } else {
            await persistStockInsert("Ajustement stock (recréation)", {
              ...rest,
              grams: formatNumeric(toAdd),
              counter_start_date: snapshotFi.counter_start_date,
            });
          }
        }
      }

      // --- Delta comptage positif : déduire plus ---
      if (deltaCount > 0) {
        let toDeduct = deltaCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          if (deletedIds.has(fi.id)) continue;
          const liveFi = authoritativeById.get(fi.id) ?? fi;
          const fiCount = liveFi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          toDeduct -= deduct;
          const remaining = fiCount - deduct;
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...liveFi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await persistStockDelete("Ajustement stock (count)", fi.id);
          } else {
            const nowIso = new Date().toISOString();
            const bumpCtr =
              shouldStartCounter(liveFi) &&
              needsCounterUpdate(liveFi, nowIso) &&
              isCountOnlyFoodItem(liveFi);
            const clearCtr =
              !bumpCtr &&
              liveFi.counter_start_date &&
              isFoodFullySealed({ ...liveFi, quantity: remaining } as FoodItem) &&
              !isCountOnlyFoodItem(liveFi);
            await persistStockUpdate("Ajustement stock (count)", fi.id, {
              quantity: remaining,
              ...(bumpCtr ? { counter_start_date: nowIso } : {}),
              ...(clearCtr ? { counter_start_date: null } : {}),
            });
          }
        }
      }
      // --- Delta comptage négatif : rendre au stock ---
      else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi
          ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null)
          : (matchingItems.find((f) => !deletedIds.has(f.id)) ?? null);

        if (fi && !deletedIds.has(fi.id)) {
          const liveFi = authoritativeById.get(fi.id) ?? fi;
          await persistStockUpdate("Ajustement stock (count)", fi.id, {
            quantity: (liveFi.quantity ?? 1) + toAdd,
          });
        } else if (snapshotFi) {
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          await persistStockInsert("Ajustement stock (recréation count)", {
            ...rest,
            quantity: toAdd,
            grams: grams,
            counter_start_date: snapshotFi.counter_start_date,
          });
        }
      }
    }

    // Mise à jour immédiate du cache (pas de refetch qui pourrait retomber sur une réplique stale).
    await qc.cancelQueries({ queryKey: ["food_items"] });
    qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
      if (!Array.isArray(old)) return currentFoodItems;
      const next = old
        .filter((fi) => !deletedIds.has(fi.id))
        .map((fi) => authoritativeById.get(fi.id) ?? fi);
      for (const ins of insertedItems) {
        if (!next.some((f) => f.id === ins.id)) next.push(ins);
      }
      return next;
    });
    suppressStockRealtimeBriefly();
    return newSnapshots;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION PAR NOM (repas sans ingrédients détaillés)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit du stock par correspondance de nom (pour les repas sans liste d'ingrédients).
   * Cherche un aliment portant le même nom que le repas et déduit les grammes ou 1 unité.
   * Retourne la portion retirée pour la restauration au retour depuis Possible.
   */
  const deductNameMatchStock = async (
    meal: Meal,
    forcedCounterDate?: string,
    ratio: number = 1
  ): Promise<{ gramsDeducted: number; quantityDeducted: number }> => {
    const none = { gramsDeducted: 0, quantityDeducted: 0 };
    const liveFoodItems = getLiveFoodItems();
    const nameMatch = liveFoodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return none;

    // Bloquer le realtime avant les writes : sinon l'événement Supabase peut déclencher un refetch
    // sur une réplique en retard qui écraserait notre mise à jour immédiate du cache.
    suppressStockRealtimeBriefly();

    // Ligne autoritative renvoyée par le primaire (UPDATE) ou id supprimé, pour patcher le cache
    // React Query sans refetch stale (latence visuelle ≤ 1s).
    let authoritativeRow: FoodItem | null = null;
    let deletedId: string | null = null;

    /** Persiste une mise à jour et mémorise la ligne renvoyée par le primaire (pas de refetch). */
    const persistNameUpdate = async (label: string, payload: Record<string, unknown>) => {
      const res = await safeMutate(label, () =>
        supabase.from("food_items").update(payload as any).eq("id", nameMatch.id).select("*").single(),
      );
      if (res?.data?.id) authoritativeRow = mapFoodItemRow(res.data);
    };

    /** Supprime la fiche stock et mémorise l'id pour le retirer du cache local. */
    const persistNameDelete = async (label: string) => {
      await safeMutate(label, () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      deletedId = nameMatch.id;
    };

    /**
     * Applique immédiatement le résultat au cache React Query (suppression ou ligne autoritative)
     * et re-bloque le realtime, au lieu de faire un invalidate + refetch potentiellement stale.
     */
    const commitNameCache = async () => {
      await qc.cancelQueries({ queryKey: ["food_items"] });
      qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
        if (!Array.isArray(old)) return old;
        if (deletedId) return old.filter((fi) => fi.id !== deletedId);
        if (authoritativeRow) return old.map((fi) => (fi.id === authoritativeRow!.id ? authoritativeRow! : fi));
        return old;
      });
      suppressStockRealtimeBriefly();
    };

    // Calculer le poids de base à déduire. Si le repas n'a pas de poids, on prend celui de l'aliment.
    let baseG = parseQty(meal.grams);
    if (baseG <= 0 && nameMatch.grams) {
      baseG = parseQty(nameMatch.grams) * (nameMatch.quantity || 1);
    }
    const mealGrams = baseG * ratio;

    const counterToSet = forcedCounterDate || new Date().toISOString();
    const canStartCounter = shouldStartCounter(nameMatch);

    if (mealGrams <= 0) {
      // Pas de grammes spécifiés → déduire 1 unité (ex. repas « Blanc de dinde » sans grammage)
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await persistNameDelete("Déduction nom");
      } else {
        const bumpCounter = canStartCounter && needsCounterUpdate(nameMatch, counterToSet, forcedCounterDate);
        const clearCtr =
          !bumpCounter &&
          nameMatch.counter_start_date &&
          isFoodFullySealed({ ...nameMatch, quantity: currentQty - 1 } as FoodItem) &&
          !isCountOnlyFoodItem(nameMatch);
        await persistNameUpdate("Déduction nom", {
          quantity: currentQty - 1,
          ...(bumpCounter ? { counter_start_date: counterToSet } : {}),
          ...(clearCtr ? { counter_start_date: null } : {}),
        });
      }
      await commitNameCache();
      return { gramsDeducted: 0, quantityDeducted: 1 };
    }

    // Déduction par grammes
    const perUnit = parseQty(nameMatch.grams);
    if (nameMatch.quantity && nameMatch.quantity >= 1 && perUnit > 0) {
      const totalAvailable = getFoodItemTotalGrams(nameMatch);
      const remaining = totalAvailable - mealGrams;
      if (remaining <= 0) {
        await persistNameDelete("Déduction nom");
      } else {
        const fullUnits = Math.floor(remaining / perUnit);
        const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
        if (remainder > 0) {
          // Ne pas écraser un compteur déjà lancé (passé) : on garde la date d'ouverture d'origine.
          const bumpCounter = canStartCounter && needsCounterUpdate(nameMatch, counterToSet, forcedCounterDate);
          await persistNameUpdate("Déduction nom", {
            quantity: Math.max(1, fullUnits + 1),
            grams: encodeStoredGrams(perUnit, remainder),
            ...(bumpCounter ? { counter_start_date: counterToSet } : {})
          });
        } else if (fullUnits > 0) {
          await persistNameUpdate("Déduction nom", {
            quantity: fullUnits,
            grams: formatNumeric(perUnit),
            ...(nameMatch.counter_start_date ? { counter_start_date: null } : {})
          });
        } else {
          await persistNameDelete("Déduction nom");
        }
      }
    } else {
      const current = parseQty(nameMatch.grams);
      const remaining = Math.max(0, current - mealGrams);
      if (remaining <= 0) {
        await persistNameDelete("Déduction nom");
      } else {
        const isNewUnit = remaining > 0 && remaining < current;
        // Ne pas réinitialiser un compteur déjà lancé (passé) lors d'une consommation partielle.
        const bumpCounter = canStartCounter && isNewUnit && needsCounterUpdate(nameMatch, counterToSet, forcedCounterDate);
        await persistNameUpdate("Déduction nom", {
          grams: formatNumeric(remaining),
          ...(bumpCounter ? { counter_start_date: counterToSet } : {})
        });
      }
    }
    await commitNameCache();
    return { gramsDeducted: mealGrams, quantityDeducted: 0 };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // SYNCHRONISATION DES COMPTEURS AVEC LE PLANNING
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Met à jour les counter_start_date des aliments quand le planning d'un repas change.
   * 
   * Pour chaque ingrédient affecté :
   * 1. Collecte toutes les dates de planification des repas utilisant cet ingrédient
   * 2. Détermine la date la plus ancienne
   * 3. Met à jour le compteur de l'aliment en conséquence
   * 
   * Protège les compteurs manuels (ouverts manuellement avant toute planification).
   */
  const updateFoodItemCountersForPlanning = async (
    pmId: string | null,
    ingredients: string | null,
    dayOfWeek: string | null,
    mealTime: string | null,
    fallbackDate?: string | null,
    createdAt?: string | null,
    allPossibleMeals: any[] = []
  ) => {
    if (!ingredients?.trim()) return;
    /** Jour + créneau (matin/midi/soir) : on synchronise toujours sur l’horaire du repas planifié. */
    const fullPlanningSlot =
      Boolean(dayOfWeek) && String(mealTime ?? "").trim().length > 0;
    const groups = parseIngredientGroups(ingredients);

    // Updates à appliquer en une seule passe : on les collecte d'abord, puis on les écrit
    // en batch avec .select().single() pour récupérer la ligne authoritative et patcher le cache.
    // Cela évite qu'un événement realtime sur replica en retard ré-écrase notre update.
    const pendingUpdates = new Map<string, string | null>();

    for (const group of groups) {
      // group : ParsedIngredient[][] — chaque entrée est une branche « OU », chaque branche un bundle « + ».
      if (group.every(altBundle => altBundle.every((item) => item.optional))) continue;

      for (const bundle of group) {
        for (const item of bundle) {
          if (item.optional || !item.name) continue;
          const nameTokens = expandOrGroupIngredientNames(item);
          for (const nameToken of nameTokens) {
      // Aliments en stock correspondant à cet ingrédient (hors infini, compteur autorisé).
          const liveFoodItems = getLiveFoodItems();
          const nameMatches = liveFoodItems.filter(
        (fi) => strictNameMatch(fi.name, nameToken) && !fi.is_infinite && shouldStartCounter(fi),
      );

      // Le « prog. » vit sur la carte repas ; on ne synchronise le stock que pour les lots déjà entamés.
      const matchingItems = nameMatches;

      for (const fi of matchingItems) {
        const currentCounterMs = fi.counter_start_date ? new Date(fi.counter_start_date).getTime() : NaN;
        const nowMsAtItem = new Date().getTime();

        // Lot encore scellé : pas de compteur si le paquet est plein (boîte 400g = 400g, #2 lardons, etc.).
        // Exception : pot unique + recette partielle (ex. 50g sur pot de 225g).
        // Exception 2 : unitaires — uniquement le lot qui a déjà un counter_start_date
        // (posé à la déduction sur CET id), pas tous les homonymes.
        if (isFoodFullySealed(fi)) {
          if (isCountOnlyFoodItem(fi)) {
            if (!fi.counter_start_date?.trim()) {
              continue;
            }
            // Unitaire déjà prélevé (ce lot) : laisser la synchro Prog. / ouverture ci-dessous.
          } else {
            const partialPastOpen = isSealedPartialUseInPastPlanning(
              fi,
              allPossibleMeals,
              new Date(nowMsAtItem),
            );
            if (!partialPastOpen) {
              if (fi.counter_start_date?.trim()) {
                pendingUpdates.set(fi.id, null);
              }
            } else {
              if (fi.counter_start_date?.trim()) {
                const ctrMs = new Date(fi.counter_start_date).getTime();
                if (
                  ctrMs > nowMsAtItem &&
                  counterMatchesPlannedSlot(fi, fi.counter_start_date, allPossibleMeals)
                ) {
                  pendingUpdates.set(fi.id, null);
                }
              }
              const pastOpen = findEarliestPastPlannedOpenForFood(
                fi,
                allPossibleMeals,
                new Date(nowMsAtItem),
              );
              if (pastOpen) {
                const cur = fi.counter_start_date?.trim();
                if (!cur) {
                  pendingUpdates.set(fi.id, pastOpen);
                } else {
                  const curMs = new Date(cur).getTime();
                  const pastMs = new Date(pastOpen).getTime();
                  if (curMs > nowMsAtItem || pastMs < curMs) {
                    pendingUpdates.set(fi.id, pastOpen);
                  }
                }
              }
            }
            continue;
          }
        }

        // Créneau planifié déjà passé, lot entamé mais sans compteur → ouvrir rétroactivement au créneau.
        if (fullPlanningSlot && pmId && dayOfWeek && !fi.counter_start_date?.trim()) {
          const slotIso = computePlannedCounterDate(dayOfWeek, mealTime);
          const slotMs = new Date(slotIso).getTime();
          if (Number.isFinite(slotMs) && slotMs <= nowMsAtItem) {
            pendingUpdates.set(fi.id, slotIso);
            continue;
          }
        }

        if (fullPlanningSlot && Number.isFinite(currentCounterMs) && currentCounterMs > nowMsAtItem) {
          // Le lot porte déjà un compteur FUTUR (« prog. »). Avant de le nettoyer, vérifier s'il reste
          // justifié par une AUTRE carte planifiée (sibling) qui consomme ce lot à un créneau futur.
          // Ex. « Riz + Tenders » planifié lundi soir a ouvert les Tenders : planifier « Patatoes + Tenders »
          // mercredi soir ne doit PAS effacer l'ouverture de lundi (sinon plus de prog ni de décalage Xj).
          const hasFuturePlannedSiblingForLot = allPossibleMeals.some((pm) => {
            if (pm.id === pmId) return false;
            if (!pm.day_of_week || !String(pm.meal_time ?? "").trim()) return false;
            const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
            if (!pmIngs?.trim()) return false;
            const shares = parseIngredientGroups(pmIngs).some((g) =>
              g.some((altBundle) =>
                altBundle.some(
                  (it) =>
                    !it.optional &&
                    expandOrGroupIngredientNames(it).some((t) => strictNameMatch(fi.name, t)),
                ),
              ),
            );
            if (!shares) return false;
            return new Date(computePlannedCounterDate(pm.day_of_week, pm.meal_time)).getTime() > nowMsAtItem;
          });
          // Pas de sibling futur → vrai reliquat : restaurer une ouverture réelle passée ou nettoyer.
          if (!hasFuturePlannedSiblingForLot) {
            const fallbackMs = fallbackDate ? new Date(fallbackDate).getTime() : NaN;
            if (Number.isFinite(fallbackMs) && fallbackMs <= nowMsAtItem) {
              pendingUpdates.set(fi.id, fallbackDate!);
            } else {
              pendingUpdates.set(fi.id, null);
            }
            continue;
          }
          // Sinon : laisser la logique normale ci-dessous recalculer le min des créneaux futurs
          // (conserve l'ouverture la plus précoce, ex. lundi soir).
        }

        // Objectif : faire pointer le compteur de l’aliment sur la date FUTURE LA PLUS PROCHE
        // parmi tous les repas planifiés qui l’utilisent. Un repas planifié dans le passé
        // (en retard, non consommé) ne doit pas écraser cette date future ; sinon le compteur
        // reste bloqué sur un créneau déjà passé au lieu d’afficher « Prog. ».
        let earliestDateStr: string | null = null;
        let earliestDateMs = Infinity;
        const nowMsRef = new Date().getTime();

        /** Candidat pour earliest : on garde le min des dates futures rencontrées. */
        const considerCandidate = (iso: string, ms: number) => {
          if (ms <= nowMsRef) return; // créneau passé ignoré
          if (ms < earliestDateMs) {
            earliestDateMs = ms;
            earliestDateStr = iso;
          }
        };

        // Repas en cours de mise à jour (pmId courant).
        // Cas particulier : si fullPlanningSlot est faux (ex. carte Possible sans créneau choisi),
        // on accepte un fallback « maintenant » comme avant pour maintenir l’ouverture immédiate.
        if (pmId) {
          const targetDate = dayOfWeek ? computePlannedCounterDate(dayOfWeek, mealTime) : null;
          if (fullPlanningSlot && targetDate) {
            const targetMs = new Date(targetDate).getTime();
            considerCandidate(targetDate, targetMs);
          } else {
            const candidateDate = targetDate ?? fallbackDate ?? new Date().toISOString();
            earliestDateStr = candidateDate;
            earliestDateMs = new Date(candidateDate).getTime();
          }
        }

        let hasAnyMatchingMeal = pmId !== null;

        // Parcourir les autres repas **entièrement planifiés** (jour + créneau).
        // Seuls les créneaux FUTURS sont retenus : le compteur reflète la prochaine ouverture.
        for (const pm of allPossibleMeals) {
          if (pm.id === pmId) continue;
          if (!pm.day_of_week || !String(pm.meal_time ?? "").trim()) continue;
          const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
          if (!pmIngs?.trim()) continue;

          if (!pmIngs.toLowerCase().includes(fi.name.toLowerCase())) continue;

          const pmG = parseIngredientGroups(pmIngs);
          const hasMatch = pmG.some((g) =>
            g.some((altBundle) =>
              altBundle.some(
                (it) =>
                  !it.optional &&
                  expandOrGroupIngredientNames(it).some((t) => strictNameMatch(fi.name, t)),
              ),
            ),
          );
          if (!hasMatch) continue;

          const siblingTarget = computePlannedCounterDate(pm.day_of_week, pm.meal_time);
          const pmMs = new Date(siblingTarget).getTime();
          // Filtre fondamental : sibling au créneau passé → on l’ignore complètement.
          // Il représente un repas en retard et ne doit pas dicter la date d’ouverture future.
          if (pmMs <= nowMsRef) continue;

          hasAnyMatchingMeal = true;
          considerCandidate(siblingTarget, pmMs);
        }

        // Mettre à jour seulement si on a trouvé une date valide
        if (hasAnyMatchingMeal && earliestDateStr) {
          const nowMsCheck = new Date().getTime();
          const isSettingFutureDate = new Date(earliestDateStr).getTime() > nowMsCheck;

          const currentCounterMs = fi.counter_start_date ? new Date(fi.counter_start_date).getTime() : NaN;
          const isAlreadyOpened =
            Number.isFinite(currentCounterMs) && currentCounterMs <= nowMsCheck;

          // Un Possible NON planifié consomme déjà ce lot → ouverture réelle maintenant, pas de Prog.
          const lotConsumedNowBySibling = hasUnplannedPossibleConsumingFood(
            fi,
            allPossibleMeals,
            pmId,
          );

          // Toujours basculer en Prog. dès qu'un créneau futur complet existe,
          // y compris si la déduction a posé « maintenant » bien avant la planification
          // (plus de fenêtre artificielle de 60 s).
          if (isSettingFutureDate && isAlreadyOpened && lotConsumedNowBySibling) continue;
          if (fullPlanningSlot && isSettingFutureDate && lotConsumedNowBySibling && isAlreadyOpened) {
            continue;
          }

          // Protéger les compteurs manuels seulement hors planification complète (jour + créneau).
          if (!fullPlanningSlot && !isSettingFutureDate && fi.counter_start_date) {
            const fiStart = new Date(fi.counter_start_date).getTime();
            const nowMs = new Date().getTime();
            const isStartedBeforeNow = fiStart <= nowMs;
            const isManualOrOld = isStartedBeforeNow && !allPossibleMeals.some(pm => pm.created_at && Math.abs(fiStart - new Date(pm.created_at).getTime()) < 60000);
            if (isManualOrOld && (!pmId || (createdAt && Math.abs(fiStart - new Date(createdAt).getTime()) >= 60000))) {
              continue; // Compteur manuel → ne pas écraser
            }
          }

          pendingUpdates.set(fi.id, earliestDateStr);
        } else if (!hasAnyMatchingMeal && Number.isFinite(currentCounterMs) && currentCounterMs > nowMsRef) {
          // Dernière carte future supprimée : retirer le mode « Prog. ».
          // Si une date passée de repli existe (snapshot au retour au choix), la conserver.
          const fallbackMs = fallbackDate ? new Date(fallbackDate).getTime() : NaN;
          if (Number.isFinite(fallbackMs) && fallbackMs <= nowMsRef) {
            pendingUpdates.set(fi.id, fallbackDate!);
          } else {
            pendingUpdates.set(fi.id, null);
          }
        }
      }
          }
        }
      }
    }

    if (pendingUpdates.size === 0) return;

    // 1. Patch optimiste immédiat : l'UI reflète le compteur programmé sans attendre le réseau.
    await qc.cancelQueries({ queryKey: ["food_items"] });
    qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map((fi) => {
        const newDate = pendingUpdates.get(fi.id);
        return newDate !== undefined ? { ...fi, counter_start_date: newDate } : fi;
      });
    });

    // 2. Suspendre le realtime : un événement Supabase sur réplique en retard ne doit pas
    //    ré-écraser notre cache (bug « 0j » au lieu de « Prog. » après planification).
    suppressStockRealtimeBriefly();

    // 3. Écriture batch en base avec récupération de la ligne authoritative.
    const updateResults = await safeMutate("Mise à jour compteur", () =>
      Promise.all(
        Array.from(pendingUpdates.entries()).map(([id, dateIso]) =>
          supabase
            .from("food_items")
            .update({ counter_start_date: dateIso } as any)
            .eq("id", id)
            .select("*")
            .single(),
        ),
      ),
    );

    // 4. Patcher le cache avec les lignes authoritatives renvoyées par le primaire.
    //    NE PAS invalider + refetch le stock ensuite : le refetch irait sur une réplique en retard
    //    et écraserait notre mise à jour par l'ancienne valeur « maintenant ».
    if (Array.isArray(updateResults)) {
      const authoritativeById = new Map<string, FoodItem>();
      for (const res of updateResults) {
        if (!res || (res as any).error) continue;
        const row = (res as { data?: FoodItem | null }).data;
        if (row?.id) authoritativeById.set(row.id, row as FoodItem);
      }
      if (authoritativeById.size > 0) {
        await qc.cancelQueries({ queryKey: ["food_items"] });
        qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((fi) => authoritativeById.get(fi.id) ?? fi);
        });
      }
    }
  };

  /**
   * Rattrape les compteurs « prog. » manqués : pour chaque repas planifié, resynchronise les
   * counter_start_date des aliments. Appelé au chargement ET à chaque changement de planning.
   * @param stockBaselines quantités/grammes d'origine par id (pour nettoyer les unitaires intacts)
   */
  const reconcileMissedProgCounters = async (
    allPossibleMeals: PossibleMeal[],
    stockBaselines?: Record<string, { quantity?: number | null; totalGrams?: number } | null>,
  ) => {
    for (const pm of allPossibleMeals) {
      if (!pm.day_of_week?.trim() || !String(pm.meal_time ?? "").trim()) continue;
      const ing = pm.ingredients_override ?? pm.meals?.ingredients;
      if (!ing?.trim()) continue;
      await updateFoodItemCountersForPlanning(
        pm.id,
        ing,
        pm.day_of_week,
        pm.meal_time,
        pm.counter_start_date ?? null,
        pm.created_at,
        allPossibleMeals,
      );
    }

    // Repas déjà dans Possible (ou créneau passé) : poser le compteur manquant sur les aliments entamés.
    const pendingOpens = new Map<string, string>();
    const now = new Date();
    const nowMs = now.getTime();
    const liveItemsForOpen = getLiveFoodItems();
    for (const fi of liveItemsForOpen) {
      if (!shouldStartCounter(fi)) continue;

      // --- Force Prog. : lot entamé / unitaire prélevé + créneau futur, même si compteur = « maintenant »
      const futureProg = findEarliestFuturePlannedSlotForFood(fi, allPossibleMeals, now);
      if (futureProg && !hasUnplannedPossibleConsumingFood(fi, allPossibleMeals)) {
        const isOpenedGrams = !isCountOnlyFoodItem(fi) && !isFoodItemFullySealed(fi);
        const baselineQty = stockBaselines?.[fi.id]?.quantity;
        const isOpenedCount =
          isCountOnlyFoodItem(fi) &&
          ((baselineQty != null && baselineQty > 0 && (fi.quantity ?? 1) < baselineQty) ||
            Boolean(fi.counter_start_date?.trim()));
        if (isOpenedGrams || isOpenedCount) {
          const stored = fi.counter_start_date?.trim();
          const storedMs = stored ? new Date(stored).getTime() : NaN;
          // Absent, passé, ou pas encore aligné sur le prochain créneau → Prog.
          if (!stored || Number.isNaN(storedMs) || storedMs <= nowMs || stored !== futureProg) {
            pendingOpens.set(fi.id, futureProg);
            continue;
          }
        }
      }

      if (fi.counter_start_date?.trim()) continue;

      // --- Force-start : lot physiquement ouvert sans compteur (grammes partiels OU unitaire réduit)
      // indépendamment d'un Possible — filet de sécurité si un chemin de déduction a oublié de poser.
      {
        const baselineQty = stockBaselines?.[fi.id]?.quantity;
        const isOpenedGrams = !isCountOnlyFoodItem(fi) && !isFoodItemFullySealed(fi);
        const isOpenedCount =
          isCountOnlyFoodItem(fi) &&
          baselineQty != null &&
          baselineQty > 0 &&
          (fi.quantity ?? 1) < baselineQty;
        if (isOpenedGrams || isOpenedCount) {
          if (futureProg && !hasUnplannedPossibleConsumingFood(fi, allPossibleMeals)) {
            pendingOpens.set(fi.id, futureProg);
          } else {
            const inferred =
              findLatestOpenDateFromPossibleMeals(fi, allPossibleMeals, now) ??
              findEarliestOpenDateFromPossibleMeals(fi, allPossibleMeals, now);
            pendingOpens.set(fi.id, inferred ?? now.toISOString());
          }
          continue;
        }
      }

      if (isCountOnlyFoodItem(fi)) {
        // Unitaire sans baseline connue : rien à forcer ici (évite les homonymes intacts).
        continue;
      }

      // Lots au grammage réellement entamés déjà traités ci-dessus.
      continue;
    }

    // Retire les compteurs obsolètes :
    // - lots au grammage entièrement scellés
    // - unitaires dont la quantité est encore égale à la baseline (paquet intact / homonyme)
    // - unitaires intacts quand un homonyme a déjà une qty plus basse (déduction sur l'autre lot)
    const staleCounterClears = new Map<string, null>();
    const liveItems = getLiveFoodItems();
    for (const fi of liveItems) {
      if (!fi.counter_start_date?.trim()) continue;
      if (!shouldStartCounter(fi)) continue;
      if (isCountOnlyFoodItem(fi)) {
        const baselineQty = stockBaselines?.[fi.id]?.quantity;
        const fiQty = fi.quantity ?? 1;
        if (baselineQty != null && baselineQty > 0 && fiQty >= baselineQty) {
          staleCounterClears.set(fi.id, null);
        } else if (baselineQty == null) {
          const hasReducedSibling = liveItems.some(
            (o) =>
              o.id !== fi.id &&
              isCountOnlyFoodItem(o) &&
              strictNameMatch(o.name, fi.name) &&
              (o.quantity ?? 1) < fiQty,
          );
          if (hasReducedSibling) staleCounterClears.set(fi.id, null);
        }
        continue;
      }
      if (!isFoodItemFullySealed(fi)) continue;
      // Multi-paquets scellés : toujours nettoyer un compteur fantôme (passé ou prog.).
      staleCounterClears.set(fi.id, null);
    }

    // Ne pas effacer un id qu'on vient de poser en Prog.
    for (const id of pendingOpens.keys()) staleCounterClears.delete(id);

    if (pendingOpens.size === 0 && staleCounterClears.size === 0) return;

    await qc.cancelQueries({ queryKey: ["food_items"] });
    qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map((fi) => {
        const openDate = pendingOpens.get(fi.id);
        if (openDate) return { ...fi, counter_start_date: openDate };
        if (staleCounterClears.has(fi.id)) return { ...fi, counter_start_date: null };
        return fi;
      });
    });
    suppressStockRealtimeBriefly();
    await safeMutate("Synchronisation compteurs stock", () =>
      Promise.all([
        ...Array.from(pendingOpens.entries()).map(([id, dateIso]) =>
          supabase.from("food_items").update({ counter_start_date: dateIso } as any).eq("id", id),
        ),
        ...Array.from(staleCounterClears.keys()).map((id) =>
          supabase.from("food_items").update({ counter_start_date: null } as any).eq("id", id),
        ),
      ]),
    );
  };

  return {
    deductIngredientsFromStock,
    restoreIngredientsToStock,
    adjustStockForIngredientChange,
    deductNameMatchStock,
    updateFoodItemCountersForPlanning,
    reconcileMissedProgCounters,
  };
}

