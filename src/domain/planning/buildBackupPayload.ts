import type { PossibleMeal } from "@/hooks/useMeals";
import type { PossibleMealBackupCard, PossibleMealsFullBackup, PlanningPrefMap } from "./types";
import { asNumberRecord } from "./jsonCoerce";

export function serializePossibleMealsForBackup(freshPossible: PossibleMeal[]): PossibleMealBackupCard[] {
  return freshPossible.map(pm => ({
    id: pm.id,
    meal_id: pm.meal_id,
    quantity: pm.quantity,
    expiration_date: pm.expiration_date,
    day_of_week: pm.day_of_week,
    meal_time: pm.meal_time,
    counter_start_date: pm.counter_start_date,
    sort_order: pm.sort_order,
    ingredients_override: pm.ingredients_override,
  }));
}

export function buildFullBackupPayload(
  freshPossible: PossibleMeal[],
  prefMap: PlanningPrefMap
): PossibleMealsFullBackup {
  return {
    cards: serializePossibleMealsForBackup(freshPossible),
    manualCalories: asNumberRecord(prefMap["planning_manual_calories"]),
    manualProteins: asNumberRecord(prefMap["planning_manual_proteins"]),
    extraCalories: asNumberRecord(prefMap["planning_extra_calories"]),
    extraProteins: asNumberRecord(prefMap["planning_extra_proteins"]),
    extraSelections: (prefMap["planning_extra_selections"] as Record<string, string[]> | undefined) ?? {},
    breakfastManualCalories: asNumberRecord(prefMap["planning_breakfast_manual_calories"]),
    breakfastManualProteins: asNumberRecord(prefMap["planning_breakfast_manual_proteins"]),
    breakfastSelections: (prefMap["planning_breakfast"] as Record<string, string> | undefined) ?? {},
    drinkChecks: (prefMap["planning_drink_checks"] as Record<string, boolean> | undefined) ?? {},
    calOverrides: asNumberRecord(prefMap["planning_cal_overrides"]),
    daily_goal: (prefMap["planning_daily_goal"] as number | null | undefined) ?? null,
    protein_goal: (prefMap["planning_protein_goal"] as number | null | undefined) ?? null,
  };
}
