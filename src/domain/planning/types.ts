import type { Json } from "@/integrations/supabase/types";

/** Une entrée dans planning_saved_snapshots (clé = manual-… / extra-… / breakfast-…). */
export interface PlanningSnapshotEntry {
  cal?: number;
  prot?: number;
  fiber?: number;
  savedAt?: number;
  itemIds?: string[];
  mealId?: string;
  name?: string;
}

/** Carte sérialisée dans possible_meals_backup (sans jointure meals). */
export interface PossibleMealBackupCard {
  id: string;
  meal_id: string;
  quantity: number;
  expiration_date: string | null;
  day_of_week: string | null;
  meal_time: string | null;
  counter_start_date: string | null;
  sort_order: number;
  ingredients_override: string | null;
  meal_name?: string | null;
  meal_category?: string | null;
  meal_calories?: string | null;
  meal_protein?: string | null;
  meal_grams?: string | null;
  meal_ingredients?: string | null;
  meal_oven_temp?: string | null;
  meal_oven_minutes?: string | null;
}

/**
 * Objet stocké dans user_preferences.possible_meals_backup (value JSON).
 * Aligné sur la lecture dans WeeklyPlanning (vue semaine précédente).
 */
export interface PossibleMealsFullBackup {
  cards: PossibleMealBackupCard[];
  manualCalories: Record<string, number>;
  manualProteins: Record<string, number>;
  manualFibers: Record<string, number>;
  extraCalories: Record<string, number>;
  extraProteins: Record<string, number>;
  extraFibers: Record<string, number>;
  extraSelections: Record<string, string[]>;
  extraSlotAssignments: Record<string, string[]>;
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  breakfastSelections: Record<string, string>;
  drinkChecks: Record<string, boolean>;
  calOverrides: Record<string, number>;
  proOverrides: Record<string, number>;
  daily_goal: number | null;
  protein_goal: number | null;
}

/** Clés de préférences lues avant un reset (saisie planning + objectifs). */
export const PLANNING_RESET_PREF_KEYS = [
  "planning_manual_calories",
  "planning_manual_proteins",
  "planning_manual_fibers",
  "planning_extra_calories",
  "planning_extra_proteins",
  "planning_extra_fibers",
  "planning_breakfast_manual_calories",
  "planning_breakfast_manual_proteins",
  "planning_breakfast",
  "planning_drink_checks",
  "planning_cal_overrides",
  "planning_pro_overrides",
  "planning_extra_selections",
  "planning_extra_slot_assignments",
  "planning_daily_goal",
  "next_week_daily_goal",
  "planning_protein_goal",
  "next_week_protein_goal",
] as const;

/** Brouillon semaine suivante : chargé en base avant le reset auto pour promotion vers le planning courant. */
export const NEXT_WEEK_PROMOTION_PREF_KEYS = [
  "next_week_manual_calories",
  "next_week_manual_proteins",
  "next_week_manual_fibers",
  "next_week_extra_calories",
  "next_week_extra_proteins",
  "next_week_extra_fibers",
  "next_week_extra_selections",
  "next_week_breakfast",
  "next_week_breakfast_manual_calories",
  "next_week_breakfast_manual_proteins",
  "next_week_drink_checks",
] as const;

export type PlanningResetPrefKey = (typeof PLANNING_RESET_PREF_KEYS)[number];

/** Map clé → valeur JSON (lignes user_preferences). */
export type PlanningPrefMap = Record<string, Json | undefined>;

export interface MergedPlanningLiveState {
  planning_manual_calories: Record<string, number>;
  planning_manual_proteins: Record<string, number>;
  planning_manual_fibers: Record<string, number>;
  planning_extra_calories: Record<string, number>;
  planning_extra_proteins: Record<string, number>;
  planning_extra_fibers: Record<string, number>;
  planning_extra_selections: Record<string, string[]>;
  planning_breakfast_manual_calories: Record<string, number>;
  planning_breakfast_manual_proteins: Record<string, number>;
  planning_breakfast: Record<string, string>;
  planning_drink_checks: Record<string, boolean>;
}

export interface PostResetGoalValues {
  planning_daily_goal?: number;
  next_week_daily_goal?: number;
  planning_protein_goal?: number;
  next_week_protein_goal?: number;
}
