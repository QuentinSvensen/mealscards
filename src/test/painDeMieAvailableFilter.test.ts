import { describe, it, expect } from "vitest";
import {
  buildStockMap,
  getMealMultiple,
  getMealFractionalRatio,
  findStockKey,
  getMissingIngredients,
  getMissingQuantityForIngredient,
} from "@/lib/stockUtils";
import {
  filterMealsByStockAvailability,
  matchesFullStockRecipeFilter,
  MIN_FULL_STOCK_RATIO,
  type UnifiedAvail,
} from "@/lib/availableListPipeline";
import { normalizeKey } from "@/lib/ingredientUtils";
import type { FoodItem } from "@/types/food";
import type { Meal } from "@/types/meals";

/** Construit un aliment de test minimal pour les scénarios stock. */
function makeFoodItem(overrides: Partial<FoodItem> & { name: string }): FoodItem {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    storage_type: "frigo",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    quantity: 1,
    grams: null,
    calories: null,
    protein: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    expiration_date: "2026-07-25",
    counter_start_date: null,
    food_type: null,
    no_counter: false,
    fiber: null,
    ...overrides,
  };
}

/** Construit un repas de test minimal. */
function makeMeal(overrides: Partial<Meal> & { name: string; ingredients: string }): Meal {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    category: "plat",
    sort_order: 0,
    created_at: new Date().toISOString(),
    is_available: true,
    is_favorite: false,
    calories: null,
    protein: null,
    grams: null,
    oven_temp: null,
    oven_minutes: null,
    description: null,
    fiber: null,
    ...overrides,
  };
}

describe("Filtre Au choix — Pain de mie poitrine (e2e affichage)", () => {
  const recipeIng = "3 Pain de mie | 150g Pains, 6 Poitrine";

  it("stock #2 → pas de ×1, partiel ≈ 66 % inclus sans filtre 100 %", () => {
    const meals = [makeMeal({ name: "Pain de mie poitrine", ingredients: recipeIng })];
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const stockMap = buildStockMap(foodItems);
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(findStockKey(stockMap, "Pains")).toBeNull();
    expect(getMealMultiple(meals[0], stockMap)).toBeNull();
    expect(getMealFractionalRatio(meals[0], stockMap)).toBeCloseTo(2 / 3);
    expect(available).toHaveLength(0);
    expect(partial).toHaveLength(1);
    expect(partial[0].ratio).toBeCloseTo(2 / 3);
    expect(getMissingIngredients(meals[0], stockMap).has(normalizeKey("Pain de mie"))).toBe(true);
  });

  it("filtre 100 % (stock ≥ 90 %) exclut le partiel 66 %", () => {
    const meals = [makeMeal({ name: "Pain de mie poitrine", ingredients: recipeIng })];
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(available).toHaveLength(0);
    expect(partial).toHaveLength(1);
    const ratio = partial[0].ratio;
    expect(ratio).toBeLessThan(MIN_FULL_STOCK_RATIO);
    const partialUnified: UnifiedAvail = {
      type: "partial",
      key: `partial-${partial[0].meal.id}`,
      item: partial[0],
      sortDate: null,
      sortCounter: null,
      sortCalories: null,
    };
    // Filtre « 100 % » = stock uniquement : 66 % exclus (indépendant du seuil calories).
    expect(matchesFullStockRecipeFilter(partialUnified)).toBe(false);
  });

  it("filtre 100 % garde une recette stock ×2 même si le ratio calories serait ~67 %", () => {
    // Cas Hachis : multiple ≥ 1 (badge ×2) → type « av » ; le seuil kcal peut réduire
    // l’affichage (~67 %) via tryFitMeal, sans exclure du filtre stock « 100 % ».
    const meals = [
      makeMeal({
        name: "Hachis parmentier",
        ingredients: "400g Pomme de terre, 200g Boeuf hache",
        calories: "800",
      }),
    ];
    const foodItems = [
      makeFoodItem({ name: "Pomme de terre", quantity: 1, grams: "1000" }),
      makeFoodItem({ name: "Boeuf hache", quantity: 1, grams: "500" }),
    ];
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(partial).toHaveLength(0);
    expect(available).toHaveLength(1);
    expect(available[0].multiple).toBeGreaterThanOrEqual(2);
    const avUnified: UnifiedAvail = {
      type: "av",
      key: available[0].meal.id,
      item: available[0],
      sortDate: null,
      sortCounter: null,
      sortCalories: 800,
    };
    expect(matchesFullStockRecipeFilter(avUnified)).toBe(true);
  });

  it("exclut le faux ×1 via stock « Pain » quand Pain de mie #2 < 3 (partiel OK)", () => {
    const meals = [makeMeal({ name: "Pain de mie poitrine", ingredients: recipeIng })];
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "200" }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(getMealMultiple(meals[0], buildStockMap(foodItems))).toBeNull();
    expect(available).toHaveLength(0);
    expect(partial).toHaveLength(1);
    expect(partial[0].ratio).toBeCloseTo(2 / 3);
  });

  it("exclut le faux ×1 via OU grammes même produit ; partiel 2/3 via #", () => {
    const meals = [
      makeMeal({
        name: "Pain de mie poitrine",
        ingredients: "3 Pain de mie | 150g Pain de mie, 6 Poitrine",
      }),
    ];
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: "80" }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(available).toHaveLength(0);
    expect(partial).toHaveLength(1);
    expect(partial[0].ratio).toBeCloseTo(2 / 3);
    expect(getMealFractionalRatio(meals[0], buildStockMap(foodItems))).toBeCloseTo(2 / 3);
  });

  it("garde une OU spécifique (Baguette) faisable malgré # Pain de mie insuffisant", () => {
    const meals = [
      makeMeal({
        name: "Pain de mie poitrine",
        ingredients: "3 Pain de mie | 150g Baguette, 6 Poitrine",
      }),
    ];
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "200" }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const { available, partial } = filterMealsByStockAvailability(meals, foodItems);
    expect(available.map((a) => a.multiple)).toEqual([1]);
    expect(partial).toHaveLength(0);
  });

  it("autorise « 150g Pains » si aucun Pain de mie en stock (pas de frère composé court)", () => {
    const meals = [makeMeal({ name: "Pain de mie poitrine", ingredients: recipeIng })];
    const foodItems = [
      makeFoodItem({ name: "Pain", quantity: 1, grams: "200" }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const { available } = filterMealsByStockAvailability(meals, foodItems);
    expect(available.map((a) => a.multiple)).toEqual([1]);
  });
});

describe("Aliments pour compléter — quantité manquante (besoin − stock)", () => {
  const recipeIng = "3 Pain de mie | 150g Pains, 6 Poitrine";

  it("Pain de mie besoin 3 / stock #2 → affiche ×1 (pas ×3)", () => {
    const meal = makeMeal({ name: "Pain de mie poitrine", ingredients: recipeIng });
    const foodItems = [
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
      makeFoodItem({ name: "Poitrine", quantity: 6, grams: null }),
    ];
    const stockMap = buildStockMap(foodItems);
    const missingKey = normalizeKey("Pain de mie");
    expect(getMissingIngredients(meal, stockMap).has(missingKey)).toBe(true);

    const deficit = getMissingQuantityForIngredient(meal.ingredients, missingKey, stockMap);
    expect(deficit.count).toBe(1);
    expect(deficit.qty).toBe(0);
    expect(deficit.displayName).toBe("Pain de mie");
  });

  it("grammes : besoin 150g / stock 50g → affiche 100g", () => {
    const meal = makeMeal({
      name: "Test farine",
      ingredients: "150g Farine, 2 Oeuf",
    });
    const foodItems = [
      makeFoodItem({ name: "Farine", quantity: 1, grams: "50" }),
      makeFoodItem({ name: "Oeuf", quantity: 2, grams: null }),
    ];
    const stockMap = buildStockMap(foodItems);
    const missingKey = normalizeKey("Farine");
    // Farine insuffisante + Oeuf OK → Farine manquante seule si le reste est couvert.
    // Ici on teste uniquement le déficit grammes (besoin − stock).
    const deficit = getMissingQuantityForIngredient(meal.ingredients, missingKey, stockMap);
    expect(deficit.qty).toBe(100);
    expect(deficit.count).toBe(0);
  });

  it("multi-recettes : agrège par max des manques (cohérent « pour compléter »)", () => {
    const stockMap = buildStockMap([
      makeFoodItem({ name: "Pain de mie", quantity: 2, grams: null }),
    ]);
    const key = normalizeKey("Pain de mie");
    const d1 = getMissingQuantityForIngredient("3 Pain de mie, 6 Poitrine", key, stockMap);
    const d2 = getMissingQuantityForIngredient("4 Pain de mie, 1 Beurre", key, stockMap);
    // Recette A manque 1, recette B manque 2 → badge = max(1, 2) = 2
    expect(Math.max(d1.count, d2.count)).toBe(2);
  });

  it("stock nul → affiche le besoin total", () => {
    const stockMap = buildStockMap([]);
    const deficit = getMissingQuantityForIngredient(
      "3 Pain de mie, 6 Poitrine",
      normalizeKey("Pain de mie"),
      stockMap,
    );
    expect(deficit.count).toBe(3);
  });
});
