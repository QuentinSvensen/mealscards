import { describe, expect, it } from "vitest";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import { computePlanningDayTotalCalories } from "./planningDayCalories";

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "meal-1",
    name: "Repas test",
    category: "plat",
    calories: "500",
    protein: "30",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Meal;
}

describe("planningDayCalories", () => {
  it("compte les saisies manuelles indexées par clé jour quand l'ISO est fourni", () => {
    const meal = makeMeal();
    const pm = {
      id: "pm-1",
      meal_id: meal.id,
      day_of_week: "2026-07-10",
      meal_time: "midi",
      meals: meal,
    } as PossibleMeal;

    const total = computePlanningDayTotalCalories(
      {
        possibleMeals: [pm],
        allMeals: [meal],
        petitDejMeals: [],
        foodItems: [],
        breakfastSelections: {},
        manualCalories: { "jeudi-soir": 650 },
        extraCalories: {},
        extraSelections: {},
        extraSlotAssignments: {},
        dessertFoodItemIds: [],
        dessertExtraStockSnapshots: {},
        ingredientMacroLibrary: [],
        breakfastManualCalories: {},
        drinkChecks: { "jeudi-midi": true },
        calOverrides: {},
      },
      "jeudi",
      "2026-07-10",
    );

    expect(total).toBe(500 + 650 + 150);
  });
});
