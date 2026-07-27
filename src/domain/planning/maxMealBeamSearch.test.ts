import { describe, it, expect } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  runMaxMealBeamSearch,
  measureLeftoverWaste,
  buildMaxMealCandidatePool,
  isBetterBeamPlan,
  beamPicksToDisplayRows,
} from "./maxMealBeamSearch";
import { groupGeneratedMealRows, sumGroupedMealPortions } from "@/components/MaxMealGenerator";
import {
  buildStockMap,
  deductMealServingFromVirtualStock,
  getMealMultiple,
} from "@/lib/stockUtils";

/** Construit un aliment minimal pour les tests du beam. */
function makeFoodItem(overrides: Partial<FoodItem> & { name: string }): FoodItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
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
    fiber: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    expiration_date: null,
    counter_start_date: null,
    food_type: null,
    no_counter: false,
    ...overrides,
  };
}

/** Construit une fiche repas minimale pour les tests du beam. */
function makeMeal(overrides: Partial<Meal> & { name: string }): Meal {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name,
    category: "plat",
    sort_order: 0,
    created_at: new Date().toISOString(),
    is_available: true,
    is_favorite: false,
    calories: null,
    protein: null,
    fiber: null,
    grams: null,
    ingredients: null,
    oven_temp: null,
    oven_minutes: null,
    description: null,
    ...overrides,
  };
}

/**
 * Glouton mono-chemin simplifié (1 portion par tour, préfère le plus petit reste
 * après avoir pris toutes les portions possibles) — miroir de l’ancien générateur.
 */
function runGreedyMaxMeals(foodItems: FoodItem[], meals: Meal[]): { portions: number; waste: number } {
  const stock = buildStockMap(foodItems);
  const virtual = new Map([...stock.entries()].map(([k, v]) => [k, { ...v }]));
  const candidates = buildMaxMealCandidatePool(meals, foodItems);

  let portions = 0;
  for (let guard = 0; guard < 200; guard++) {
    let best: { meal: Meal; ratio: number; waste: number; servings: number } | null = null;
    for (const meal of candidates) {
      const multiple = getMealMultiple(meal, virtual);
      if (multiple === null || multiple <= 0 || multiple === Infinity) continue;
      const fullServings = Math.floor(multiple);
      const partialRatio = multiple >= 0.5 && multiple < 1 ? multiple : null;
      if (fullServings < 1 && !partialRatio) continue;
      const servings = fullServings >= 1 ? fullServings : 1;
      const ratio = fullServings >= 1 ? 1 : (partialRatio as number);
      const trial = new Map([...virtual.entries()].map(([k, v]) => [k, { ...v }]));
      let ok = true;
      for (let i = 0; i < servings; i++) {
        if (!deductMealServingFromVirtualStock(meal, trial, ratio)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const waste = measureLeftoverWaste(trial);
      if (
        !best ||
        waste < best.waste - 40 ||
        (Math.abs(waste - best.waste) <= 40 && servings > best.servings)
      ) {
        best = { meal, ratio, waste, servings };
      }
    }
    if (!best) break;
    if (!deductMealServingFromVirtualStock(best.meal, virtual, best.ratio)) break;
    portions += 1;
  }
  return { portions, waste: measureLeftoverWaste(virtual) };
}

describe("maxMealBeamSearch", () => {
  it("avec 6 œufs préfère 2×3 plutôt que 1×4", () => {
    const foodItems = [makeFoodItem({ name: "Oeufs", quantity: 6 })];
    const meals = [
      makeMeal({ name: "Omelette 4", ingredients: "4 Oeufs" }),
      makeMeal({ name: "Brouillade 3", ingredients: "3 Oeufs" }),
    ];
    const best = runMaxMealBeamSearch(foodItems, meals, new Set(), { beamWidth: 40, maxDepth: 20 });
    expect(best.totalPortions).toBe(2);
    expect(best.picks.every((p) => p.meal.name === "Brouillade 3")).toBe(true);
    expect(best.picks.reduce((s, p) => s + p.ratio, 0)).toBe(2);
  });

  it("trouve au moins autant de repas qu’un glouton sous-optimal", () => {
    const foodItems = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "400" }),
      makeFoodItem({ name: "Riz", quantity: 1, grams: "200" }),
    ];
    const meals = [
      makeMeal({ name: "Bowl", ingredients: "200g Poulet, 200g Riz" }),
      makeMeal({ name: "Poulet seul", ingredients: "200g Poulet" }),
      makeMeal({ name: "Riz seul", ingredients: "100g Riz" }),
    ];
    const greedy = runGreedyMaxMeals(foodItems, meals);
    const best = runMaxMealBeamSearch(foodItems, meals, new Set(), { beamWidth: 60, maxDepth: 30 });
    expect(greedy.portions).toBeLessThan(best.totalPortions);
    expect(best.totalPortions).toBeGreaterThanOrEqual(4);
    expect(best.totalPortions).toBeGreaterThanOrEqual(greedy.portions);
  });

  it("le total des pastilles xN égale la somme des portions du plan", () => {
    const foodItems = [makeFoodItem({ name: "Oeufs", quantity: 6 })];
    const meals = [
      makeMeal({ name: "Omelette 4", ingredients: "4 Oeufs" }),
      makeMeal({ name: "Brouillade 3", ingredients: "3 Oeufs" }),
    ];
    const best = runMaxMealBeamSearch(foodItems, meals);
    const rows = beamPicksToDisplayRows(best.picks, buildStockMap(foodItems));
    const grouped = groupGeneratedMealRows(rows);
    expect(sumGroupedMealPortions(grouped)).toBe(best.totalPortions);
    expect(sumGroupedMealPortions(grouped)).toBe(2);
  });

  it("isBetterBeamPlan privilégie plus de portions puis moins de reste", () => {
    const foodItems = [makeFoodItem({ name: "Oeufs", quantity: 6 })];
    const stock = buildStockMap(foodItems);
    const a = {
      picks: [],
      stock,
      totalPortions: 2,
      waste: 100,
    };
    const b = {
      picks: [],
      stock,
      totalPortions: 1,
      waste: 0,
    };
    expect(isBetterBeamPlan(a, b)).toBe(true);
    expect(isBetterBeamPlan(b, a)).toBe(false);
    const c = { ...a, waste: 50 };
    expect(isBetterBeamPlan(c, a)).toBe(true);
  });
});
