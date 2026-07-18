import type { PossibleMeal } from "@/hooks/useMeals";
import type { PossibleMealBackupCard, PossibleMealsFullBackup, PlanningPrefMap } from "./types";
import {
  asBoolRecord,
  asNumberRecord,
  asPlanningOverrideRecord,
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
    meal_name: pm.meals?.name ?? null,
    meal_category: pm.meals?.category ?? null,
    meal_calories: pm.meals?.calories ?? null,
    meal_protein: pm.meals?.protein ?? null,
    meal_grams: pm.meals?.grams ?? null,
    meal_ingredients: pm.meals?.ingredients ?? null,
    meal_oven_temp: pm.meals?.oven_temp ?? null,
    meal_oven_minutes: pm.meals?.oven_minutes ?? null,
    meal_description: pm.meals?.description ?? null,
  }));
}

/** Lit un objectif numérique positif depuis la map de préférences (sinon null). */
function readGoalNumber(prefMap: PlanningPrefMap, key: string): number | null {
  const raw = prefMap[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Construit l’objet complet de sauvegarde (cartes + saisies + objectifs) avant reset. */
export function buildFullBackupPayload(
  freshPossible: PossibleMeal[],
  prefMap: PlanningPrefMap,
  weekRange?: { startISO: string; endISO: string },
): PossibleMealsFullBackup {
  return {
    cards: serializePossibleMealsForBackup(freshPossible),
    manualCalories: asNumberRecord(prefMap["planning_manual_calories"]),
    manualProteins: asNumberRecord(prefMap["planning_manual_proteins"]),
    manualFibers: asNumberRecord(prefMap["planning_manual_fibers"]),
    extraCalories: asNumberRecord(prefMap["planning_extra_calories"]),
    extraProteins: asNumberRecord(prefMap["planning_extra_proteins"]),
    extraFibers: asNumberRecord(prefMap["planning_extra_fibers"]),
    extraSelections: asStringArrayRecord(prefMap["planning_extra_selections"]),
    extraSlotAssignments: asStringArrayRecord(prefMap["planning_extra_slot_assignments"]),
    breakfastManualCalories: asNumberRecord(prefMap["planning_breakfast_manual_calories"]),
    breakfastManualProteins: asNumberRecord(prefMap["planning_breakfast_manual_proteins"]),
    breakfastSelections: asStringRecord(prefMap["planning_breakfast"]),
    drinkChecks: asBoolRecord(prefMap["planning_drink_checks"]),
    calOverrides: asPlanningOverrideRecord(prefMap["planning_cal_overrides"]),
    proOverrides: asPlanningOverrideRecord(prefMap["planning_pro_overrides"]),
    daily_goal: readGoalNumber(prefMap, "planning_daily_goal"),
    protein_goal: readGoalNumber(prefMap, "planning_protein_goal"),
    daily_goal_low: readGoalNumber(prefMap, "planning_daily_goal_low"),
    fiber_goal: readGoalNumber(prefMap, "planning_fiber_goal"),
    weekStartISO: weekRange?.startISO ?? null,
    weekEndISO: weekRange?.endISO ?? null,
  };
}
