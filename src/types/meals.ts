/**
 * Types domaine des repas et repas possibles.
 * Source unique pour éviter d’importer des types depuis les hooks React.
 */

export type MealCategory = "petit_dejeuner" | "entree" | "plat" | "dessert" | "bonus";

/** Créneaux midi / goûter / soir (alignés sur TIMES dans useMeals). */
export type PlanningMealTime = "midi" | "gouter" | "soir";

/** Tous les créneaux d’une journée incluant le matin (alignés sur PLANNING_DAY_SLOTS). */
export type PlanningDaySlot = "matin" | "midi" | "gouter" | "soir";

export interface Meal {
  id: string;
  name: string;
  category: string;
  calories: string | null;
  protein: string | null;
  fiber: string | null;
  grams: string | null;
  ingredients: string | null;
  sort_order: number;
  created_at: string;
  is_available: boolean;
  is_favorite: boolean;
  oven_temp: string | null;
  oven_minutes: string | null;
  /** Consignes de préparation (visibles dans la pop-up double-clic). */
  description?: string | null;
}

export interface PossibleMeal {
  id: string;
  meal_id: string;
  quantity: number;
  expiration_date: string | null;
  day_of_week: string | null;
  meal_time: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  meals: Meal;
  ingredients_override: string | null;
}
