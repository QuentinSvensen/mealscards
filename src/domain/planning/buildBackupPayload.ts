import type { PossibleMeal } from "@/hooks/useMeals";
import type { PossibleMealBackupCard, PossibleMealsFullBackup, PlanningPrefMap } from "./types";
import {
  asBoolRecord,
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

/** Sérialise les repas possibles pour la clé `possible_meals_backup` (sans jointure `meals`). */
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

/** Construit l’objet complet de sauvegarde (cartes + saisies + objectifs) avant reset. */
export function buildFullBackupPayload(
  freshPossible: PossibleMeal[],
  prefMap: PlanningPrefMap
): PossibleMealsFullBackup {
  const dg = prefMap["planning_daily_goal"];
  const pg = prefMap["planning_protein_goal"];
  return {
    cards: serializePossibleMealsForBackup(freshPossible),
    manualCalories: asNumberRecord(prefMap["planning_manual_calories"]),
    manualProteins: asNumberRecord(prefMap["planning_manual_proteins"]),
    extraCalories: asNumberRecord(prefMap["planning_extra_calories"]),
    extraProteins: asNumberRecord(prefMap["planning_extra_proteins"]),
    extraSelections: asStringArrayRecord(prefMap["planning_extra_selections"]),
    breakfastManualCalories: asNumberRecord(prefMap["planning_breakfast_manual_calories"]),
    breakfastManualProteins: asNumberRecord(prefMap["planning_breakfast_manual_proteins"]),
    breakfastSelections: asStringRecord(prefMap["planning_breakfast"]),
    drinkChecks: asBoolRecord(prefMap["planning_drink_checks"]),
    calOverrides: asNumberRecord(prefMap["planning_cal_overrides"]),
    daily_goal: typeof dg === "number" ? dg : null,
    protein_goal: typeof pg === "number" ? pg : null,
  };
}
