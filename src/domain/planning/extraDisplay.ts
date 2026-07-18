/**
 * Helpers purs d'affichage / résolution des extras et desserts du planning.
 * Sans effet de bord : les callers persistent via setPreference / mutations stock.
 */
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { normalizeKey, parseIngredientGroups, formatNumeric, strictNameMatch } from "@/lib/ingredientUtils";
import {
  buildFoodDessertExtraId,
  findSnapshotFoodItemForDessertExtra,
  parseFoodDessertExtraId,
  resolveFoodDessertPortionMacros,
} from "@/lib/foodDessertUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";
import { getAssignedExtraIdsForDay, parsePlanningCustomExtraId } from "@/lib/planningExtraMacros";

/** Alias stable : décode un extra personnalisé (`custom::…`). */
export const parseCustomExtraId = parsePlanningCustomExtraId;

/** Construit un id d'extra personnalisé à partir d'un dessert "au choix". */
export function buildDessertExtraId(name: string, cal: number, prot: number): string {
  return `custom::${name}::${Math.round(cal)}::${Math.round(prot)}`;
}

/** Résout les macros affichées d'un aliment extra dans le popover planning. */
export function resolvePlanningExtraFoodMacros(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[],
  options?: { perUnit?: boolean; asDessertFood?: boolean },
): { cal: number; pro: number; fiber: number } {
  if (options?.asDessertFood) {
    return resolveFoodDessertPortionMacros(fi, macroLibrary);
  }
  return getExtraPortionMacros(fi, options?.perUnit ? { perUnit: true } : undefined);
}

/** Retourne les extras sélectionnés du jour qui ne sont pas encore placés dans un créneau. */
export function getUnassignedExtraSelectionIds(
  extraSelections: Record<string, string[]>,
  extraSlotAssignments: Record<string, string[]>,
  iso: string,
  key: string,
): string[] {
  const ids = extraSelections[iso] || extraSelections[key] || [];
  const assignedSet = new Set(getAssignedExtraIdsForDay(extraSlotAssignments, iso, key));
  return ids.filter((id) => !assignedSet.has(id));
}

/** Normalise un nom d'extra pour comparer recettes et aliments dessert. */
export function normalizeExtraDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Associe un id de sélection au dessert catalogue correspondant
 * (id exact, aliment `food-dessert::…` ou nom de recette `custom::…`).
 */
export function resolveDessertCatalogId(
  selectionId: string,
  catalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): string | null {
  if (dessertById.has(selectionId)) return selectionId;
  const custom = parseCustomExtraId(selectionId);
  if (custom) {
    const target = normalizeExtraDisplayName(custom.name);
    const match = catalog.find((entry) => normalizeExtraDisplayName(entry.name) === target);
    return match?.id ?? null;
  }
  const foodItemId = parseFoodDessertExtraId(selectionId);
  if (foodItemId) {
    const match = catalog.find((entry) => parseFoodDessertExtraId(entry.id) === foodItemId);
    if (match) return match.id;
    const staleName =
      dessertById.get(selectionId)?.name
      ?? dessertById.get(buildFoodDessertExtraId(foodItemId))?.name
      ?? findSnapshotFoodItemForDessertExtra(dessertExtraStockSnapshots, selectionId)?.name
      ?? findSnapshotFoodItemForDessertExtra(dessertExtraStockSnapshots, buildFoodDessertExtraId(foodItemId))?.name;
    if (staleName) {
      const target = normalizeKey(staleName);
      const byName = catalog.find((entry) => normalizeKey(entry.name) === target);
      return byName?.id ?? null;
    }
    return null;
  }
  return null;
}

/** Compte les occurrences d'un dessert dans une liste de sélections (ids alias inclus). */
export function countDessertExtraInSelections(
  selectionIds: string[],
  dessert: { id: string; name: string },
  catalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
): number {
  return selectionIds.reduce((acc, selectionId) => {
    if (selectionId === dessert.id) return acc + 1;
    const canonical = resolveDessertCatalogId(selectionId, catalog, dessertById);
    return canonical === dessert.id ? acc + 1 : acc;
  }, 0);
}

/** Indique si un dessert du catalogue est présent dans les sélections du jour. */
export function isDessertExtraInSelections(
  selectionIds: string[],
  dessert: { id: string; name: string },
  catalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
): boolean {
  return countDessertExtraInSelections(selectionIds, dessert, catalog, dessertById) > 0;
}

/** Retourne le premier id réellement stocké qui correspond à un dessert catalogue. */
export function findStoredSelectionIdForDessert(
  selectionIds: string[],
  dessert: { id: string; name: string },
  catalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
): string | null {
  for (let i = selectionIds.length - 1; i >= 0; i--) {
    const selectionId = selectionIds[i];
    if (selectionId === dessert.id) return selectionId;
    const canonical = resolveDessertCatalogId(selectionId, catalog, dessertById);
    if (canonical === dessert.id) return selectionId;
  }
  return null;
}

/**
 * Résout custom + fiche aliment pour afficher un extra assigné à un créneau
 * (stock, dessert aliment `food-dessert::…` ou recette dessert `custom::…`).
 */
export function resolveAssignedExtraForDisplay(
  extraId: string,
  foodItems: FoodItem[],
  dessertById: Map<string, { mealPayload: Meal; name?: string }>,
  catalogDessertId?: string,
): { custom: { name: string; cal: number; prot: number } | null; fi: FoodItem | undefined } | null {
  const custom = parseCustomExtraId(extraId);
  if (custom) return { custom, fi: undefined };

  const foodDessertItemId = parseFoodDessertExtraId(extraId);
  const fi =
    foodItems.find((f) => f.id === extraId)
    ?? (foodDessertItemId ? foodItems.find((f) => f.id === foodDessertItemId) : undefined);
  const resolvedCatalogId = catalogDessertId ?? extraId;

  if (fi || dessertById.has(extraId) || dessertById.has(resolvedCatalogId)) {
    return { custom: null, fi };
  }
  return null;
}

/** Prépare l'affichage d'un extra non assigné en semaine pro (catalogue complet, y compris stock épuisé). */
export function resolveNextWeekUnassignedExtraRow(
  extraId: string,
  foodItems: FoodItem[],
  dessertById: Map<string, { name: string; mealPayload?: Meal }>,
  allDessertCatalog: Array<{ id: string; name: string }>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): { labelId: string; custom: { name: string; cal: number; prot: number } | null; fi: FoodItem | undefined } | null {
  const catalogId = resolveDessertCatalogId(extraId, allDessertCatalog, dessertById, dessertExtraStockSnapshots);
  const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, dessertById, catalogId ?? undefined);
  if (resolved) {
    return {
      labelId: catalogId ?? extraId,
      custom: resolved.custom,
      fi: resolved.fi,
    };
  }
  if (catalogId) {
    return { labelId: catalogId, custom: null, fi: undefined };
  }
  const custom = parseCustomExtraId(extraId);
  if (custom) return { labelId: extraId, custom, fi: undefined };
  const fi = foodItems.find((f) => f.id === extraId && f.storage_type === "extras");
  if (fi) return { labelId: extraId, custom: null, fi };
  return null;
}

/** Indique si un id d'extra peut être affiché dans le popover planning (stock, dessert ou custom). */
export function isDisplayableExtraSelectionId(
  selectionId: string,
  foodItems: FoodItem[],
  dessertCatalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): boolean {
  if (foodItems.some((fi) => fi.id === selectionId && fi.storage_type === "extras")) return true;
  if (parseCustomExtraId(selectionId)) return true;
  return resolveDessertCatalogId(selectionId, dessertCatalog, dessertById, dessertExtraStockSnapshots) != null;
}

/** Compte les extras réellement affichables dans les sélections d'un jour. */
export function countDisplayableExtraSelections(
  selectionIds: string[],
  foodItems: FoodItem[],
  dessertCatalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): number {
  return selectionIds.reduce(
    (count, selectionId) =>
      isDisplayableExtraSelectionId(selectionId, foodItems, dessertCatalog, dessertById, dessertExtraStockSnapshots) ? count + 1 : count,
    0,
  );
}

/** Indique si un extra est déjà posé dans un créneau (ids alias / noms custom inclus). */
export function isExtraIdAssignedForDay(
  extraId: string,
  assignedIds: string[],
  allDessertCatalog: Array<{ id: string; name: string }>,
  dessertById: Map<string, { name: string }>,
): boolean {
  if (assignedIds.includes(extraId)) return true;
  const canonical = resolveDessertCatalogId(extraId, allDessertCatalog, dessertById);
  const custom = parseCustomExtraId(extraId);
  for (const assignedId of assignedIds) {
    if (assignedId === extraId) return true;
    if (canonical && resolveDessertCatalogId(assignedId, allDessertCatalog, dessertById) === canonical) {
      return true;
    }
    if (custom) {
      const assignedCustom = parseCustomExtraId(assignedId);
      if (
        assignedCustom &&
        normalizeExtraDisplayName(assignedCustom.name) === normalizeExtraDisplayName(custom.name)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Lit les sélections extras d'un jour depuis les préférences, avec repli sur le snapshot post-reset. */
export function pickDayExtraSelections(
  selections: Record<string, string[]>,
  iso: string,
  key: string,
  fallback: string[],
): string[] {
  if (Object.prototype.hasOwnProperty.call(selections, iso)) {
    return selections[iso] ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(selections, key)) {
    return selections[key] ?? [];
  }
  return fallback;
}

/** Formate l'étiquette d'un extra placé en incluant ses grammes et sa quantité s'ils existent. */
export function formatPlacedExtraLabel(extraName: string, grams?: string | null, quantity?: number | null): string {
  const name = (extraName || "").trim();
  const rawGrams = (grams || "").trim();
  const hasUnit = /[a-zA-Z]/.test(rawGrams);
  const g = rawGrams ? (hasUnit ? rawGrams : `${rawGrams}g`) : "";
  const q = quantity != null && quantity > 0 ? `#${quantity}` : "";
  const prefix = [g, q].filter(Boolean).join(" ");
  if (!name) return prefix;
  if (!prefix) return name;
  return `${prefix} ${name}`;
}

/** Multiplie un grammage affichable si c'est une valeur numérique simple, en conservant l'unité éventuelle. */
export function multiplyDisplayGrams(grams: string | null | undefined, count: number): string | null {
  const raw = (grams || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return raw;
  const value = parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return raw;
  const unit = match[2]?.trim() || "";
  const total = formatNumeric(value * Math.max(1, count));
  return unit ? `${total}${unit}` : total;
}

/**
 * Déduit grammes / quantité affichables depuis une recette dessert (ingrédient unique ou fiche stock liée).
 * Sert les bulles d'extras déplacés créés via `custom::…` (desserts au choix), qui n'ont pas de `FoodItem` direct.
 */
export function extractExtraDisplayQuantity(
  meal: Meal | null | undefined,
  foodItems: FoodItem[],
): { grams: string | null; quantity: number | null } {
  if (!meal) return { grams: null, quantity: null };
  const groups = parseIngredientGroups(meal.ingredients || "");
  for (const group of groups) {
    for (const bundle of group) {
      const ing = bundle.find((i) => !i.optional);
      if (!ing) continue;
      if (ing.qty > 0) {
        return { grams: formatNumeric(ing.qty), quantity: null };
      }
      if (ing.count > 0) {
        return { grams: null, quantity: ing.count };
      }
      const stockFi = foodItems.find(
        (f) =>
          strictNameMatch(f.name, ing.name) &&
          f.storage_type !== "extras" &&
          f.storage_type !== "test",
      );
      if (stockFi) {
        return { grams: stockFi.grams, quantity: stockFi.quantity };
      }
    }
  }
  const rawMealGrams = (meal.grams || "").trim();
  if (rawMealGrams) return { grams: rawMealGrams, quantity: null };
  return { grams: null, quantity: null };
}

/**
 * Construit le libellé complet d'une bulle d'extra déplacée (stock, dessert custom ou les deux).
 */
export function getPlacedExtraLabel(
  extraId: string,
  custom: { name: string } | null,
  fi: FoodItem | null | undefined,
  foodItems: FoodItem[],
  dessertById: Map<string, { mealPayload: Meal }>,
): string {
  const name = custom?.name || fi?.name || "";
  if (fi) {
    return formatPlacedExtraLabel(name, fi.grams, fi.quantity);
  }
  const dessert = dessertById.get(extraId);
  if (dessert) {
    const { grams, quantity } = extractExtraDisplayQuantity(dessert.mealPayload, foodItems);
    if (grams || quantity) {
      return formatPlacedExtraLabel(name, grams, quantity);
    }
  }
  // Secours : fiche stock homonyme (recette dessert sans grammage explicite dans les ingrédients).
  const stockByName = foodItems.find(
    (f) =>
      strictNameMatch(f.name, name) &&
      f.storage_type !== "extras" &&
      f.storage_type !== "test",
  );
  if (stockByName) {
    return formatPlacedExtraLabel(name, stockByName.grams, stockByName.quantity);
  }
  return formatPlacedExtraLabel(name, null, null);
}

/** Regroupe une liste d'extras assignés en conservant l'ordre et le nombre d'occurrences. */
export function groupAssignedExtraIds(ids: string[]): Array<{ id: string; count: number }> {
  const groups: Array<{ id: string; count: number }> = [];
  for (const id of ids) {
    const existing = groups.find((group) => group.id === id);
    if (existing) existing.count += 1;
    else groups.push({ id, count: 1 });
  }
  return groups;
}

/** Construit le texte d'une bulle d'extra assigné en affichant la quantité totale déplacée. */
export function getAssignedExtraLabel(
  extraId: string,
  count: number,
  custom: { name: string } | null,
  fi: FoodItem | null | undefined,
  foodItems: FoodItem[],
  dessertById: Map<string, { mealPayload: Meal }>,
): string {
  const name = custom?.name || fi?.name || dessertById.get(extraId)?.mealPayload?.name || "";
  if (fi) {
    const totalQuantity = fi.quantity != null ? Math.max(1, fi.quantity) * Math.max(1, count) : null;
    return formatPlacedExtraLabel(name, multiplyDisplayGrams(fi.grams, count), totalQuantity);
  }
  const dessert = dessertById.get(extraId);
  if (dessert) {
    const { grams, quantity } = extractExtraDisplayQuantity(dessert.mealPayload, foodItems);
    const totalQuantity = quantity != null ? Math.max(1, quantity) * Math.max(1, count) : null;
    return formatPlacedExtraLabel(name, multiplyDisplayGrams(grams, count), totalQuantity);
  }
  const stockByName = foodItems.find(
    (f) =>
      strictNameMatch(f.name, name) &&
      f.storage_type !== "extras" &&
      f.storage_type !== "test",
  );
  if (stockByName) {
    const totalQuantity = stockByName.quantity != null ? Math.max(1, stockByName.quantity) * Math.max(1, count) : null;
    return formatPlacedExtraLabel(name, multiplyDisplayGrams(stockByName.grams, count), totalQuantity);
  }
  return formatPlacedExtraLabel(name, null, null);
}
