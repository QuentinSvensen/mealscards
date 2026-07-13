import { TIMES, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import {
  getDisplayedCalories,
  getDisplayedPMCalories,
} from "@/lib/stockUtils";
import { getOverrideScaleRatio } from "@/hooks/useCalorieBalance";
import {
  aggregateExtraSelectionMacros,
  buildPlanningDessertCatalogById,
  mergeExtraDaySelectionIds,
  pickPlanningDayValue,
  pickPlanningSlotValue,
} from "@/lib/planningExtraMacros";
import type { BackupCalorieDayContext } from "./rollingCalorieAverage";
import type { PossibleMealBackupCard, PlanningPrefMap } from "./types";
import {
  asBoolRecord,
  asNumberRecord,
  asPlanningOverrideRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";
import { DESSERT_FOOD_PREF_KEY } from "@/lib/foodDessertUtils";

const DRINK_CALORIES = 150;

/** État planning nécessaire pour recalculer les totaux journaliers comme en live. */
export interface PlanningDayCalorieState {
  possibleMeals: PossibleMeal[];
  allMeals: Meal[];
  petitDejMeals: Meal[];
  foodItems: FoodItem[];
  breakfastSelections: Record<string, string>;
  manualCalories: Record<string, number>;
  extraCalories: Record<string, number>;
  extraSelections: Record<string, string[]>;
  extraSlotAssignments: Record<string, string[]>;
  dessertFoodItemIds: string[];
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>;
  ingredientMacroLibrary: IngredientMacroLibraryItem[];
  breakfastManualCalories: Record<string, number>;
  drinkChecks: Record<string, boolean>;
  calOverrides: Record<string, string>;
  isAvailable?: (name: string) => boolean;
}

/** Extrait un nombre de kcal depuis une chaîne potentiellement bruitée. */
function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Convertit une surcharge manuelle en nombre utile, ou l'ignore si elle vaut 0/vide. */
function parsePositiveOverride(value: string | null | undefined): number | null {
  const parsed = parseCalories(value);
  return parsed > 0 ? parsed : null;
}

/** Calories affichées d'une carte planning (même logique que le hook live). */
function cardDisplayCalories(
  pm: PossibleMeal,
  calOverride?: string | null,
  isAvailable?: (name: string) => boolean,
): number {
  const meal = pm.meals;
  if (!meal) return 0;
  const override = parsePositiveOverride(calOverride);
  if (override !== null) return override;
  const displayCal = getDisplayedPMCalories(
    pm,
    getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined,
    isAvailable,
  );
  return displayCal || 0;
}

/**
 * Calcule le total calorique d'un jour avec la même logique que le planning live
 * (repas, petit-déj, extras, boissons).
 */
export function computePlanningDayTotalCalories(
  state: PlanningDayCalorieState,
  dayKey: string,
  isoDate?: string,
): number {
  const {
    possibleMeals,
    allMeals,
    petitDejMeals,
    foodItems,
    breakfastSelections,
    manualCalories,
    extraCalories,
    extraSelections,
    extraSlotAssignments,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    breakfastManualCalories,
    drinkChecks,
    calOverrides,
    isAvailable,
  } = state;

  const planningMeals = possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    return !!pm.day_of_week && !!pm.meal_time;
  });

  const dessertCatalogById = buildPlanningDessertCatalogById(
    foodItems,
    dessertFoodItemIds,
    ingredientMacroLibrary,
    extraSelections,
    extraSlotAssignments,
    dessertExtraStockSnapshots,
  );

  const getMealsForSlot = (time: string) =>
    planningMeals.filter(
      (pm) =>
        (pm.day_of_week === dayKey || (isoDate && pm.day_of_week === isoDate)) &&
        pm.meal_time === time,
    );

  const slotTimes = ["matin", ...TIMES, "gouter"] as string[];
  const mealCals = slotTimes.reduce((total, time) => {
    const slotMeals = getMealsForSlot(time);
    if (slotMeals.length > 0) {
      return (
        total +
        slotMeals.reduce(
          (s, pm) => s + cardDisplayCalories(pm, calOverrides[pm.id], isAvailable),
          0,
        )
      );
    }
    return total + (pickPlanningSlotValue(manualCalories, isoDate, dayKey, time) ?? 0);
  }, 0);

  const selId = pickPlanningDayValue(breakfastSelections, isoDate, dayKey);
  let breakfastCal = 0;
  if (selId?.startsWith("pm:")) {
    const pmId = selId.slice(3);
    const possiblePdj = possibleMeals.find((pm) => pm.id === pmId);
    if (
      possiblePdj &&
      (possiblePdj.day_of_week === dayKey || (isoDate && possiblePdj.day_of_week === isoDate)) &&
      possiblePdj.meal_time === "matin"
    ) {
      breakfastCal = 0;
    } else {
      breakfastCal = possiblePdj
        ? cardDisplayCalories(possiblePdj, undefined, isAvailable)
        : 0;
    }
  } else if (selId?.startsWith("meal:")) {
    const mealId = selId.slice(5);
    const breakfast =
      petitDejMeals.find((m) => m.id === mealId) ||
      allMeals.find((m) => m.id === mealId && m.category === "petit_dejeuner") ||
      null;
    breakfastCal = breakfast ? getDisplayedCalories(breakfast, null, undefined, isAvailable) || 0 : 0;
  } else if (selId) {
    const breakfast =
      petitDejMeals.find((m) => m.id === selId) ||
      allMeals.find((m) => m.id === selId && m.category === "petit_dejeuner") ||
      null;
    breakfastCal = breakfast ? getDisplayedCalories(breakfast, null, undefined, isAvailable) || 0 : 0;
  } else {
    breakfastCal = pickPlanningDayValue(breakfastManualCalories, isoDate, dayKey) ?? 0;
  }

  const extraManual = pickPlanningDayValue(extraCalories, isoDate, dayKey) ?? 0;
  const selectedExtraIds = mergeExtraDaySelectionIds(
    pickPlanningDayValue(extraSelections, isoDate, dayKey) ?? [],
    extraSlotAssignments,
    isoDate ?? "",
    dayKey,
  );
  const extraSelected = aggregateExtraSelectionMacros(
    selectedExtraIds,
    foodItems,
    ingredientMacroLibrary,
    dessertCatalogById,
    dessertExtraStockSnapshots,
  );

  const drinkCal = [...TIMES, "gouter"].reduce((sum, time) => {
    return sum + (pickPlanningSlotValue(drinkChecks, isoDate, dayKey, time) ? DRINK_CALORIES : 0);
  }, 0);

  return mealCals + breakfastCal + extraManual + extraSelected.cal + drinkCal;
}

/** Reconstruit une carte possible depuis une entrée de sauvegarde. */
function backupCardToPossibleMeal(card: PossibleMealBackupCard, mealsById: Map<string, Meal>): PossibleMeal | null {
  const meal = mealsById.get(card.meal_id);
  if (!meal) return null;
  return {
    id: card.id,
    meal_id: card.meal_id,
    quantity: card.quantity,
    expiration_date: card.expiration_date,
    day_of_week: card.day_of_week,
    meal_time: card.meal_time,
    counter_start_date: card.counter_start_date,
    sort_order: card.sort_order,
    ingredients_override: card.ingredients_override,
    meals: meal,
  } as PossibleMeal;
}

/**
 * Recalcule les totaux journaliers d'une semaine archivée
 * avec la logique live (identique à l'affichage avant reset).
 */
export function computeLiveStyleBackupWeekDayTotals(
  ctx: BackupCalorieDayContext,
  weekDates: Array<{ iso: string; key: string }>,
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
  ingredientMacroLibrary: IngredientMacroLibraryItem[],
  isAvailable?: (name: string) => boolean,
): Record<string, number> {
  const possibleMeals = ctx.cards
    .map((card) => backupCardToPossibleMeal(card, mealsById))
    .filter((pm): pm is PossibleMeal => pm != null);
  const allMeals = [...mealsById.values()];
  const petitDejMeals = allMeals.filter((m) => m.category === "petit_dejeuner");

  const state: PlanningDayCalorieState = {
    possibleMeals,
    allMeals,
    petitDejMeals,
    foodItems,
    breakfastSelections: ctx.breakfastSelections,
    manualCalories: ctx.manualCalories,
    extraCalories: ctx.extraCalories,
    extraSelections: ctx.extraSelections,
    extraSlotAssignments: ctx.extraSlotAssignments,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    breakfastManualCalories: ctx.breakfastManualCalories,
    drinkChecks: ctx.drinkChecks,
    calOverrides: ctx.calOverrides,
    isAvailable,
  };

  const totals: Record<string, number> = {};
  for (const { iso, key } of weekDates) {
    const cal = computePlanningDayTotalCalories(state, key, iso);
    if (cal > 0) totals[iso] = cal;
  }
  return totals;
}

/**
 * Capture les totaux live affichés pour chaque jour d'une semaine
 * (à appeler avant reset hebdomadaire).
 */
export function buildLiveWeekDayTotalsForHistory(
  weekDates: Array<{ iso: string; key: string }>,
  getLiveDayCalories: (dayKey: string, isoDate?: string) => number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const { iso, key } of weekDates) {
    const cal = getLiveDayCalories(key, iso);
    if (cal > 0) totals[iso] = cal;
  }
  return totals;
}

/**
 * Construit l'état calorie planning à partir des préférences persistées
 * (utilisé au reset automatique du dimanche).
 */
export function buildPlanningDayCalorieStateFromPrefMap(
  prefMap: PlanningPrefMap,
  possibleMeals: PossibleMeal[],
  meals: Meal[],
  foodItems: FoodItem[],
): PlanningDayCalorieState {
  const dessertSnapshots = prefMap.planning_dessert_extra_stock_snapshots;
  return {
    possibleMeals,
    allMeals: meals,
    petitDejMeals: meals.filter((m) => m.category === "petit_dejeuner"),
    foodItems,
    breakfastSelections: asStringRecord(prefMap.planning_breakfast),
    manualCalories: asNumberRecord(prefMap.planning_manual_calories),
    extraCalories: asNumberRecord(prefMap.planning_extra_calories),
    extraSelections: asStringArrayRecord(prefMap.planning_extra_selections),
    extraSlotAssignments: asStringArrayRecord(prefMap.planning_extra_slot_assignments),
    dessertFoodItemIds: Array.isArray(prefMap[DESSERT_FOOD_PREF_KEY])
      ? (prefMap[DESSERT_FOOD_PREF_KEY] as string[])
      : [],
    dessertExtraStockSnapshots:
      dessertSnapshots && typeof dessertSnapshots === "object"
        ? (dessertSnapshots as Record<string, Record<string, FoodItem[][]>>)
        : {},
    ingredientMacroLibrary: Array.isArray(prefMap.ingredient_macro_library)
      ? (prefMap.ingredient_macro_library as IngredientMacroLibraryItem[])
      : [],
    breakfastManualCalories: asNumberRecord(prefMap.planning_breakfast_manual_calories),
    drinkChecks: asBoolRecord(prefMap.planning_drink_checks),
    calOverrides: asPlanningOverrideRecord(prefMap.planning_cal_overrides),
  };
}

/**
 * Calcule les totaux live de la semaine archivée depuis les préférences
 * avant bascule (reset auto dimanche).
 */
export function captureLiveWeekTotalsFromPrefMap(
  prefMap: PlanningPrefMap,
  possibleMeals: PossibleMeal[],
  meals: Meal[],
  foodItems: FoodItem[],
  weekDates: Array<{ iso: string; key: string }>,
): Record<string, number> {
  const state = buildPlanningDayCalorieStateFromPrefMap(prefMap, possibleMeals, meals, foodItems);
  const totals: Record<string, number> = {};
  for (const { iso, key } of weekDates) {
    const cal = computePlanningDayTotalCalories(state, key, iso);
    if (cal > 0) totals[iso] = cal;
  }
  return totals;
}
