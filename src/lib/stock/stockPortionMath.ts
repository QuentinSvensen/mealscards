import type { FoodItem } from "@/types/food";
import {
  encodeStoredGrams,
  formatNumeric,
  getFoodItemTotalGrams,
  parseQty,
} from "@/lib/ingredientUtils";

/** Arrondit un poids à 1 décimale, comme les écritures stock. */
export function roundStockGrams(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Indique que le delta a épuisé la fiche (à supprimer du stock). */
export function isDeletedGramsState(
  state: FoodItemGramsState | { delete: true },
): state is { delete: true } {
  return "delete" in state && state.delete === true;
}

type FoodGramsFields = Pick<FoodItem, "grams" | "quantity">;

/**
 * Calcule l’état grammes/quantité après un delta de poids (positif = rendu, négatif = déduction).
 * Conserve l’unité du paquet (`400|200`) au lieu d’écrire le total dans `grams`
 * (sinon le badge affiche 600g puis 1200g au fil des allers-retours Possible).
 */
export function applyGramsDeltaToFoodItem(
  fi: FoodGramsFields,
  deltaGrams: number,
): FoodItemGramsState | { delete: true } {
  const unit = parseQty(fi.grams);
  const currentTotal = getFoodItemTotalGrams(fi as FoodItem);
  const newTotal = roundStockGrams(currentTotal + deltaGrams);
  if (newTotal <= 0.01) return { delete: true };

  if (unit <= 0) {
    return { quantity: fi.quantity, grams: formatNumeric(newTotal) };
  }

  const usesPackQuantity = fi.quantity != null && fi.quantity >= 1;
  const fullUnits = Math.floor(newTotal / unit);
  const remainder = roundStockGrams(newTotal - fullUnits * unit);

  if (usesPackQuantity) {
    const quantity = remainder > 0 ? Math.max(1, fullUnits + 1) : Math.max(1, fullUnits);
    return {
      quantity,
      grams: encodeStoredGrams(unit, remainder > 0 ? remainder : null),
    };
  }

  if (newTotal >= unit && remainder <= 0 && fullUnits <= 1) {
    return { quantity: fi.quantity, grams: formatNumeric(unit) };
  }

  if (newTotal < unit) {
    return { quantity: fi.quantity, grams: encodeStoredGrams(unit, newTotal) };
  }

  const quantity = remainder > 0 ? fullUnits + 1 : Math.max(1, fullUnits);
  return {
    quantity,
    grams: encodeStoredGrams(unit, remainder > 0 ? remainder : null),
  };
}

/**
 * Limite les grammes à rendre pour une carte Possible.
 * On ne dépasse pas l’état du snapshot (avant déduction) et on n’ajoute rien
 * si le stock est déjà à ce niveau (déduction non appliquée ou déjà restaurée).
 */
export function gramsToRestoreTowardSnapshot(
  current: FoodGramsFields,
  snapshot: FoodGramsFields,
  requestedGrams: number,
): number {
  if (requestedGrams <= 0) return 0;
  const snapTotal = getFoodItemTotalGrams(snapshot as FoodItem);
  const currentTotal = getFoodItemTotalGrams(current as FoodItem);
  if (snapTotal <= 0) return requestedGrams;
  if (currentTotal >= snapTotal - 0.01) return 0;
  return Math.min(requestedGrams, roundStockGrams(snapTotal - currentTotal));
}
