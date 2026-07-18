/**
 * Barrel de réexport — conserve la compatibilité des imports @/lib/stockUtils.
 * Implémentation découpée dans src/lib/stock/.
 */

// Réexporter les fonctions fréquemment utilisées pour un import centralisé
export {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientGroups,
} from "@/lib/ingredientUtils";

export * from "./stock/foodItemIndex";
export * from "./stock/stockMap";
export * from "./stock/mealMultiples";
export * from "./stock/foodItemState";
export * from "./stock/mealAnalysis";
export * from "./stock/counterBadge";
export * from "./stock/possibleFrozenCounters";
export * from "./stock/missingIngredients";
export * from "./stock/ingredientMealIndex";
export * from "./stock/displayedMacros";
export * from "./stock/stockFormatting";
export * from "./stock/mealScaling";
export * from "./stock/macroPropagation";

