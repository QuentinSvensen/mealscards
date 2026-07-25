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
 * Vérifie si une entrée de stock couvre le besoin d'un ingrédient (unités et/ou grammes).
 * Sert au filtrage « Au choix », au highlighting manquant, et au choix d'alternative OU.
 */
export function isStockSufficientForIngredient(
  item: Pick<ParsedIngredient, "qty" | "count">,
  stock: StockInfo,
): boolean {
  if (stock.infinite) return true;
  if (item.count > 0 && stock.count < item.count) return false;
  if (item.qty > 0 && stock.grams < item.qty) return false;
  if (item.count <= 0 && item.qty <= 0 && stock.grams <= 0 && stock.count <= 0) return false;
  return true;
}

/**
 * Bloque une alt. grammes si un frère du même groupe OU exige déjà plus d'unités (#)
 * que le stock sur la MÊME clé (ex. « 3 Pain de mie | 150g Pain de mie » avec #2).
 * Évite de « convertir » des unités insuffisantes en grammes pour valider la recette.
 */
export function isGramsAltBlockedBySiblingUnitShortfall(
  group: ParsedIngredient[][],
  alt: ParsedIngredient[],
  stockMap: Map<string, StockInfo>,
): boolean {
  for (const item of alt) {
    if (item.optional) continue;
    if (!(item.qty > 0 && item.count <= 0)) continue;
    const key = findStockKey(stockMap, item.name);
    if (!key) continue;
    const stock = stockMap.get(key)!;
    if (stock.infinite) continue;
    for (const sibling of group) {
      if (sibling === alt) continue;
      for (const sItem of sibling) {
        if (sItem.optional) continue;
        if (sItem.count < 1) continue;
        const sKey = findStockKey(stockMap, sItem.name);
        if (sKey !== key) continue;
        if (stock.count < sItem.count) return true;
      }
    }
  }
  return false;
}

/**
 * Bloque une alt. grammes trop générique (ex. « Pains » → stock « Pain »)
 * quand un frère composé (ex. « 3 Pain de mie ») est en stock mais en # insuffisant.
 * Empêche le faux ×1 Au choix via un pain générique alors que le produit précis manque.
 */
export function isGenericHeadNounBypassingFailedCompoundCount(
  group: ParsedIngredient[][],
  alt: ParsedIngredient[],
  stockMap: Map<string, StockInfo>,
): boolean {
  for (const item of alt) {
    if (item.optional) continue;
    if (!(item.qty > 0 && item.count <= 0)) continue;
    const altKey = findStockKey(stockMap, item.name);
    if (!altKey) continue;
    const altWords = altKey.split(/\s+/).filter(Boolean);
    if (altWords.length !== 1) continue;
    const head = altWords[0];

    for (const sibling of group) {
      if (sibling === alt) continue;
      for (const sItem of sibling) {
        if (sItem.optional) continue;
        if (sItem.count < 1) continue;
        const sKey = findStockKey(stockMap, sItem.name);
        if (!sKey) continue;
        const sWords = sKey.split(/\s+/).filter(Boolean);
        if (sWords.length < 2 || sWords[0] !== head) continue;
        const stock = stockMap.get(sKey)!;
        if (stock.infinite) continue;
        if (stock.count < sItem.count) return true;
      }
    }
  }
  return false;
}

/**
 * Indique si une alternative (bundle) est entièrement disponible dans le stock,
 * en appliquant les garde-fous anti faux-positifs des groupes OU.
 */
export function isAlternativeAvailableInStock(
  group: ParsedIngredient[][],
  alt: ParsedIngredient[],
  stockMap: Map<string, StockInfo>,
): boolean {
  if (isGramsAltBlockedBySiblingUnitShortfall(group, alt, stockMap)) return false;
  if (isGenericHeadNounBypassingFailedCompoundCount(group, alt, stockMap)) return false;
  for (const item of alt) {
    if (item.optional) continue;
    const key = findStockKey(stockMap, item.name);
    if (!key) return false;
    const stock = stockMap.get(key)!;
    if (!isStockSufficientForIngredient(item, stock)) return false;
  }
  return true;
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
    if (isAlternativeAvailableInStock(alts, alt, stockMap)) return alt;
  }
  return null;
}

