import type { FoodItem } from "@/types/food";
import {
  normalizeKey, strictNameMatch, parseQty, getFoodItemTotalGrams,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";

/** Informations de stock agrégées pour un aliment donné */
export interface StockInfo { grams: number; count: number; infinite: boolean; indivisibleUnit: number; }

/**
 * Construit une Map nom_normalisé → StockInfo à partir de la liste des aliments.
 * Les entrées de stockage « extras » sont toujours exclues (hors des calculs de stock).
 * Agrège les grammes, quantités et flags de tous les items portant le même nom.
 */
export function buildStockMap(foodItems: FoodItem[]): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>();
  for (const fi of foodItems) {
    if (fi.storage_type === "extras") continue;
    const key = normalizeKey(fi.name);
    const prev = map.get(key) ?? { grams: 0, count: 0, infinite: false, indivisibleUnit: 0 };
    if (fi.is_infinite) {
      map.set(key, { ...prev, infinite: true });
    } else {
      const unitGrams = parseQty(fi.grams);
      map.set(key, {
        grams: prev.grams + getFoodItemTotalGrams(fi),
        count: prev.count + (fi.quantity ?? 1),
        infinite: prev.infinite,
        indivisibleUnit: fi.is_indivisible && unitGrams > 0 ? Math.max(prev.indivisibleUnit, unitGrams) : prev.indivisibleUnit,
      });
    }
  }
  return map;
}

/** Trouve la clé normalisée dans la stockMap pour un nom d'ingrédient donné */
export function findStockKey(stockMap: Map<string, StockInfo>, name: string): string | null {
  const key = normalizeKey(name);
  if (stockMap.has(key)) return key;
  for (const k of stockMap.keys()) {
    if (strictNameMatch(k, name)) return k;
  }
  return null;
}

/**
 * Choisit la meilleure alternative parmi un groupe d'ingrédients OR.
 * Chaque alternative est un "bundle" (ParsedIngredient[]).
 * Priorise l'alternative dont TOUS les éléments du bundle sont en stock suffisant.
 */
export function pickBestAlternative(
  alts: ParsedIngredient[][],
  stockMap: Map<string, StockInfo>
): ParsedIngredient[] | null {
  for (const alt of alts) {
    let allPartsAvailable = true;
    for (const item of alt) {
      const key = findStockKey(stockMap, item.name);
      if (!key) { allPartsAvailable = false; break; }
      const stock = stockMap.get(key)!;
      if (stock.infinite) continue;
      if (item.count > 0 && stock.count < item.count) { allPartsAvailable = false; break; }
      if (item.qty > 0 && stock.grams < item.qty) { allPartsAvailable = false; break; }
    }
    if (allPartsAvailable) return alt;
  }
  return null;
}

