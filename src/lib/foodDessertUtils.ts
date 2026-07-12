import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { formatNumeric, normalizeKey, parseIngredientGroups, parseQty } from "@/lib/ingredientUtils";
import {
  getExtraMacroMode,
  getExtraPortionMacros,
  getExtraReferenceGrams,
  parseFoodMacroValue,
} from "@/lib/extraMacroUtils";
import { getMealMultiple, strictNameMatch, type StockInfo } from "@/lib/stockUtils";

/** Clé de préférence : ids des aliments marqués « dessert » (extras planning). */
export const DESSERT_FOOD_PREF_KEY = "dessert_food_item_ids";
/** Clé de préférence : noms normalisés à réactiver en « dessert » après recréation d'une fiche. */
export const DESSERT_FOOD_NAME_KEYS_PREF_KEY = "dessert_food_item_name_keys";

/** Ajoute un nom d'aliment à la mémoire « dessert » (survit à la suppression de la fiche). */
export function addDessertFoodNameKey(nameKeys: string[], foodName: string): string[] {
  const key = normalizeKey(foodName);
  if (!key || nameKeys.includes(key)) return nameKeys;
  return [...nameKeys, key];
}

/** Retire un nom de la mémoire dessert (désactivation explicite du mode). */
export function removeDessertFoodNameKey(nameKeys: string[], foodName: string): string[] {
  const key = normalizeKey(foodName);
  if (!key) return nameKeys;
  return nameKeys.filter((entry) => entry !== key);
}

/** Indique si un aliment nouvellement créé doit hériter du mode dessert. */
export function shouldMarkNewFoodAsDessert(foodName: string, nameKeys: string[]): boolean {
  return foodNameMatchesDessertMemory(foodName, nameKeys);
}

/**
 * Compare un nom d'aliment aux noms mémorisés dessert (exact, préfixe ou premier mot).
 * Permet de réactiver « Vacherin » après recréation sous le nom complet.
 */
export function foodNameMatchesDessertMemory(foodName: string, nameKeys: string[]): boolean {
  const key = normalizeKey(foodName);
  if (!key || nameKeys.length === 0) return false;
  if (nameKeys.includes(key)) return true;
  const firstWord = key.split(/\s+/)[0] ?? "";
  return nameKeys.some((stored) => {
    if (!stored) return false;
    if (stored === key) return true;
    if (key.startsWith(`${stored} `) || stored.startsWith(`${key} `)) return true;
    if (firstWord.length > 3 && stored === firstWord) return true;
    const storedFirstWord = stored.split(/\s+/)[0] ?? "";
    if (firstWord.length > 3 && storedFirstWord === firstWord) return true;
    return strictNameMatch(foodName, stored);
  });
}

/**
 * Aligne les ids dessert avec le stock actuel et réapplique les noms mémorisés
 * (ex. Vacherin recréé avec un nouvel id après suppression).
 */
export function reconcileDessertFoodPreferences(
  foodItems: FoodItem[],
  dessertIds: string[],
  nameKeys: string[],
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): { dessertIds: string[]; nameKeys: string[] } {
  const itemsById = new Map(foodItems.map((fi) => [fi.id, fi]));
  let nextNameKeys = [...nameKeys];

  for (const id of dessertIds) {
    if (itemsById.has(id)) continue;
    const snapshotFood = findSnapshotFoodItemForDessertExtra(
      dessertExtraStockSnapshots,
      buildFoodDessertExtraId(id),
    );
    if (snapshotFood?.name) {
      nextNameKeys = addDessertFoodNameKey(nextNameKeys, snapshotFood.name);
    }
  }

  let nextIds = dessertIds.filter((id) => itemsById.has(id));

  for (const id of nextIds) {
    const fi = itemsById.get(id);
    if (fi?.name) nextNameKeys = addDessertFoodNameKey(nextNameKeys, fi.name);
  }

  for (const fi of foodItems) {
    if (nextIds.includes(fi.id)) continue;
    if (foodNameMatchesDessertMemory(fi.name, nextNameKeys)) {
      nextIds.push(fi.id);
    }
  }

  return { dessertIds: nextIds, nameKeys: nextNameKeys };
}

/**
 * Mémorise les noms dessert des fiches supprimées par déduction de stock
 * pour que la recréation réactive automatiquement le mode dessert.
 */
export function patchDessertPrefsAfterStockDeletes(
  deletedItems: Array<Pick<FoodItem, "id" | "name">>,
  dessertIds: string[],
  nameKeys: string[],
): { dessertIds: string[]; nameKeys: string[]; changed: boolean } {
  const dessertIdSet = new Set(dessertIds);
  let nextNameKeys = [...nameKeys];
  let changed = false;
  for (const fi of deletedItems) {
    if (!fi.id || !dessertIdSet.has(fi.id) || !fi.name) continue;
    const before = nextNameKeys.length;
    nextNameKeys = addDessertFoodNameKey(nextNameKeys, fi.name);
    if (nextNameKeys.length !== before) changed = true;
  }
  return { dessertIds, nameKeys: nextNameKeys, changed };
}

/**
 * Retire du catalogue les doublons de nom qui masqueraient un dessert food-dessert:: encore sélectionné.
 */
export function stripDessertCatalogDuplicatesForSelections<T extends { id: string; name: string }>(
  extras: T[],
  selectedFoodDessertIds: string[],
  snapshotStore: Record<string, Record<string, FoodItem[][]>> = {},
): T[] {
  if (selectedFoodDessertIds.length === 0) return extras;
  const selectedSet = new Set(selectedFoodDessertIds);
  const keptNameKeys = new Set<string>();

  for (const selectedId of selectedFoodDessertIds) {
    const existing = extras.find((entry) => entry.id === selectedId);
    if (existing?.name) {
      keptNameKeys.add(normalizeKey(existing.name));
      continue;
    }
    const snapshotFood = findSnapshotFoodItemForDessertExtra(snapshotStore, selectedId);
    if (snapshotFood?.name) keptNameKeys.add(normalizeKey(snapshotFood.name));
  }

  if (keptNameKeys.size === 0) return extras;

  return extras.filter((extra) => {
    if (selectedSet.has(extra.id)) return true;
    const nameKey = normalizeKey(extra.name);
    if (!nameKey || !keptNameKeys.has(nameKey)) return true;
    return false;
  });
}

/**
 * Déduplique le catalogue desserts par nom normalisé.
 * Garde l'entrée liée à une fiche aliment encore présente en stock, ou encore sélectionnée.
 */
export function deduplicateDessertExtraCatalog<T extends { id: string; name: string }>(
  extras: T[],
  foodItems: FoodItem[],
  ensureExtraIds: string[] = [],
): T[] {
  const requiredIds = new Set(ensureExtraIds);
  const scoreEntry = (extra: T): number => {
    let score = 1;
    const foodId = parseFoodDessertExtraId(extra.id);
    if (foodId) score = foodItems.some((fi) => fi.id === foodId) ? 3 : 2;
    if (requiredIds.has(extra.id)) score += 10;
    return score;
  };

  const byName = new Map<string, T>();
  for (const extra of extras) {
    const nameKey = normalizeKey(extra.name);
    if (!nameKey) continue;
    const existing = byName.get(nameKey);
    if (!existing || scoreEntry(extra) > scoreEntry(existing)) {
      byName.set(nameKey, extra);
    }
  }
  return [...byName.values()];
}

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
 * Trouve une entrée du référentiel Macro ingrédients correspondant au nom d'un aliment.
 */
function findIngredientMacroLibraryItem(
  name: string,
  macroLibrary: IngredientMacroLibraryItem[],
): IngredientMacroLibraryItem | undefined {
  const key = normalizeKey(name);
  if (!key) return undefined;
  return (
    macroLibrary.find((entry) => entry.key === key)
    ?? macroLibrary.find((entry) => normalizeKey(entry.displayName) === key)
  );
}

/**
 * Convertit des macros de référence Macro ingrédients en portion affichable selon la fiche aliment.
 */
function scaleIngredientMacroReferenceForFoodItem(
  fi: FoodItem,
  refCal: number,
  refPro: number,
  refFiber: number,
): { cal: number; pro: number; fiber: number } {
  // Quantité prioritaire : les macros du référentiel sont par unité, pas au 100 g.
  if (fi.quantity != null && fi.quantity > 0) {
    return {
      cal: Math.round(refCal),
      pro: Math.round(refPro),
      fiber: Math.round(refFiber),
    };
  }

  const macroMode = getExtraMacroMode(fi);
  if (macroMode === "per100g") {
    const unitG = getExtraReferenceGrams(fi.grams) ?? parseQty(fi.grams);
    if (unitG > 0) {
      return {
        cal: refCal > 0 ? Math.round((refCal * unitG) / 100) : 0,
        pro: refPro > 0 ? Math.round((refPro * unitG) / 100) : 0,
        fiber: refFiber > 0 ? Math.round((refFiber * unitG) / 100) : 0,
      };
    }
  }

  return {
    cal: Math.round(refCal),
    pro: Math.round(refPro),
    fiber: Math.round(refFiber),
  };
}

/**
 * Résout les macros d'une portion dessert aliment pour le planning.
 * Priorité : fiche aliment, puis référentiel Macro ingrédients (base quantité ou /100 g).
 */
export function resolveFoodDessertPortionMacros(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[] = [],
): { cal: number; pro: number; fiber: number } {
  const fromCard = getExtraPortionMacros(fi, { perUnit: true });
  if (fromCard.cal > 0 || fromCard.pro > 0 || fromCard.fiber > 0) {
    return fromCard;
  }

  const libraryItem = findIngredientMacroLibraryItem(fi.name, macroLibrary);
  if (!libraryItem) return { cal: 0, pro: 0, fiber: 0 };

  return scaleIngredientMacroReferenceForFoodItem(
    fi,
    parseFoodMacroValue(libraryItem.calories),
    parseFoodMacroValue(libraryItem.protein),
    parseFoodMacroValue(libraryItem.fiber ?? ""),
  );
}

/**
 * Retombe sur le garde-manger ou le référentiel Macro pour un dessert recette à ingrédient unique sans macros.
 */
export function resolveSingleIngredientMealDessertMacros(
  meal: Pick<Meal, "ingredients">,
  foodItems: FoodItem[],
  macroLibrary: IngredientMacroLibraryItem[] = [],
): { cal: number; pro: number; fiber: number } {
  const groups = parseIngredientGroups(meal.ingredients || "");
  const first = groups[0]?.[0]?.find((item) => !item.optional);
  const ingredientName = first?.name?.trim();
  if (!ingredientName) return { cal: 0, pro: 0, fiber: 0 };

  const foodItem = foodItems.find((fi) => strictNameMatch(fi.name, ingredientName));
  if (foodItem) {
    return resolveFoodDessertPortionMacros(foodItem, macroLibrary);
  }

  const libraryItem = findIngredientMacroLibraryItem(ingredientName, macroLibrary);
  if (!libraryItem) return { cal: 0, pro: 0, fiber: 0 };

  return {
    cal: Math.round(parseFoodMacroValue(libraryItem.calories)),
    pro: Math.round(parseFoodMacroValue(libraryItem.protein)),
    fiber: Math.round(parseFoodMacroValue(libraryItem.fiber ?? "")),
  };
}

/**
 * Construit une recette fictive à un ingrédient pour déduire une unité du stock
 * lors de la sélection d'un dessert dans le planning.
 */
export function buildFoodDessertMealPayload(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[] = [],
): Meal {
  const perUnit = parseQty(fi.grams);
  const ingredients =
    perUnit > 0 ? `${formatNumeric(perUnit)}g ${fi.name}` : `1 ${fi.name}`;
  const macros = resolveFoodDessertPortionMacros(fi, macroLibrary);

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

/** Construit une entrée extra dessert à partir d'une fiche aliment (stock ou snapshot). */
export function buildFoodDessertExtraEntry(
  fi: FoodItem,
  macroLibrary: IngredientMacroLibraryItem[] = [],
): FoodDessertExtraEntry {
  const mealPayload = buildFoodDessertMealPayload(fi, macroLibrary);
  const macros = resolveFoodDessertPortionMacros(fi, macroLibrary);
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
}

/**
 * Retrouve la fiche aliment snapshotée pour un extra dessert dont le stock a été consommé.
 */
export function findSnapshotFoodItemForDessertExtra(
  snapshotStore: Record<string, Record<string, FoodItem[][]>>,
  dessertExtraId: string,
): FoodItem | null {
  for (const dayStore of Object.values(snapshotStore)) {
    const occurrences = dayStore[dessertExtraId];
    if (!occurrences?.length) continue;
    const lastOccurrence = occurrences[occurrences.length - 1];
    const fi = lastOccurrence?.[0];
    if (fi?.id && fi.name) return fi;
  }
  return null;
}

/**
 * Complète le catalogue desserts avec les fiches supprimées du stock mais encore sélectionnées
 * (snapshots de déduction planning).
 */
export function supplementFoodDessertExtrasFromSnapshots(
  existing: FoodDessertExtraEntry[],
  snapshotStore: Record<string, Record<string, FoodItem[][]>>,
  macroLibrary: IngredientMacroLibraryItem[] = [],
  ensureExtraIds: string[] = [],
): FoodDessertExtraEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const candidateIds = new Set(
    ensureExtraIds.filter((id) => parseFoodDessertExtraId(id)),
  );

  for (const dayStore of Object.values(snapshotStore)) {
    for (const dessertExtraId of Object.keys(dayStore)) {
      if (parseFoodDessertExtraId(dessertExtraId)) candidateIds.add(dessertExtraId);
    }
  }

  for (const dessertExtraId of candidateIds) {
    if (byId.has(dessertExtraId)) continue;
    const fi = findSnapshotFoodItemForDessertExtra(snapshotStore, dessertExtraId);
    if (!fi) continue;
    const nameKey = normalizeKey(fi.name);
    if (!nameKey) continue;
    const isRequiredSelection = ensureExtraIds.includes(dessertExtraId);
    if (isRequiredSelection) {
      for (const [existingId, existingExtra] of [...byId]) {
        if (existingId !== dessertExtraId && normalizeKey(existingExtra.name) === nameKey) {
          byId.delete(existingId);
        }
      }
    } else {
      const alreadyListed = [...byId.values()].some((entry) => normalizeKey(entry.name) === nameKey);
      if (alreadyListed) continue;
    }
    byId.set(dessertExtraId, buildFoodDessertExtraEntry(fi, macroLibrary));
  }

  return [...byId.values()].sort((a, b) => {
    if (a.sortExpiry && b.sortExpiry) return a.sortExpiry.localeCompare(b.sortExpiry);
    if (a.sortExpiry) return -1;
    if (b.sortExpiry) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/**
 * Construit les entrées extras planning à partir des aliments marqués dessert.
 * Macros par unité ; le décompte stock est fait côté planning via mealPayload.
 */
export function buildFoodDessertExtras(
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  macroLibrary: IngredientMacroLibraryItem[] = [],
): FoodDessertExtraEntry[] {
  const idSet = new Set(dessertFoodItemIds);

  return foodItems
    .filter((fi) => idSet.has(fi.id))
    .map((fi) => buildFoodDessertExtraEntry(fi, macroLibrary))
    .sort((a, b) => {
      if (a.sortExpiry && b.sortExpiry) return a.sortExpiry.localeCompare(b.sortExpiry);
      if (a.sortExpiry) return -1;
      if (b.sortExpiry) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
}
