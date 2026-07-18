import type { FoodItem } from "@/hooks/useFoodItems";
import {
  normalizeKey, parseQty, parseIngredientGroups,
  computeCounterDays, getAdaptedCounterDays, getTargetDate,
} from "@/lib/ingredientUtils";
import { parseISO } from "date-fns";

import type { FoodItemIndex } from "./foodItemIndex";
import { lookupFoodItems } from "./foodItemIndex";
import { buildStockMap, pickBestAlternative } from "./stockMap";
import {
  hasActiveFoodItemCounter,
  isFoodItemCounterEligible,
} from "./foodItemState";
import { counterableIngredientKeysFromRecipe } from "./mealAnalysis";

function recipeHasMatchingFoodItemsInStock(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
): boolean {
  if (!ingredients?.trim()) return false;
  const groups = parseIngredientGroups(ingredients);
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const bundle = group[0];
    if (!bundle) continue;
    for (const item of bundle) {
      if (item.optional || !item.name) continue;
      if (lookupFoodItems(item.name, foodItems, index).length > 0) return true;
    }
  }
  return false;
}
type PossibleMealForBadge = {
  id: string;
  day_of_week: string | null;
  meal_time: string | null;
  ingredients_override?: string | null;
  counter_start_date?: string | null;
  created_at?: string | null;
  meals?: { ingredients?: string | null } | null;
};
export function resolveCounterStartForPossibleBadge(
  pm: PossibleMealForBadge,
  siblingPossibleMeals: PossibleMealForBadge[],
  earliestFromAnalysis: string | null | undefined,
  cardCounterFallback: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
  earliestActiveFromAnalysis?: string | null | undefined,
): string | undefined {
  const now = fixedNow ?? new Date();
  const nowMs = now.getTime();
  const currentIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
  const mine = counterableIngredientKeysFromRecipe(currentIngredients, foodItems, index);
  // Stock entièrement consommé (aliment supprimé) : conserver le compteur figé sur la carte.
  // Si l'ingrédient est encore en stock mais no_counter / surgelé, ne pas renvoyer le fallback.
  if (mine.size === 0) {
    if (recipeHasMatchingFoodItemsInStock(currentIngredients, foodItems, index)) return undefined;
    const cardDate = cardCounterFallback?.trim();
    return cardDate || undefined;
  }

  const activeStockOpen = findEarliestActiveCounterDate(currentIngredients, foodItems, index, now);
  let base = activeStockOpen
    || (earliestActiveFromAnalysis && earliestActiveFromAnalysis.trim())
    || undefined;

  // Si on n'a pas de base côté stock/carte, mais qu'un sibling non planifié partage un ingrédient
  // de la recette, il est en consommation immédiate : on hérite de SA date pour refléter que l'ingrédient
  // est bel et bien entamé (via le sibling) même si le food_item reste « vierge » en stock.
  if (!base && mine.size > 0) {
    for (const o of siblingPossibleMeals) {
      if (o.id === pm.id) continue;
      if (o.day_of_week && o.meal_time?.trim()) continue;
      const oIng = o.ingredients_override ?? o.meals?.ingredients;
      if (!oIng?.trim()) continue;
      const theirs = counterableIngredientKeysFromRecipe(oIng, foodItems, index);
      let shares = false;
      for (const k of mine) { if (theirs.has(k)) { shares = true; break; } }
      if (!shares) continue;
      const inherited = (o.counter_start_date && o.counter_start_date.trim()) || (o.created_at && o.created_at.trim());
      if (inherited) { base = inherited; break; }
    }
  }

  // Ouvertures réellement actives (≤ maintenant) côté carte ou analyse, puis date d'analyse réelle
  // (plus ancienne date de compteur des ingrédients) même future. Ces sources priment sur l'inférence
  // depuis une carte planifiée voisine (ci-dessous).
  if (!base) {
    const cardDate = cardCounterFallback?.trim();
    const analysisDate = earliestFromAnalysis?.trim();
    const pickIfActive = (iso?: string) => {
      if (!iso) return undefined;
      const ms = parseISO(iso).getTime();
      return !Number.isNaN(ms) && ms <= nowMs ? iso : undefined;
    };
    base = pickIfActive(cardDate) || pickIfActive(analysisDate) || (analysisDate || undefined);
  }

  // Toujours pas de base : si CETTE carte est planifiée et qu'une AUTRE carte planifiée PLUS TÔT (créneau
  // futur antérieur) partage le même lot comptable, c'est elle qui ouvre réellement le lot. On hérite de
  // SON créneau comme date d'ouverture. Robuste : indépendant du counter_start_date du food_item (qui peut
  // être null si le lot a été refermé puis ré-ouvert). Ex. « Riz + Tenders » lundi soir ouvre le lot →
  // « Patatoes + Tenders » mercredi soir affiche alors 2j.
  if (!base && mine.size > 0 && pm.day_of_week && pm.meal_time?.trim()) {
    const mySlotMs = getTargetDate(pm.day_of_week, now, null, pm.meal_time).getTime();
    let earliestSiblingMs = Infinity;
    let earliestSiblingIso: string | undefined;
    for (const o of siblingPossibleMeals) {
      if (o.id === pm.id) continue;
      if (!o.day_of_week || !o.meal_time?.trim()) continue;
      const oIng = o.ingredients_override ?? o.meals?.ingredients;
      if (!oIng?.trim()) continue;
      const theirs = counterableIngredientKeysFromRecipe(oIng, foodItems, index);
      let shares = false;
      for (const k of mine) { if (theirs.has(k)) { shares = true; break; } }
      if (!shares) continue;
      const oSlot = getTargetDate(o.day_of_week, now, null, o.meal_time);
      const oMs = oSlot.getTime();
      // Uniquement les créneaux FUTURS antérieurs au mien : la 1re carte à venir ouvre le lot.
      // Les cartes passées concernent d'anciens lots déjà consommés et ne doivent pas servir d'ouverture.
      if (oMs > nowMs && oMs < mySlotMs && oMs < earliestSiblingMs) {
        earliestSiblingMs = oMs;
        earliestSiblingIso = oSlot.toISOString();
      }
    }
    if (earliestSiblingIso) base = earliestSiblingIso;
  }

  // Dernier recours : compteur propre figé sur la carte (souvent son propre créneau).
  if (!base) {
    const cardDate = cardCounterFallback?.trim();
    if (cardDate) base = cardDate;
  }

  if (!base) return undefined;

  if (!pm.day_of_week || !pm.meal_time?.trim()) return base;

  const plannedSlot = getTargetDate(pm.day_of_week, now, null, pm.meal_time);
  if (plannedSlot.getTime() <= now.getTime()) return base;

  const start = parseISO(base);
  if (Number.isNaN(start.getTime())) return base;

  // Lot déjà entamé en stock : ne jamais basculer en mode « prog. » au choix du créneau (ex. Midi).
  if (activeStockOpen) return activeStockOpen;

  // Identifier précisément le(s) ingrédient(s) responsable(s) de la date `base`.
  // Seuls les siblings qui partagent CE(S) ingrédient(s) peuvent « bloquer » la carte en mode compteur.
  const criticalKeys = findCriticalCounterKeys(currentIngredients, foodItems, base, index);

  // Si on n'a identifié aucune clé critique (ex. base venant d'un cardCounterFallback orphelin,
  // ou hérité d'un sibling non planifié), on retombe sur toutes les clés compteurs de la recette.
  const checkKeys = criticalKeys.size > 0 ? criticalKeys : mine;

  let hasEarlierConsumingSibling = false;
  for (const o of siblingPossibleMeals) {
    if (o.id === pm.id) continue;
    const oIng = o.ingredients_override ?? o.meals?.ingredients;
    if (!oIng?.trim()) continue;
    const theirs = counterableIngredientKeysFromRecipe(oIng, foodItems, index);
    let sharesCriticalIngredient = false;
    for (const k of checkKeys) {
      if (theirs.has(k)) { sharesCriticalIngredient = true; break; }
    }
    if (!sharesCriticalIngredient) continue;

    // Sibling non planifié qui partage l'ingrédient critique = consommation immédiate
    // (ex. carte « Mini rosti + Tenders » sans créneau → tenders entamés maintenant).
    // Il doit bloquer l'alignement vers le créneau futur de la carte courante.
    if (!o.day_of_week || !o.meal_time?.trim()) {
      hasEarlierConsumingSibling = true;
      break;
    }
    const otherSlot = getTargetDate(o.day_of_week, now, null, o.meal_time);
    // Un sibling passé ne doit plus bloquer l'affichage « prog. » de cette carte.
    if (otherSlot.getTime() > now.getTime() && otherSlot.getTime() < plannedSlot.getTime()) {
      hasEarlierConsumingSibling = true;
      break;
    }
  }

  if (hasEarlierConsumingSibling) return base;

  if (start.getTime() >= plannedSlot.getTime()) return base;

  // Ouverture déjà réelle (stock ou carte) : ne pas remplacer par le créneau planifié.
  if (start.getTime() <= nowMs) return base;

  return plannedSlot.toISOString();
}
export function findEarliestActiveCounterDate(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
): string | undefined {
  let earliest: string | undefined;
  let earliestMs = Infinity;
  if (!ingredients?.trim()) return undefined;
  const groups = parseIngredientGroups(ingredients);
  const stockMap = buildStockMap(foodItems);
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const alt = pickBestAlternative(group, stockMap) ?? group[0];
    if (!alt) continue;
    for (const item of alt) {
      if (item.optional || !item.name) continue;
      for (const fi of lookupFoodItems(item.name, foodItems, index)) {
        if (!hasActiveFoodItemCounter(fi, fixedNow)) continue;
        const ms = parseISO(fi.counter_start_date!).getTime();
        if (ms < earliestMs) {
          earliestMs = ms;
          earliest = fi.counter_start_date!;
        }
      }
    }
  }
  return earliest;
}
export function findEarliestFutureCounterDate(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
): string | undefined {
  const nowMs = (fixedNow ?? new Date()).getTime();
  let earliest: string | undefined;
  let earliestMs = Infinity;
  if (!ingredients?.trim()) return undefined;
  const groups = parseIngredientGroups(ingredients);
  const stockMap = buildStockMap(foodItems);
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const alt = pickBestAlternative(group, stockMap) ?? group[0];
    if (!alt) continue;
    for (const item of alt) {
      if (item.optional || !item.name) continue;
      for (const fi of lookupFoodItems(item.name, foodItems, index)) {
        if (fi.is_infinite || fi.storage_type === "surgele" || !fi.counter_start_date?.trim()) continue;
        if (fi.no_counter && parseQty(fi.grams) > 0) continue;
        const ms = parseISO(fi.counter_start_date).getTime();
        if (Number.isNaN(ms) || ms <= nowMs) continue; // garder uniquement les compteurs futurs (prog)
        if (ms < earliestMs) {
          earliestMs = ms;
          earliest = fi.counter_start_date;
        }
      }
    }
  }
  return earliest;
}
export function getProgrammedOnlyCounterStart(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
): string | undefined {
  const active = findEarliestActiveCounterDate(ingredients, foodItems, index, fixedNow);
  if (active) return undefined;
  return findEarliestFutureCounterDate(ingredients, foodItems, index, fixedNow);
}
function isFoodItemCounterCandidate(fi: FoodItem): boolean {
  if (fi.is_infinite || fi.storage_type === "surgele" || !fi.counter_start_date?.trim()) return false;
  if (fi.no_counter && parseQty(fi.grams) > 0) return false;
  return !Number.isNaN(parseISO(fi.counter_start_date).getTime());
}
export function getRecipeMaxActiveFoodCounter(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
  dayKey?: string | null,
  mealTime?: string | null,
  createdAt?: string,
): { days: number; startDate: string; foodName: string } | null {
  let best: { days: number; startDate: string; foodName: string } | null = null;
  if (!ingredients?.trim()) return null;
  const groups = parseIngredientGroups(ingredients);
  const stockMap = buildStockMap(foodItems);
  const usePlannedSlot = !!dayKey?.trim();
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const alt = pickBestAlternative(group, stockMap) ?? group[0];
    if (!alt) continue;
    for (const item of alt) {
      if (item.optional || !item.name) continue;
      for (const fi of lookupFoodItems(item.name, foodItems, index)) {
        if (!fi.counter_start_date) continue;
        // Sans planning : uniquement compteurs déjà démarrés. Avec planning : actifs + Prog. futurs.
        if (usePlannedSlot) {
          if (!isFoodItemCounterCandidate(fi)) continue;
        } else if (!hasActiveFoodItemCounter(fi, fixedNow)) {
          continue;
        }
        const days = usePlannedSlot
          ? getAdaptedCounterDays(fi.counter_start_date, dayKey, createdAt, mealTime, fixedNow)
          : computeCounterDays(fi.counter_start_date, fixedNow);
        if (days === null) continue;
        const startMs = parseISO(fi.counter_start_date).getTime();
        const bestMs = best ? parseISO(best.startDate).getTime() : Infinity;
        if (
          !best ||
          days > best.days ||
          (days === best.days && startMs < bestMs)
        ) {
          best = { days, startDate: fi.counter_start_date, foodName: fi.name };
        }
      }
    }
  }
  return best;
}

/**
 * Retourne uniquement le nombre de jours du plus haut compteur Aliments ouvert de la recette.
 * Accepte les mêmes paramètres de planning optionnels que `getRecipeMaxActiveFoodCounter`.
 */
export function getRecipeMaxActiveFoodCounterDays(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  fixedNow?: Date,
  dayKey?: string | null,
  mealTime?: string | null,
  createdAt?: string,
): number | null {
  return getRecipeMaxActiveFoodCounter(
    ingredients, foodItems, index, fixedNow, dayKey, mealTime, createdAt,
  )?.days ?? null;
}
function findCriticalCounterKeys(
  ingredients: string | null | undefined,
  foodItems: FoodItem[],
  base: string,
  index?: FoodItemIndex,
): Set<string> {
  const keys = new Set<string>();
  if (!ingredients?.trim()) return keys;
  const baseMs = parseISO(base).getTime();
  if (Number.isNaN(baseMs)) return keys;
  const groups = parseIngredientGroups(ingredients);
  const stockMap = buildStockMap(foodItems);
  for (const group of groups) {
    if (group.every((b) => b.every((i) => i.optional))) continue;
    const alt = pickBestAlternative(group, stockMap) ?? group[0];
    if (!alt) continue;
    for (const item of alt) {
      if (item.optional || !item.name) continue;
      for (const fi of lookupFoodItems(item.name, foodItems, index)) {
        if (!hasActiveFoodItemCounter(fi) || !fi.counter_start_date) continue;
        const csdMs = parseISO(fi.counter_start_date).getTime();
        if (Number.isNaN(csdMs)) continue;
        // Tolérance d'une minute pour absorber les écarts de sérialisation ISO.
        if (Math.abs(csdMs - baseMs) <= 60_000) {
          keys.add(normalizeKey(item.name));
          break;
        }
      }
    }
  }
  return keys;
}

