/**
 * useCalorieBalance — Hook de suivi de l'équilibre calorique, protéique et fibreux.
 *
 * Calcule les totaux journaliers (calories, protéines, fibres) à partir du planning
 * et des overrides manuels. Fournit le seuil calorique restant pour filtrer
 * les repas disponibles.
 *
 * Exports principaux :
 * - getTargetCalorieThreshold(iso?) : seuil « Au choix » —
 *   min > 0 → round(max) − round(conso) ; sinon lissage (reste − moy. écarts jours antérieurs).
 *   Semaine suivante → next_week_* + snapshots 💾
 * - getRemainingProtein(iso?) : protéines restantes = round(goal) − round(prot du jour)
 * - getDayProtein() : protéines consommées pour un jour donné
 * - getOverrideScaleRatio() : ratio d'échelle depuis un override de calories
 * - getCardDisplayCalories/Protein() : macros affichées pour une carte planning
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { useMeals, PLANNING_DAY_SLOTS, type PossibleMeal, type Meal } from '@/hooks/useMeals';
import { usePreferences } from '@/hooks/usePreferences';
import { type FoodItemMacroIndex } from '@/lib/ingredientUtils';
import { getDisplayedPMCalories, getDisplayedPMProtein, getDisplayedPMFiber, getDisplayedProtein, getDisplayedFiber, buildFoodItemIndex } from '@/lib/stockUtils';
import {
  DESSERT_FOOD_PREF_KEY,
} from "@/lib/foodDessertUtils";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import {
  aggregateExtraSelectionMacros,
  buildPlanningDessertCatalogById,
  mergeExtraDaySelectionIds,
  pickPlanningDayValue,
  pickPlanningSlotValue,
} from "@/lib/planningExtraMacros";
import {
  computePlanningDayTotalCalories,
  type PlanningDayCalorieState,
} from "@/domain/planning/planningDayCalories";
import { resolveAvailableCalorieThreshold } from "@/domain/planning/calorieGoalRange";
import { overlayDirectSnapshotsOntoNextWeekPrefs } from "@/domain/planning/overlayDirectSnapshotsOntoNextWeekPrefs";
import type { PlanningSnapshotEntry } from "@/domain/planning/types";
import {
  buildWeekDates,
  DAY_KEY_TO_INDEX,
  JS_DAY_TO_KEY,
  isIsoInNextPlanningWeek,
  resolvePlanningGoalForIso,
} from "@/lib/planningWeekUtils";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { parseCalories, parseProtein, parseFiber, parsePositiveMacroOverride } from "@/domain/planning/macroParsers";

const DEFAULT_DAILY_GOAL = 2750;

/** Convertit une surcharge manuelle en nombre utile, ou l'ignore si elle vaut 0/vide. */
function parsePositiveOverride(value: string | null | undefined): number | null {
  return parsePositiveMacroOverride(value);
}

/**
 * Détecte le ratio d'échelle entre les ingrédients/grammes de base d'un repas et son override.
 * Retourne null si aucun ratio significatif n'est détecté.
 */
export function getOverrideScaleRatio(
  meal: { ingredients: string | null; grams: string | null; name: string } | null | undefined,
  ingredientsOverride: string | null | undefined,
): number | null {
  if (!meal || !ingredientsOverride) return null;

  const baseIngStr = meal.ingredients
    ? meal.ingredients
    : (() => {
      const bg = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, "").replace(",", ".")) || 0;
      return bg > 0 ? `${bg}g ${meal.name}` : `1 ${meal.name}`;
    })();

  const origGroups = baseIngStr.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  const overGroups = ingredientsOverride.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  if (origGroups.length === 0) return null;

  const ratios: number[] = [];
  for (let i = 0; i < Math.min(origGroups.length, overGroups.length); i++) {
    const origAlt = origGroups[i].split(/\|/)[0].trim();
    const overAlt = overGroups[i].split(/\|/)[0].trim();
    if (origAlt.startsWith("?")) continue;

    const origMatch = origAlt.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grammes?|kg|ml|cl|l)\s/i);
    const overMatch = overAlt.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grammes?|kg|ml|cl|l)\s/i);
    if (origMatch && overMatch) {
      const oq = parseFloat(origMatch[1].replace(",", "."));
      const nq = parseFloat(overMatch[1].replace(",", "."));
      if (oq > 0 && nq > 0) { ratios.push(nq / oq); continue; }
    }

    const origC = origAlt.match(/^(\d+(?:[.,]\d+)?)\s+\S/);
    const overC = overAlt.match(/^(\d+(?:[.,]\d+)?)\s+\S/);
    if (origC && overC && !origMatch && !overMatch) {
      const oc = parseFloat(origC[1].replace(",", "."));
      const nc = parseFloat(overC[1].replace(",", "."));
      if (oc > 0 && nc > 0) { ratios.push(nc / oc); continue; }
    }

    ratios.push(1);
  }

  if (ratios.length === 0) return null;
  const first = ratios[0];
  if (Math.abs(first - 1) <= 0.01) return null;
  if (!ratios.every((r) => Math.abs(r - first) / first < 0.05)) return null;
  return first;
}

/**
 * Calcule les calories affichées pour une seule carte de planification.
 * C'est la source unique de vérité pour les totaux : ils additionnent la portion visible, pas le stock #quantity.
 */
export function getCardDisplayCalories(
  pm: PossibleMeal,
  calOverride?: string | null,
  isAvailable?: (name: string) => boolean,
): number {
  const meal = pm.meals;
  if (!meal) return 0;

  // 1. Surchage manuelle sur la carte de planification
  const override = parsePositiveOverride(calOverride);
  if (override !== null) return override;

  // 2. Utiliser la fonction d'affichage centralisée des macros (gère le total additif et l'échelle)
  const displayCal = getDisplayedPMCalories(pm, getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined, isAvailable);
  return displayCal || 0;
}

/**
 * Calcule les protéines affichées pour une seule carte de planification.
 * Passe `foodItems` + index pour aligner l’affichage avec les protéines dérivées des fiches aliments (sans [pro] sur les lignes).
 */
export function getCardDisplayProtein(
  pm: PossibleMeal,
  proOverride?: string | null,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number {
  const meal = pm.meals;
  if (!meal) return 0;

  const override = parsePositiveOverride(proOverride);
  if (override !== null) return override;

  // Utiliser la fonction d'affichage centralisée des macros (gère le total additif et l'échelle)
  const displayPro = getDisplayedPMProtein(
    pm,
    getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined,
    isAvailable,
    foodItems,
    foodItemIndex,
  );
  return displayPro || 0;
}

/**
 * Calcule les fibres affichées pour une seule carte de planification.
 * Suit les mêmes règles que les protéines : override manuel, ingrédients, puis valeur de base.
 */
export function getCardDisplayFiber(
  pm: PossibleMeal,
  fiberOverride?: string | null,
  isAvailable?: (name: string) => boolean,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number {
  const meal = pm.meals;
  if (!meal) return 0;

  const override = parsePositiveOverride(fiberOverride);
  if (override !== null) return override;

  const displayFiber = getDisplayedPMFiber(
    pm,
    getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined,
    isAvailable,
    foodItems,
    foodItemIndex,
  );
  return displayFiber || 0;
}

/**
 * Agrège les totaux journaliers du planning (calories, protéines, petit-déj, extras, boissons)
 * et expose les helpers pour comparer aux objectifs.
 */
export function useCalorieBalance(isAvailable?: (name: string) => boolean) {
  const { meals: allMeals, possibleMeals, getMealsByCategory } = useMeals();
  const { getPreference } = usePreferences();
  const { items: foodItems } = useFoodItems();
  const foodItemMacroIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);

  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});
  const extraSlotAssignments = getPreference<Record<string, string[]>>('planning_extra_slot_assignments', {});
  const dessertFoodItemIds = getPreference<string[]>(DESSERT_FOOD_PREF_KEY, []);
  const dessertExtraStockSnapshots = getPreference<Record<string, Record<string, FoodItem[][]>>>(
    'planning_dessert_extra_stock_snapshots',
    {},
  );
  const ingredientMacroLibrary = getPreference<IngredientMacroLibraryItem[]>("ingredient_macro_library", []);
  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const proOverrides = getPreference<Record<string, string>>('planning_pro_overrides', {});
  const fiberOverrides = getPreference<Record<string, string>>('planning_fiber_overrides', {});
  const DAILY_GOAL = getPreference<number>('planning_daily_goal', DEFAULT_DAILY_GOAL);
  // Borne basse optionnelle de la fourchette calorique (0 = fourchette désactivée). La borne haute (DAILY_GOAL) reste la cible des calculs.
  const DAILY_GOAL_LOW = getPreference<number>('planning_daily_goal_low', 0);
  const NEXT_DAILY_GOAL = getPreference<number>('next_week_daily_goal', DAILY_GOAL);
  // Borne basse semaine suivante (même rôle que DAILY_GOAL_LOW pour le seuil Au choix).
  const NEXT_DAILY_GOAL_LOW = getPreference<number>('next_week_daily_goal_low', DAILY_GOAL_LOW);
  const manualProteins = getPreference<Record<string, number>>('planning_manual_proteins', {});
  const extraProteins = getPreference<Record<string, number>>('planning_extra_proteins', {});
  const breakfastManualProteins = getPreference<Record<string, number>>('planning_breakfast_manual_proteins', {});
  const DAILY_PROTEIN_GOAL = getPreference<number>('planning_protein_goal', getPreference<number>('planning_daily_protein_goal', 110));
  const NEXT_PROTEIN_GOAL = getPreference<number>('next_week_protein_goal', DAILY_PROTEIN_GOAL);
  const manualFibers = getPreference<Record<string, number>>('planning_manual_fibers', {});
  const extraFibers = getPreference<Record<string, number>>('planning_extra_fibers', {});
  const breakfastManualFibers = getPreference<Record<string, number>>('planning_breakfast_manual_fibers', {});
  const DAILY_FIBER_GOAL = getPreference<number>('planning_fiber_goal', 30);

  // Prefs semaine suivante (même sources que PlanningNextWeekView).
  const nextBreakfastSelectionsRaw = getPreference<Record<string, string>>('next_week_breakfast', {});
  const nextManualCaloriesRaw = getPreference<Record<string, number>>('next_week_manual_calories', {});
  const nextManualProteinsRaw = getPreference<Record<string, number>>('next_week_manual_proteins', {});
  const nextManualFibersRaw = getPreference<Record<string, number>>('next_week_manual_fibers', {});
  const nextExtraCaloriesRaw = getPreference<Record<string, number>>('next_week_extra_calories', {});
  const nextExtraProteinsRaw = getPreference<Record<string, number>>('next_week_extra_proteins', {});
  const nextExtraFibersRaw = getPreference<Record<string, number>>('next_week_extra_fibers', {});
  const nextExtraSelectionsRaw = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
  const nextExtraSlotAssignments = getPreference<Record<string, string[]>>('next_week_extra_slot_assignments', {});
  const nextBreakfastManualCaloriesRaw = getPreference<Record<string, number>>('next_week_breakfast_manual_calories', {});
  const nextBreakfastManualProteinsRaw = getPreference<Record<string, number>>('next_week_breakfast_manual_proteins', {});
  const nextDrinkChecks = getPreference<Record<string, boolean>>('next_week_drink_checks', {});
  const savedSnapshots = getPreference<Record<string, PlanningSnapshotEntry>>('planning_saved_snapshots', {});

  // Snapshots 💾 directs en fallback — aligné badge PlanningNextWeekView (sinon seuil trop haut, ex. 820 vs 777).
  const nextWeekOverlay = useMemo(
    () =>
      overlayDirectSnapshotsOntoNextWeekPrefs(
        {
          breakfastSelections: nextBreakfastSelectionsRaw,
          breakfastManualCalories: nextBreakfastManualCaloriesRaw,
          breakfastManualProteins: nextBreakfastManualProteinsRaw,
          manualCalories: nextManualCaloriesRaw,
          manualProteins: nextManualProteinsRaw,
          manualFibers: nextManualFibersRaw,
          extraCalories: nextExtraCaloriesRaw,
          extraProteins: nextExtraProteinsRaw,
          extraFibers: nextExtraFibersRaw,
          extraSelections: nextExtraSelectionsRaw,
        },
        savedSnapshots,
        buildWeekDates(1),
      ),
    [
      nextBreakfastSelectionsRaw,
      nextBreakfastManualCaloriesRaw,
      nextBreakfastManualProteinsRaw,
      nextManualCaloriesRaw,
      nextManualProteinsRaw,
      nextManualFibersRaw,
      nextExtraCaloriesRaw,
      nextExtraProteinsRaw,
      nextExtraFibersRaw,
      nextExtraSelectionsRaw,
      savedSnapshots,
    ],
  );

  const nextBreakfastSelections = nextWeekOverlay.breakfastSelections;
  const nextManualCalories = nextWeekOverlay.manualCalories;
  const nextManualProteins = nextWeekOverlay.manualProteins;
  const nextManualFibers = nextWeekOverlay.manualFibers;
  const nextExtraCalories = nextWeekOverlay.extraCalories;
  const nextExtraProteins = nextWeekOverlay.extraProteins;
  const nextExtraFibers = nextWeekOverlay.extraFibers;
  const nextExtraSelections = nextWeekOverlay.extraSelections;
  const nextBreakfastManualCalories = nextWeekOverlay.breakfastManualCalories;
  const nextBreakfastManualProteins = nextWeekOverlay.breakfastManualProteins;

  const planningMeals = useMemo(() => possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    return !!pm.day_of_week && !!pm.meal_time;
  }), [possibleMeals]);

  const dessertCatalogById = useMemo(
    () =>
      buildPlanningDessertCatalogById(
        foodItems,
        dessertFoodItemIds,
        ingredientMacroLibrary,
        extraSelections,
        extraSlotAssignments,
        dessertExtraStockSnapshots,
      ),
    [
      dessertExtraStockSnapshots,
      dessertFoodItemIds,
      extraSelections,
      extraSlotAssignments,
      foodItems,
      ingredientMacroLibrary,
    ],
  );

  // Catalogue desserts semaine suivante (sélections / assignations `next_week_*`).
  const nextDessertCatalogById = useMemo(
    () =>
      buildPlanningDessertCatalogById(
        foodItems,
        dessertFoodItemIds,
        ingredientMacroLibrary,
        nextExtraSelections,
        nextExtraSlotAssignments,
        dessertExtraStockSnapshots,
      ),
    [
      dessertExtraStockSnapshots,
      dessertFoodItemIds,
      foodItems,
      ingredientMacroLibrary,
      nextExtraSelections,
      nextExtraSlotAssignments,
    ],
  );

  const planningDayCalorieState = useMemo(
    (): PlanningDayCalorieState => ({
      possibleMeals: planningMeals,
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
    }),
    [
      planningMeals,
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
    ],
  );

  const nextPlanningDayCalorieState = useMemo(
    (): PlanningDayCalorieState => ({
      possibleMeals: planningMeals,
      allMeals,
      petitDejMeals,
      foodItems,
      breakfastSelections: nextBreakfastSelections,
      manualCalories: nextManualCalories,
      extraCalories: nextExtraCalories,
      extraSelections: nextExtraSelections,
      extraSlotAssignments: nextExtraSlotAssignments,
      dessertFoodItemIds,
      dessertExtraStockSnapshots,
      ingredientMacroLibrary,
      breakfastManualCalories: nextBreakfastManualCalories,
      drinkChecks: nextDrinkChecks,
      calOverrides,
      isAvailable,
    }),
    [
      planningMeals,
      allMeals,
      petitDejMeals,
      foodItems,
      nextBreakfastSelections,
      nextManualCalories,
      nextExtraCalories,
      nextExtraSelections,
      nextExtraSlotAssignments,
      dessertFoodItemIds,
      dessertExtraStockSnapshots,
      ingredientMacroLibrary,
      nextBreakfastManualCalories,
      nextDrinkChecks,
      calOverrides,
      isAvailable,
    ],
  );

  /** Choisit l’état calorique (semaine courante vs suivante) selon la date ISO. */
  const resolveCalorieStateForIso = (isoDate?: string): PlanningDayCalorieState =>
    isoDate && isIsoInNextPlanningWeek(isoDate)
      ? nextPlanningDayCalorieState
      : planningDayCalorieState;

  /**
   * Calcule le total calorique d’un jour planning.
   * Pour une ISO de semaine suivante, utilise les prefs `next_week_*` (comme PlanningNextWeekView).
   */
  const getDayCalories = (dayKey: string, isoDate?: string): number =>
    computePlanningDayTotalCalories(resolveCalorieStateForIso(isoDate), dayKey, isoDate);

  const getMealsForSlot = (dayKey: string, time: string, isoDate?: string) =>
    planningMeals.filter((pm) =>
      (pm.day_of_week === dayKey || (isoDate && pm.day_of_week === isoDate)) &&
      pm.meal_time === time,
    );

  /**
   * Résout un ID de sélection de petit-déjeuner en un objet Meal,
   * en prenant la map breakfast de la semaine courante ou suivante selon l’ISO.
   */
  const getBreakfastForDay = (dayKey: string, isoDate?: string): Meal | null => {
    const bfMap =
      isoDate && isIsoInNextPlanningWeek(isoDate)
        ? nextBreakfastSelections
        : breakfastSelections;
    const selId = pickPlanningDayValue(bfMap, isoDate, dayKey);
    if (!selId) return null;

    if (selId.startsWith("pm:")) {
      const pmId = selId.slice(3);
      const pm = possibleMeals.find((p) => p.id === pmId);
      if (!pm?.meals) return null;
      const m = pm.meals;
      return { ...m, ingredients: pm.ingredients_override ?? m.ingredients } as Meal;
    }
    if (selId.startsWith("meal:")) {
      const mealId = selId.slice(5);
      return (
        petitDejMeals.find((m) => m.id === mealId) ||
        allMeals.find((m) => m.id === mealId && m.category === "petit_dejeuner") ||
        null
      );
    }

    return (
      petitDejMeals.find((m) => m.id === selId) ||
      allMeals.find((m) => m.id === selId && m.category === "petit_dejeuner") ||
      null
    );
  };

  /**
   * Agrège les protéines du jour (cartes, manuel, petit-déj, extras).
   * Branche sur les prefs semaine suivante quand l’ISO est en weekOffset 1.
   */
  const getDayProtein = (dayKey: string, isoDate?: string): number => {
    const useNext = !!(isoDate && isIsoInNextPlanningWeek(isoDate));
    const bfMap = useNext ? nextBreakfastSelections : breakfastSelections;
    const manualProMap = useNext ? nextManualProteins : manualProteins;
    const bfManualProMap = useNext ? nextBreakfastManualProteins : breakfastManualProteins;
    const extraProMap = useNext ? nextExtraProteins : extraProteins;
    const extraSelMap = useNext ? nextExtraSelections : extraSelections;
    const extraAssignMap = useNext ? nextExtraSlotAssignments : extraSlotAssignments;
    const dessertCatalog = useNext ? nextDessertCatalogById : dessertCatalogById;

    const slotTimes = [...PLANNING_DAY_SLOTS] as string[];
    const mealPro = slotTimes.reduce((total, time) => {
      const slotMeals = getMealsForSlot(dayKey, time, isoDate);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailable, foodItems, foodItemMacroIndex), 0);
      }
      return total + (pickPlanningSlotValue(manualProMap, isoDate, dayKey, time) ?? 0);
    }, 0);

    const breakfast = getBreakfastForDay(dayKey, isoDate);
    let breakfastPro = 0;
    if (breakfast) {
      const selId = pickPlanningDayValue(bfMap, isoDate, dayKey);
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        if (possiblePdj && (possiblePdj.day_of_week === dayKey || (isoDate && possiblePdj.day_of_week === isoDate)) && possiblePdj.meal_time === 'matin') {
          // Déjà compté dans mealPro via les calculs du créneau 'matin' !
          breakfastPro = 0;
        } else {
          breakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj, undefined, isAvailable, foodItems, foodItemMacroIndex) : parseProtein(breakfast.protein);
        }
      } else {
        // Utilise les protéines calculées à partir des ingrédients
        breakfastPro = getDisplayedProtein(breakfast, null, undefined, isAvailable, foodItems, foodItemMacroIndex) || 0;
      }
    } else {
      breakfastPro = pickPlanningDayValue(bfManualProMap, isoDate, dayKey) ?? 0;
    }

    const extraManual = pickPlanningDayValue(extraProMap, isoDate, dayKey) ?? 0;

    const dayIso = isoDate ?? "";
    const selectedExtraIds = mergeExtraDaySelectionIds(
      pickPlanningDayValue(extraSelMap, isoDate, dayKey) ?? [],
      extraAssignMap,
      dayIso,
      dayKey,
    );
    const extraSelected = aggregateExtraSelectionMacros(
      selectedExtraIds,
      foodItems,
      ingredientMacroLibrary,
      dessertCatalog,
      dessertExtraStockSnapshots,
    );

    return mealPro + breakfastPro + extraManual + extraSelected.pro;
  };

  /**
   * Agrège les fibres du jour (cartes, manuel, petit-déj, extras).
   * Branche sur les prefs semaine suivante quand l’ISO est en weekOffset 1.
   */
  const getDayFiber = (dayKey: string, isoDate?: string): number => {
    const useNext = !!(isoDate && isIsoInNextPlanningWeek(isoDate));
    const bfMap = useNext ? nextBreakfastSelections : breakfastSelections;
    const manualFiberMap = useNext ? nextManualFibers : manualFibers;
    const bfManualFiberMap = useNext ? {} : breakfastManualFibers;
    const extraFiberMap = useNext ? nextExtraFibers : extraFibers;
    const extraSelMap = useNext ? nextExtraSelections : extraSelections;
    const extraAssignMap = useNext ? nextExtraSlotAssignments : extraSlotAssignments;
    const dessertCatalog = useNext ? nextDessertCatalogById : dessertCatalogById;

    const slotTimes = [...PLANNING_DAY_SLOTS] as string[];
    const mealFiber = slotTimes.reduce((total, time) => {
      const slotMeals = getMealsForSlot(dayKey, time, isoDate);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) => s + getCardDisplayFiber(pm, fiberOverrides[pm.id], isAvailable, foodItems, foodItemMacroIndex), 0);
      }
      return total + (pickPlanningSlotValue(manualFiberMap, isoDate, dayKey, time) ?? 0);
    }, 0);

    const breakfast = getBreakfastForDay(dayKey, isoDate);
    let breakfastFiber = 0;
    if (breakfast) {
      const selId = pickPlanningDayValue(bfMap, isoDate, dayKey);
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        if (possiblePdj && (possiblePdj.day_of_week === dayKey || (isoDate && possiblePdj.day_of_week === isoDate)) && possiblePdj.meal_time === 'matin') {
          breakfastFiber = 0;
        } else {
          breakfastFiber = possiblePdj ? getCardDisplayFiber(possiblePdj, undefined, isAvailable, foodItems, foodItemMacroIndex) : parseFiber(breakfast.fiber);
        }
      } else {
        breakfastFiber = getDisplayedFiber(breakfast, null, undefined, isAvailable, foodItems, foodItemMacroIndex) || 0;
      }
    } else {
      breakfastFiber = pickPlanningDayValue(bfManualFiberMap, isoDate, dayKey) ?? 0;
    }

    const extraManual = pickPlanningDayValue(extraFiberMap, isoDate, dayKey) ?? 0;

    const dayIso = isoDate ?? "";
    const selectedExtraIds = mergeExtraDaySelectionIds(
      pickPlanningDayValue(extraSelMap, isoDate, dayKey) ?? [],
      extraAssignMap,
      dayIso,
      dayKey,
    );
    const extraSelected = aggregateExtraSelectionMacros(
      selectedExtraIds,
      foodItems,
      ingredientMacroLibrary,
      dessertCatalog,
      dessertExtraStockSnapshots,
    );

    return mealFiber + breakfastFiber + extraManual + extraSelected.fiber;
  };

  /**
   * Calcule le seuil calorique « Au choix » pour un jour (défaut : aujourd’hui).
   * Si calorie min > 0 (planning_daily_goal_low / next_week_daily_goal_low selon le jour) :
   * reste strict = max − conso (aligné badge Planning), sans lissage.
   * Sinon (min vide) : formule historique — reste jour − moyenne des écarts
   * (conso − max) des jours antérieurs de la même semaine (conso > 0).
   * La fourchette virtuelle max−100 n’active pas le mode strict.
   * Semaine suivante → goals + totaux `next_week_*`.
   */
  const getTargetCalorieThreshold = (targetIso?: string) => {
    // Midi local évite les décalages de fuseau sur les ISO `yyyy-MM-dd`.
    const targetDate = targetIso
      ? new Date(`${targetIso}T12:00:00`)
      : new Date();
    const targetKey = JS_DAY_TO_KEY[targetDate.getDay()];
    const resolvedIso = targetIso ?? format(targetDate, 'yyyy-MM-dd');
    const goalHigh = resolvePlanningGoalForIso(resolvedIso, DAILY_GOAL, NEXT_DAILY_GOAL);
    const goalLow = resolvePlanningGoalForIso(resolvedIso, DAILY_GOAL_LOW, NEXT_DAILY_GOAL_LOW);
    const dayConsumed = getDayCalories(targetKey, resolvedIso);

    // Jours antérieurs de la même semaine planning (courante ou suivante) pour le lissage.
    const weekOffset = isIsoInNextPlanningWeek(resolvedIso) ? 1 : 0;
    const weekDays = buildWeekDates(weekOffset);
    const dayIndex = DAY_KEY_TO_INDEX[targetKey] ?? 0;
    const pastDayCalories: number[] = [];
    for (let i = 0; i < dayIndex; i++) {
      const day = weekDays[i];
      if (!day) continue;
      pastDayCalories.push(getDayCalories(day.key, day.iso));
    }

    return resolveAvailableCalorieThreshold(goalHigh, dayConsumed, goalLow, pastDayCalories);
  };

  /**
   * Calcule les protéines restantes pour un jour (défaut : aujourd’hui).
   * Aligné sur le Planning : round(objectif) − round(prot du jour) (évite 53 au lieu de 52).
   */
  const getRemainingProtein = (targetIso?: string) => {
    const targetDate = targetIso
      ? new Date(`${targetIso}T12:00:00`)
      : new Date();
    const targetKey = JS_DAY_TO_KEY[targetDate.getDay()];
    const resolvedIso = targetIso ?? format(targetDate, 'yyyy-MM-dd');
    const proteinGoal = resolvePlanningGoalForIso(resolvedIso, DAILY_PROTEIN_GOAL, NEXT_PROTEIN_GOAL);
    const dayConsumed = getDayProtein(targetKey, resolvedIso);
    const goal =
      typeof proteinGoal === "number" && Number.isFinite(proteinGoal) ? proteinGoal : 0;
    const consumed =
      typeof dayConsumed === "number" && Number.isFinite(dayConsumed) ? dayConsumed : 0;
    return Math.max(0, Math.round(goal) - Math.round(consumed));
  };

  return { getDayCalories, getDayProtein, getDayFiber, DAILY_GOAL, DAILY_GOAL_LOW, DAILY_PROTEIN_GOAL, DAILY_FIBER_GOAL, getRecordSelectedExtraIds: (day: string) => (getPreference<Record<string, string[]>>('planning_extra_selections', {})[day] || []), getBreakfastForDay, getTargetCalorieThreshold, getRemainingProtein };
}
