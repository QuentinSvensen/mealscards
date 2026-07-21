import type { Meal } from "@/types/meals";
import { parseIngredientGroups, type ParsedIngredient } from "@/lib/ingredientUtils";

import { findStockKey, type StockInfo } from "./stockMap";

/**
 * Applique une déduction (grammes et/ou unités) au stock mutable courant.
 * Lorsque seuls des grammes sont retirés, le compteur d'unités est recalculé proportionnellement.
 */
function applyDeductionToStockSnapshot(
  stock: { grams: number; count: number; infinite: boolean },
  d: { grams: number; count: number },
): void {
  if (stock.infinite) return;
  const gBefore = stock.grams;
  const cBefore = stock.count;
  if (d.grams > 0) stock.grams = Math.max(0, stock.grams - d.grams);
  if (d.count > 0) stock.count = Math.max(0, stock.count - d.count);
  if (d.grams > 0 && d.count === 0 && gBefore > 1e-6) {
    const gAfter = stock.grams;
    const share = gAfter / gBefore;
    stock.count = Math.max(0, Math.round(cBefore * share));
  }
}

/**
 * Calcule le nombre de portions faisables d'un repas avec le stock actuel.
 *
 * Sémantique des groupes :
 * - Chaque groupe (séparé par virgule/newline) = un ingrédient REQUIS.
 * - Les alternatives `A | B` d'un groupe = types interchangeables (OU).
 * - Les ingrédients additifs d'une alt (`A + B`) = bundle à prendre ensemble.
 *
 * Pour un groupe `pain | baguette`, chaque portion peut utiliser pain OU baguette.
 * On simule donc les portions une à une : à chaque portion, on pioche la
 * première alternative encore disponible. Ça permet de cumuler correctement
 * (ex. 400g pain + 780g baguette + besoin 100g → 4+7 = 11 portions) et ça reste
 * correct quand les alternatives partagent un ingrédient (ex. `A+chorizo | B+chorizo`).
 *
 * Retourne null si aucun ingrédient requis n'est disponible, Infinity si tout est infini.
 */
export function getMealMultiple(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  const hasRequired = groups.some(g => !g[0]?.[0]?.optional);
  if (!hasRequired) return null;

  // Pré-calculer les clés normalisées pour chaque nom d'ingrédient (évite les lookups répétés).
  const keyByName = new Map<string, string | null>();
  const resolveKey = (name: string): string | null => {
    if (keyByName.has(name)) return keyByName.get(name)!;
    const k = findStockKey(stockMap, name);
    keyByName.set(name, k);
    return k;
  };

  // Cas tout-infini : toutes les alts d'au moins un bundle par groupe requis sont infinies → Infinity.
  let allGroupsAllInfinite = true;
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    let anyAltFullyInfinite = false;
    for (const alt of group) {
      let altAllInfinite = true;
      for (const item of alt) {
        if (item.optional) continue;
        const key = resolveKey(item.name);
        if (!key) { altAllInfinite = false; break; }
        const stock = stockMap.get(key)!;
        if (!stock.infinite) { altAllInfinite = false; break; }
      }
      if (altAllInfinite) { anyAltFullyInfinite = true; break; }
    }
    if (!anyAltFullyInfinite) { allGroupsAllInfinite = false; break; }
  }
  if (allGroupsAllInfinite) return Infinity;

  // Copie mutable du stock pour simuler les déductions portion par portion.
  const remaining = new Map<string, { grams: number; count: number; infinite: boolean }>();
  for (const [k, v] of stockMap.entries()) {
    remaining.set(k, { grams: v.grams, count: v.count, infinite: v.infinite });
  }

  /**
   * Tente de réserver une portion pour l'alt donné. Si ok, pousse les déductions
   * dans `out` sans modifier encore `remaining`. Retourne true si toutes les parts
   * du bundle sont disponibles.
   */
  const tryReserveAlt = (
    alt: ParsedIngredient[],
    out: Array<{ key: string; grams: number; count: number }>,
  ): boolean => {
    const proposed: Array<{ key: string; grams: number; count: number }> = [];
    // Cumul des besoins par clé pour gérer les doublons dans un même bundle.
    const needByKey = new Map<string, { grams: number; count: number }>();
    for (const item of alt) {
      if (item.optional) continue;
      const key = resolveKey(item.name);
      if (key === null) return false;
      const stock = remaining.get(key)!;
      if (stock.infinite) continue;
      const acc = needByKey.get(key) ?? { grams: 0, count: 0 };
      if (item.count > 0) acc.count += item.count;
      else if (item.qty > 0) acc.grams += item.qty;
      needByKey.set(key, acc);
    }
    for (const [key, need] of needByKey) {
      const stock = remaining.get(key)!;
      if (stock.infinite) continue;
      if (need.count > 0 && stock.count < need.count) return false;
      if (need.grams > 0 && stock.grams < need.grams) return false;
      proposed.push({ key, grams: need.grams, count: need.count });
    }
    out.push(...proposed);
    return true;
  };

  let servings = 0;
  const MAX_SERVINGS = 1000; // garde-fou pour éviter toute boucle infinie.
  while (servings < MAX_SERVINGS) {
    const thisServingDeductions: Array<{ key: string; grams: number; count: number }> = [];
    let allGroupsSatisfied = true;
    for (const group of groups) {
      if (group[0]?.[0]?.optional) continue;
      let altChosen = false;
      for (const alt of group) {
        if (tryReserveAlt(alt, thisServingDeductions)) { altChosen = true; break; }
      }
      if (!altChosen) { allGroupsSatisfied = false; break; }
    }
    if (!allGroupsSatisfied) break;
    for (const d of thisServingDeductions) {
      const stock = remaining.get(d.key)!;
      applyDeductionToStockSnapshot(stock, d);
    }
    servings++;
  }

  return servings === 0 ? null : servings;
}

/**
 * Déduit une portion du repas du stock virtuel en reprenant exactement la même règle
 * que getMealMultiple (première alternative d'ingrédients encore satisfaisante par groupe).
 * Les quantités déduites sont multipliées par `ratio` (portion entière ou partielle).
 * Retourne false si aucune portion n'a pu être déduite (stock insuffisant).
 */
export function deductMealServingFromVirtualStock(
  meal: Meal,
  virtualStock: Map<string, StockInfo>,
  ratio: number = 1
): boolean {
  if (ratio <= 0 || !meal.ingredients?.trim()) return false;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return false;
  const hasRequired = groups.some((g) => !g[0]?.[0]?.optional);
  if (!hasRequired) return false;

  const keyByName = new Map<string, string | null>();
  const resolveKey = (name: string): string | null => {
    if (keyByName.has(name)) return keyByName.get(name)!;
    const k = findStockKey(virtualStock, name);
    keyByName.set(name, k);
    return k;
  };

  const tryReserveAlt = (
    alt: ParsedIngredient[],
    out: Array<{ key: string; grams: number; count: number }>
  ): boolean => {
    const needByKey = new Map<string, { grams: number; count: number }>();
    for (const item of alt) {
      if (item.optional) continue;
      const key = resolveKey(item.name);
      if (key === null) return false;
      const stock = virtualStock.get(key)!;
      if (stock.infinite) continue;
      const acc = needByKey.get(key) ?? { grams: 0, count: 0 };
      if (item.count > 0) acc.count += item.count;
      else if (item.qty > 0) acc.grams += item.qty;
      needByKey.set(key, acc);
    }
    const proposed: Array<{ key: string; grams: number; count: number }> = [];
    for (const [key, need] of needByKey) {
      const stock = virtualStock.get(key)!;
      if (stock.infinite) continue;
      const needG = need.grams * ratio;
      const needC = need.count * ratio;
      if (need.count > 0 && stock.count < needC) return false;
      if (need.grams > 0 && stock.grams < needG) return false;
      proposed.push({ key, grams: needG, count: needC });
    }
    out.push(...proposed);
    return true;
  };

  const thisServingDeductions: Array<{ key: string; grams: number; count: number }> = [];
  let allGroupsSatisfied = true;
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    let altChosen = false;
    for (const alt of group) {
      if (tryReserveAlt(alt, thisServingDeductions)) {
        altChosen = true;
        break;
      }
    }
    if (!altChosen) {
      allGroupsSatisfied = false;
      break;
    }
  }
  if (!allGroupsSatisfied) return false;

  for (const d of thisServingDeductions) {
    const stock = virtualStock.get(d.key)!;
    applyDeductionToStockSnapshot(stock, d);
  }
  return true;
}

/**
 * Calcule combien de portions on peut préparer avec un ratio donné sur la recette d'origine
 * (sans la mettre à l'échelle au préalable). Évite les faux x1000 quand les quantités scalées
 * deviennent nulles ou trop petites pour être déduites correctement du stock.
 * Si tous les ingrédients sont infinis, renvoie Infinity (comme getMealMultiple) même à ratio ≠ 1.
 */
export function getMealMultipleAtRatio(
  meal: Meal,
  stockMap: Map<string, StockInfo>,
  ratio: number = 1,
): number | null {
  if (!meal.ingredients?.trim()) return null;
  if (ratio <= 0) return null;
  const baseMultiple = getMealMultiple(meal, stockMap);
  if (ratio === 1) return baseMultiple;
  // Tout-infini : la boucle virtuelle ne déduit jamais rien → plafond 1000 = faux « x1000 ».
  if (baseMultiple === Infinity) return Infinity;

  const virtualStock = new Map<string, StockInfo>();
  for (const [k, v] of stockMap.entries()) {
    virtualStock.set(k, { ...v });
  }

  let servings = 0;
  const MAX_SERVINGS = 1000;
  while (servings < MAX_SERVINGS) {
    if (!deductMealServingFromVirtualStock(meal, virtualStock, ratio)) break;
    servings++;
  }
  return servings === 0 ? null : servings;
}

/**
 * Indique si le comptage d'un ingrédient doit être arrondi à l'entier lors du scale
 * (ex. 4 œufs), contrairement aux fractions unitaires (ex. 0,5 œuf).
 */
function shouldRoundCountWhenScaling(count: number): boolean {
  return count >= 1;
}

/**
 * Calcule le ratio fractionnaire maximal (entre 0.5 et 1.0) pour une portion partielle.
 * Utilisé quand un repas n'est pas faisable à 100% mais qu'une portion réduite l'est.
 * Tient compte des ingrédients indivisibles pour arrondir le ratio.
 */
export function getMealFractionalRatio(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let minGlobalRatio = Infinity;

  // 1. Déterminer le ratio théorique maximal possible (en tenant compte des alternatives)
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    let bestAltRatio = 0;
    let anyAltPartiallyMatched = false;

    for (const alt of group) {
      let bundleRatio = Infinity;
      let allPartsHaveSomeStock = true;

      for (const item of alt) {
        const key = findStockKey(stockMap, item.name);
        if (key === null) { allPartsHaveSomeStock = false; break; }
        const stock = stockMap.get(key)!;
        if (stock.infinite) continue;

        let itemRatio = 0;
        if (item.count > 0) { itemRatio = stock.count / item.count; }
        else if (item.qty > 0) { itemRatio = stock.grams / item.qty; }
        else { itemRatio = Infinity; }

        if (itemRatio <= 0) { allPartsHaveSomeStock = false; break; }
        bundleRatio = Math.min(bundleRatio, itemRatio);
      }

      if (allPartsHaveSomeStock) {
        anyAltPartiallyMatched = true;
        bestAltRatio = Math.max(bestAltRatio, bundleRatio);
      }
    }

    if (!anyAltPartiallyMatched) return null;
    minGlobalRatio = Math.min(minGlobalRatio, bestAltRatio);
  }

  const hasRequired = groups.some(g => !g[0]?.[0]?.optional);
  if (!hasRequired) return null;

  // 2. Affiner le ratio global avec les contraintes d'indivisibilité
  // On doit choisir une alternative pour chaque groupe pour appliquer les arrondis.
  // On choisit l'alternative qui offre déjà le meilleur ratio (bestAltRatio).
  for (const group of groups) {
    if (group[0]?.[0]?.optional) continue;
    
    // Trouver quelle alternative correspond au ratio actuel pour ce groupe
    // (on simplifie en prenant la première qui permet au moins minGlobalRatio)
    let selectedAlt = group[0];
    for (const alt of group) {
      let altCanSupport = true;
      for (const item of alt) {
        const key = findStockKey(stockMap, item.name);
        if (!key) { altCanSupport = false; break; }
        const stock = stockMap.get(key)!;
        if (stock.infinite) continue;
        const availableRatio = item.count > 0 ? stock.count / item.count : (item.qty > 0 ? stock.grams / item.qty : Infinity);
        if (availableRatio < minGlobalRatio - 0.001) { altCanSupport = false; break; }
      }
      if (altCanSupport) { selectedAlt = alt; break; }
    }

    // Appliquer les arrondis sur l'alternative sélectionnée
    for (const item of selectedAlt) {
      const key = findStockKey(stockMap, item.name);
      if (!key) continue;
      const stock = stockMap.get(key)!;

      if (stock.indivisibleUnit > 0 && item.qty > 0) {
        const needed = item.qty * minGlobalRatio;
        const snapped = Math.floor(needed / stock.indivisibleUnit + 0.01) * stock.indivisibleUnit;
        if (snapped <= 0) return null;
        minGlobalRatio = Math.min(minGlobalRatio, snapped / item.qty);
      }
      if (item.count > 0 && item.qty === 0) {
        const needed = item.count * minGlobalRatio;
        const snapped = Math.floor(needed + 0.01);
        if (snapped <= 0) return null;
        minGlobalRatio = Math.min(minGlobalRatio, snapped / item.count);
      }
    }
  }

  if (minGlobalRatio === Infinity || minGlobalRatio >= 1 || minGlobalRatio < 0.5) return null;
  return minGlobalRatio;
}

