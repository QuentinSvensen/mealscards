import { describe, expect, it } from "vitest";
import type { Meal, PossibleMeal } from "@/types/meals";
import { resolveAvailableCalorieThreshold } from "./calorieGoalRange";
import { overlayDirectSnapshotsOntoNextWeekPrefs } from "./overlayDirectSnapshotsOntoNextWeekPrefs";
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

  it("seuil Au choix semaine pro : snapshot extras + round(max) − round(conso) = 777", () => {
    const meal = makeMeal({ calories: "1380" });
    const pm = {
      id: "pm-lunch",
      meal_id: meal.id,
      day_of_week: "2026-07-20",
      meal_time: "midi",
      meals: meal,
    } as PossibleMeal;

    const overlaid = overlayDirectSnapshotsOntoNextWeekPrefs(
      {
        breakfastSelections: {},
        breakfastManualCalories: {},
        breakfastManualProteins: {},
        manualCalories: {},
        manualProteins: {},
        manualFibers: {},
        extraCalories: {},
        extraProteins: {},
        extraFibers: {},
        extraSelections: {},
      },
      { "extra-2026-07-20": { cal: 43, prot: 1 } },
      [{ key: "lundi", iso: "2026-07-20", display: "" }],
    );

    const dayTotal = computePlanningDayTotalCalories(
      {
        possibleMeals: [pm],
        allMeals: [meal],
        petitDejMeals: [],
        foodItems: [],
        breakfastSelections: overlaid.breakfastSelections,
        manualCalories: overlaid.manualCalories,
        extraCalories: overlaid.extraCalories,
        extraSelections: overlaid.extraSelections,
        extraSlotAssignments: {},
        dessertFoodItemIds: [],
        dessertExtraStockSnapshots: {},
        ingredientMacroLibrary: [],
        breakfastManualCalories: overlaid.breakfastManualCalories,
        drinkChecks: {},
        calOverrides: {},
      },
      "lundi",
      "2026-07-20",
    );

    expect(dayTotal).toBe(1423);
    // Sans snapshot → 1380 → seuil 820 (bug confirmé) ; avec snapshot → 777
    expect(resolveAvailableCalorieThreshold(2200, 1380, 2000)).toBe(820);
    expect(resolveAvailableCalorieThreshold(2200, dayTotal, 2000)).toBe(777);
  });
});
