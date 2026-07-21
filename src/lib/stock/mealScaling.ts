import type { Meal } from "@/types/meals";
import {
  parseQty, formatNumeric, parseIngredientLineRaw,
  extractMetrics,
} from "@/lib/ingredientUtils";

import { findStockKey, type StockInfo } from "./stockMap";

/**
 * Indique si le comptage d'un ingrédient doit être arrondi à l'entier lors du scale
 * (ex. 4 œufs), contrairement aux fractions unitaires (ex. 0,5 œuf).
 */
function shouldRoundCountWhenScaling(count: number): boolean {
  return count >= 1;
}

export function getValidDiscreteRatios(meal: Meal, stockMap?: Map<string, StockInfo>): number[] | null {
  if (!meal.ingredients?.trim()) return null;

  let validRatios: number[] | null = null;
  const EPSILON = 0.001;

  meal.ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .forEach(group => {
      const alt = group.split(/\|/).map(s => s.trim()).filter(Boolean)[0];
      if (!alt || alt.startsWith("?")) return;

      const { text: withoutMetrics } = extractMetrics(alt);
      const parsed = parseIngredientLineRaw(withoutMetrics);

      let isIndivisible = false;
      let myRatios: number[] = [];

      // Ingrédient compté (ex: "2 oeufs") → ratios = multiples de 1/count
      if (parsed.count > 0 && parsed.qty === 0) {
        isIndivisible = true;
        for (let k = 1; (k / parsed.count) <= 10; k++) {
          myRatios.push(k / parsed.count);
        }
      } else if (stockMap) {
        // Ingrédient indivisible en stock (marqué is_indivisible)
        const key = findStockKey(stockMap, parsed.name);
        if (key) {
          const stock = stockMap.get(key)!;
          if (stock.indivisibleUnit > 0 && parsed.qty > 0) {
            isIndivisible = true;
            for (let k = 1; ((k * stock.indivisibleUnit) / parsed.qty) <= 10; k++) {
              myRatios.push((k * stock.indivisibleUnit) / parsed.qty);
            }
          }
        }
      }

      if (isIndivisible) {
        if (!myRatios.some(r => Math.abs(r - 1.0) < EPSILON)) myRatios.push(1.0);
        if (validRatios === null) {
          validRatios = myRatios;
        } else {
          // Intersection des ratios valides entre tous les ingrédients indivisibles
          validRatios = validRatios.filter(vr => myRatios.some(mr => Math.abs(vr - mr) < EPSILON));
        }
      }
    });

  if (validRatios !== null && validRatios.length === 0) return [1.0];
  return validRatios;
}

/** Arrondit un ratio demandé au ratio discret valide le plus proche */
export function getIndivisibleConstrainedRatio(meal: Meal, requestedRatio: number, stockMap?: Map<string, StockInfo>): number {
  if (requestedRatio === 1) return 1;
  const validRatios = getValidDiscreteRatios(meal, stockMap);
  if (!validRatios) return requestedRatio;

  let best = validRatios[0];
  let minDiff = Math.abs(best - requestedRatio);
  for (const r of validRatios) {
    const diff = Math.abs(r - requestedRatio);
    if (diff < minDiff) { minDiff = diff; best = r; }
  }
  return best;
}

/** Construit un repas mis à l'échelle (calories, protéines, grammes, ingrédients multipliés par ratio) */
export function buildScaledMealForRatio(meal: Meal, ratio: number, stockMap?: Map<string, StockInfo>): Meal {
  const mealCal = meal.calories ? parseFloat(meal.calories.replace(/[^0-9.]/g, "")) : 0;
  const mealProt = meal.protein ? parseFloat(meal.protein.replace(/[^0-9.]/g, "")) : 0;
  const mealGrams = parseQty(meal.grams);
  return {
    ...meal,
    calories: meal.calories ? String(Math.round(mealCal * ratio)) : null,
    protein: meal.protein ? String(Math.round(mealProt * ratio)) : null,
    grams: meal.grams ? formatNumeric(Math.round(mealGrams * ratio * 10) / 10) : null,
    ingredients: scaleIngredientStringExact(meal.ingredients, ratio, stockMap),
  };
}

/**
 * Retire les parenthèses englobantes d'un bundle d'ingrédients (ex. sélection « + »).
 */
function stripOuterParens(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Découpe une alternative en sous-ingrédients reliés par « + » (bundle ET).
 */
function splitIngredientAltBundle(alt: string): string[] {
  const parts = stripOuterParens(alt).split(/\+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [alt.trim()];
}

/**
 * Applique un ratio à un seul token d'ingrédient (sans « | » ni « + »).
 * Sert le scaling des cartes Possible et des overrides de quantités.
 */
function scaleIngredientAltToken(
  alt: string,
  effectiveRatio: number,
  stockMap?: Map<string, StockInfo>,
  allowIndivisibleSplitInPossible: boolean = false,
): string {
  const isOptional = alt.startsWith("?");
  const cleanAlt = isOptional ? alt.slice(1).trim() : alt;

  const { text: withoutMetrics, cal, pro } = extractMetrics(cleanAlt);
  const parsed = parseIngredientLineRaw(withoutMetrics);

  let scaledQtyRaw = parsed.qty > 0 ? parsed.qty * effectiveRatio : 0;
  let scaledCountRaw = parsed.count > 0 ? parsed.count * effectiveRatio : 0;

  if (parsed.count > 0 && parsed.qty === 0 && !allowIndivisibleSplitInPossible && shouldRoundCountWhenScaling(parsed.count)) {
    scaledCountRaw = Math.round(scaledCountRaw);
  }

  if (stockMap && !allowIndivisibleSplitInPossible) {
    const key = findStockKey(stockMap, parsed.name);
    if (key) {
      const stock = stockMap.get(key)!;
      if (stock.indivisibleUnit > 0 && parsed.qty > 0) {
        scaledQtyRaw = Math.round(scaledQtyRaw / stock.indivisibleUnit) * stock.indivisibleUnit;
      }
    }
  }

  const scaledQty = scaledQtyRaw > 0 ? formatNumeric(Math.round(scaledQtyRaw * 10) / 10) : "";
  const scaledCount = scaledCountRaw > 0 ? formatNumeric(Math.round(scaledCountRaw * 10) / 10) : "";

  let token = [scaledQty ? `${scaledQty}g` : "", scaledCount, parsed.rawName].filter(Boolean).join(" ");

  if (cal) token += ` {${cal}}`;
  if (pro) token += ` [${pro}]`;

  return isOptional ? `?${token}` : token;
}

/**
 * Met à l'échelle une alternative entière (bundle « + » éventuellement entre parenthèses).
 */
function scaleIngredientAltBundle(
  alt: string,
  effectiveRatio: number,
  stockMap?: Map<string, StockInfo>,
  allowIndivisibleSplitInPossible: boolean = false,
): string {
  const trimmed = alt.trim();
  const hadOuterParens = trimmed.startsWith("(") && trimmed.endsWith(")");
  const bundleParts = splitIngredientAltBundle(trimmed);
  if (bundleParts.length <= 1) {
    return scaleIngredientAltToken(trimmed, effectiveRatio, stockMap, allowIndivisibleSplitInPossible);
  }
  const scaled = bundleParts
    .map((part) => scaleIngredientAltToken(part, effectiveRatio, stockMap, allowIndivisibleSplitInPossible))
    .join(" + ");
  return hadOuterParens ? `( ${scaled} )` : scaled;
}

/**
 * Multiplie toutes les quantités d'une chaîne d'ingrédients par un ratio.
 * 
 * Gère :
 * - Les alternatives (A | B) : chaque alternative est scalée
 * - Les bundles ET (A + B) : chaque sous-ingrédient est scalé
 * - Les ingrédients optionnels (?) : scalés aussi
 * - Les comptages arrondis : "2 oeufs" × 1.5 → "3 oeufs"
 * - Les ingrédients indivisibles : arrondis au multiple de l'unité
 * - Les macros {cal} et [pro] : préservées telles quelles
 */
export function scaleIngredientStringExact(
  rawIngredients: string | null,
  ratio: number,
  stockMap?: Map<string, StockInfo>,
  allowIndivisibleSplitInPossible: boolean = false,
): string | null {
  if (!rawIngredients?.trim()) return null;

  // Première passe : déterminer le ratio effectif en tenant compte des arrondis de comptage
  let effectiveRatio = ratio;
  const groups = rawIngredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);

  for (const group of groups) {
    for (const alt of group.split(/\|/).map((s) => s.trim()).filter(Boolean)) {
      for (const part of splitIngredientAltBundle(alt)) {
        const isOptional = part.startsWith("?");
        const cleanAlt = isOptional ? part.slice(1).trim() : part;
        const { text: withoutMetrics } = extractMetrics(cleanAlt);
        const parsed = parseIngredientLineRaw(withoutMetrics);

        if (parsed.count > 0 && parsed.qty === 0 && !allowIndivisibleSplitInPossible && shouldRoundCountWhenScaling(parsed.count)) {
          const scaledCount = Math.round(parsed.count * ratio);
          const actualRatio = scaledCount / parsed.count;
          if (scaledCount > 0 && Math.abs(actualRatio - ratio) > 0.001) {
            effectiveRatio = actualRatio;
          }
        }
      }
    }
  }
  if (effectiveRatio <= 0) effectiveRatio = ratio;

  // Deuxième passe : appliquer le ratio effectif à tous les ingrédients
  return groups.map(group => {
    return group.split(/\|/).map(s => s.trim()).filter(Boolean)
      .map((alt) => scaleIngredientAltBundle(alt, effectiveRatio, stockMap, allowIndivisibleSplitInPossible))
      .join(" | ");
  }).join(", ");
}

