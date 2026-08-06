import { describe, expect, it } from "vitest";
import {
  compareMealsByNutritionNote,
  compareMealsBySatiety,
  compareNullableSortValues,
  cycleAvailableSortMode,
  cycleMasterSortMode,
  sortMealsByMasterMode,
} from "@/lib/mealListSort";
import type { Meal } from "@/hooks/useMeals";

/** Construit un repas catalogue minimal pour les tests de tri. */
function makeMeal(partial: Partial<Meal> & Pick<Meal, "id" | "name">): Meal {
  return {
    id: partial.id,
    name: partial.name,
    category: partial.category ?? "plat",
    ingredients: partial.ingredients ?? null,
    calories: partial.calories ?? null,
    protein: partial.protein ?? null,
    fiber: partial.fiber ?? null,
    grams: partial.grams ?? null,
    is_favorite: partial.is_favorite ?? false,
    is_available: partial.is_available ?? true,
    oven_temp: partial.oven_temp ?? null,
    oven_minutes: partial.oven_minutes ?? null,
    description: partial.description ?? null,
    sort_order: partial.sort_order ?? 0,
    created_at: partial.created_at ?? "",
  };
}

describe("mealListSort — cycles", () => {
  it("cycle Master : Manuel → Calories → Protéines → Note → Satiété → Favoris → Ingrédients → Manuel", () => {
    expect(cycleMasterSortMode("manual")).toBe("calories");
    expect(cycleMasterSortMode("calories")).toBe("protein");
    expect(cycleMasterSortMode("protein")).toBe("note");
    expect(cycleMasterSortMode("note")).toBe("satiety");
    expect(cycleMasterSortMode("satiety")).toBe("favorites");
    expect(cycleMasterSortMode("favorites")).toBe("ingredients");
    expect(cycleMasterSortMode("ingredients")).toBe("manual");
  });

  it("cycle Available : Manuel → Calories → Protéines → Note → Satiété → Péremption → Manuel", () => {
    expect(cycleAvailableSortMode("manual")).toBe("calories");
    expect(cycleAvailableSortMode("calories")).toBe("protein");
    expect(cycleAvailableSortMode("protein")).toBe("note");
    expect(cycleAvailableSortMode("note")).toBe("satiety");
    expect(cycleAvailableSortMode("satiety")).toBe("expiration");
    expect(cycleAvailableSortMode("expiration")).toBe("manual");
  });
});

describe("mealListSort — compareNullableSortValues", () => {
  it("trie croissant / décroissant et pousse les nulls en fin", () => {
    expect(compareNullableSortValues(10, 20, true, "A", "B")).toBeLessThan(0);
    expect(compareNullableSortValues(10, 20, false, "A", "B")).toBeGreaterThan(0);
    expect(compareNullableSortValues(null, 20, true, "Z", "A")).toBeGreaterThan(0);
    expect(compareNullableSortValues(null, null, true, "Banane", "Avocat")).toBeGreaterThan(0);
  });

  it("départage par nom à égalité numérique", () => {
    expect(compareNullableSortValues(50, 50, true, "Banane", "Avocat")).toBeGreaterThan(0);
  });
});

describe("mealListSort — note / satiété repas", () => {
  it("trie par note nutritionnelle et place les notes manquantes en fin", () => {
    // Densité protéique élevée → note haute ; dessert hors catégories scorées → null
    const high = makeMeal({
      id: "1",
      name: "Poulet",
      category: "plat",
      calories: "200",
      protein: "40",
      fiber: "2",
    });
    const low = makeMeal({
      id: "2",
      name: "Huile",
      category: "plat",
      calories: "900",
      protein: "0",
      fiber: "0",
    });
    const missing = makeMeal({
      id: "3",
      name: "Gâteau",
      category: "dessert",
      calories: "400",
      protein: "5",
      fiber: "1",
    });

    expect(compareMealsByNutritionNote(high, low, false)).toBeLessThan(0);
    expect(compareMealsByNutritionNote(high, low, true)).toBeGreaterThan(0);
    expect(compareMealsByNutritionNote(missing, high, true)).toBeGreaterThan(0);
  });

  it("trie par satiété croissant / décroissant et place les manquants en fin", () => {
    const high = makeMeal({
      id: "1",
      name: "Steak",
      category: "plat",
      calories: "150",
      protein: "25",
      fiber: "0",
      grams: "100",
    });
    const low = makeMeal({
      id: "2",
      name: "Ravioli",
      category: "plat",
      calories: "83",
      protein: "3.6",
      fiber: "1.6",
      grams: "100",
    });
    const missing = makeMeal({
      id: "3",
      name: "Inconnu",
      category: "plat",
      calories: null,
      protein: null,
      fiber: null,
      grams: null,
    });

    expect(compareMealsBySatiety(low, high, true)).toBeLessThan(0);
    expect(compareMealsBySatiety(low, high, false)).toBeGreaterThan(0);
    expect(compareMealsBySatiety(missing, high, true)).toBeGreaterThan(0);
  });
});

describe("mealListSort — sortMealsByMasterMode", () => {
  it("trie par calories croissant / décroissant", () => {
    const meals = [
      makeMeal({ id: "1", name: "B", calories: "300" }),
      makeMeal({ id: "2", name: "A", calories: "100" }),
      makeMeal({ id: "3", name: "C", calories: "200" }),
    ];
    expect(sortMealsByMasterMode(meals, "calories", { ascending: true }).map((m) => m.id)).toEqual([
      "2",
      "3",
      "1",
    ]);
    expect(sortMealsByMasterMode(meals, "calories", { ascending: false }).map((m) => m.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
  });

  it("place les favoris en tête", () => {
    const meals = [
      makeMeal({ id: "1", name: "A", is_favorite: false }),
      makeMeal({ id: "2", name: "B", is_favorite: true }),
    ];
    expect(sortMealsByMasterMode(meals, "favorites").map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("laisse l’ordre inchangé en mode manuel", () => {
    const meals = [
      makeMeal({ id: "1", name: "A" }),
      makeMeal({ id: "2", name: "B" }),
    ];
    expect(sortMealsByMasterMode(meals, "manual")).toBe(meals);
  });
});
