/**
 * WeeklyPlanning — Planning hebdomadaire interactif.
 *
 * Affiche un tableau Jour × Créneau (Midi/Soir) avec les repas planifiés.
 * Chaque cellule contient des mini-cartes draggables avec :
 * - Nom, catégorie (emoji), calories, protéines, compteur, grammage
 * - Dates de péremption, ingrédients avec highlighting périmés/bientôt
 *
 * Fonctionnalités :
 * - Drag & drop entre cellules (desktop + touch mobile avec long press)
 * - Totaux caloriques et protéiques par jour avec objectifs configurables
 * - Section "Boissons" par jour (optionnelle, avec calories fixes)
 * - Reset hebdomadaire des valeurs (inputs, boissons, overrides)
 * - Semaine suivante : aperçu des repas "sauvegardés" (persistants après reset)
 * - Popup de détails au double-clic sur une carte
 * - Boutons de verrouillage/sauvegarde par carte dans le planning
 *
 * PlanningInput : champ numérique avec mode "+" pour ajouter à la valeur courante
 * PlanningMiniCard : carte compacte de repas dans le planning
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMeals, DAYS, TIMES, MAIN_GRID_TIMES, type PossibleMeal, type Meal } from "@/hooks/useMeals";
import { UnplannedDropZone } from "@/components/planning/UnplannedDropZone";
import { PlanningDayColumn } from "@/components/planning/PlanningDayColumn";
import { PlanningDayGoalsBar } from "@/components/planning/PlanningDayGoalsBar";
import { PlanningSlotSection } from "@/components/planning/PlanningSlotSection";
import { PlanningGouterBand } from "@/components/planning/PlanningGouterBand";
import { PlanningExtraColumn } from "@/components/planning/PlanningExtraColumn";
import { PlanningBreakfastBlock } from "@/components/planning/PlanningBreakfastBlock";
import { PlanningWeekTotalsFooter } from "@/components/planning/PlanningWeekTotalsFooter";
import { PlanningBackupWeekView } from "@/components/planning/PlanningBackupWeekView";
import { PlanningNextWeekView } from "@/components/planning/PlanningNextWeekView";
import {
  DRINK_CALORIES,
  TIME_LABELS,
} from "@/components/planning/planningSlotStyles";
import { usePlanningTouchDrag } from "@/hooks/usePlanningTouchDrag";
import { formatPlanningSnapshotTitle } from "@/domain/planning/formatPlanningSnapshotTitle";
import {
  EXTRA_DAY_SLOTS,
  assignExtraToDaySlotMap,
  isExtraDaySlot,
  moveExtraBetweenDaysToSlotMaps,
  removeExtraFromDaySlotMap,
  removeOneExtraOccurrenceForDay,
  unassignExtraFromAllDaySlotsMap,
  type ExtraDaySlot,
} from "@/domain/planning/extraSlotOps";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/hooks/usePreferences";
import { useCalorieBalance, getOverrideScaleRatio, getCardDisplayProtein, getCardDisplayCalories, getCardDisplayFiber } from "@/hooks/useCalorieBalance";
import { Timer, Flame, Weight, Thermometer, Wheat, FileText } from "lucide-react";
import { normalizeKey, getMealColor, parseIngredientGroups, formatNumeric, ingredientsForPossibleCardDisplay } from "@/lib/ingredientUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO, differenceInCalendarDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { useSortModes } from "@/hooks/useSortModes";
import { FOOD_EXTRAS_DIVIDER_PREF_KEY } from "@/lib/extrasDividerUtils";
import { analyzeMealIngredients, buildStockMap, buildFoodItemIndex, findStockKey, type StockInfo, getDisplayedCalories as getMealCal, getDisplayedProtein as getMealPro, getDisplayedFiber as getMealFiber, getDisplayedPMCalories, getDisplayedPMProtein, computePossibleFrozenCounterDays, mergeFrozenPossibleCounterDays, formatFrozenPossibleCounterTooltip, readFrozenPossibleCounterDays, POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, type PossibleFrozenCounterDaysMap, getMealMultiple, strictNameMatch } from "@/lib/stockUtils";
import { useMealTransfers } from "@/hooks/useMealTransfers";
import { toast } from "@/hooks/use-toast";
import {
  ensurePreviousWeekCalorieHistory,
  PLANNING_DAILY_CALORIE_HISTORY_KEY,
  resolveBackupWeekRange,
} from "@/domain/planning/dailyCalorieHistory";
import { asNumberRecord } from "@/domain/planning/jsonCoerce";
import type { PossibleMealsFullBackup } from "@/domain/planning/types";
import { mergeBackupCardOverrides } from "@/domain/planning/mergeBackupOverrides";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import { getRemainingDayCalories } from "@/domain/planning/calorieGoalRange";
import type { PlanningSnapshotEntry } from "@/domain/planning/types";
import { clearWeekdayScopedSnapshots } from "@/domain/planning/weekdaySnapshotUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";
import {
  buildFoodDessertExtras,
  buildFoodDessertExtraId,
  DESSERT_FOOD_PREF_KEY,
  deduplicateDessertExtraCatalog,
  findSnapshotFoodItemForDessertExtra,
  parseFoodDessertExtraId,
  resolveFoodDessertPortionMacros,
  resolveSingleIngredientMealDessertMacros,
  stripDessertCatalogDuplicatesForSelections,
  supplementFoodDessertExtrasFromSnapshots,
} from "@/lib/foodDessertUtils";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { buildWeekDates, getDateForDayKey, DAY_KEY_TO_INDEX } from "@/lib/planningWeekUtils";
import {
  computeRollingDayCalorieAverage,
  ROLLING_WINDOW_14_DAYS,
  ROLLING_WINDOW_7_DAYS,
  parseBackupCalorieContext,
} from "@/domain/planning/rollingCalorieAverage";
import {
  aggregateExtraSelectionMacros,
  getAssignedExtraIdsForDay,
  pickPlanningSlotValue,
} from "@/lib/planningExtraMacros";
import { usePlanningWeek } from "@/hooks/usePlanningWeek";
import { usePlanningResetRestore } from "@/hooks/usePlanningResetRestore";
import { useSyncPlanningQueriesOnResume } from "@/hooks/useSyncPlanningQueriesOnResume";
import { PlanningHeader } from "@/components/planning/PlanningHeader";
import {
  buildLiveBreakfastBreakdownItems,
  isBackupBreakfastPmAlreadyInMatinSlot,
} from "@/domain/planning/breakfastBreakdown";
import { PlanningMiniCard, getCategoryEmoji } from "@/components/planning/PlanningMiniCard";
import {
  buildDessertExtraId,
  resolveDessertCatalogId,
  findStoredSelectionIdForDessert,
} from "@/domain/planning/extraDisplay";

const DAY_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

const DEFAULT_DAILY_GOAL = 2750;
const DEFAULT_WEEKLY_MULTIPLIER = 7;

/** Clé de préférence utilisée pour mémoriser une surcharge calorique par carte (hors usage direct actuel). */
function calOverrideKey(pmId: string) { return `planning_cal_override_${pmId}`; }

/**
 * Résout la date ISO (yyyy-MM-dd) du créneau planifié.
 * `day_of_week` peut être une clé (« samedi ») ou déjà une date ISO — les deux formats coexistent en base.
 */
function resolvePlannedDayIso(
  dayOfWeek: string | null | undefined,
  weekDates: { key: string; iso: string }[],
): string | null {
  if (!dayOfWeek) return null;
  const fromWeek = weekDates.find((d) => d.key === dayOfWeek || d.iso === dayOfWeek);
  if (fromWeek) return fromWeek.iso;
  if (/^\d{4}-\d{2}-\d{2}/.test(dayOfWeek)) return dayOfWeek.slice(0, 10);
  return null;
}

/**
 * Indique si la carte doit s’afficher en rouge dans le Planning :
 * jour de planification strictement après la date de péremption.
 */
function isExpiredOnPlannedDay(
  expirationDate: string | null | undefined,
  plannedDayIso: string | null | undefined,
): boolean {
  if (!expirationDate || !plannedDayIso) return false;
  try {
    const exp = startOfDay(parseISO(expirationDate.slice(0, 10)));
    const planned = startOfDay(parseISO(plannedDayIso.slice(0, 10)));
    return planned.getTime() > exp.getTime();
  } catch {
    return false;
  }
}

/** Lit les kcal affichées sur une fiche repas (chaîne potentiellement avec unités). */
function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Lit les protéines affichées sur une fiche repas. */
function parseProtein(prot: string | null | undefined): number {
  if (!prot) return 0;
  const n = parseFloat(prot.replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Convertit une surcharge planning en nombre, ou l'ignore si elle vaut 0/vide. */
function parsePositivePlanningOverride(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number"
    ? value
    : parseFloat(value.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const DAILY_PROTEIN_GOAL = 110;
const DAILY_FIBER_GOAL = 30;

/**
 * Vue principale du planning hebdomadaire : semaine courante / sauvegarde / suivante,
 * drag-and-drop, extras, reset et restauration.
 */
export function WeeklyPlanning({
  masterSourcePmIds = new Set(),
  unParUnSourcePmIds = new Set()
}: {
  masterSourcePmIds?: Set<string>,
  unParUnSourcePmIds?: Set<string>
} = {}) {
  const { possibleMeals, meals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const qc = useQueryClient();
  const { getPreference, setPreference, setPreferencesBatch, isLoading: prefsLoading } = usePreferences();
  const { items: foodItems } = useFoodItems();
  const { foodSortModes, sortDirections } = useSortModes({ enabled: true });
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const foodMacroIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  const { weekOffset, setWeekOffset, weekDates, todayISO } = usePlanningWeek();
  useSyncPlanningQueriesOnResume(qc);

  const isAvailableCb = useCallback((name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  }, [stockMap]);
  const { updateFoodItemCountersForPlanning, deductIngredientsFromStock, restoreIngredientsToStock, deductNameMatchStock } = useMealTransfers(foodItems);

  /** Jours de badge compteur figés par carte Possible (prefs). */
  const frozenCounterDaysByPmId = getPreference<PossibleFrozenCounterDaysMap>(
    POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
    {},
  );

  /**
   * Fige (ou re-fige) le badge compteur d’une carte Possible depuis les aliments à cet instant.
   * Re-gel one-shot quand on pose jour+créneau (ex. Croque → 1j samedi soir).
   * Ne remplace jamais une valeur numérique figée par `null` (merge).
   * `baseStartDate` : vraie ouverture pour recalculer même si le stock est déjà en Prog.
   */
  const freezePossibleBadgeCounter = (
    pmId: string,
    ingredients: string | null | undefined,
    dayKey?: string | null,
    mealTime?: string | null,
    createdAt?: string,
    baseStartDate?: string | null,
  ) => {
    const days = computePossibleFrozenCounterDays(
      ingredients,
      foodItems,
      foodMacroIndex,
      undefined,
      dayKey,
      mealTime,
      createdAt,
      baseStartDate,
    );
    const current = getPreference<PossibleFrozenCounterDaysMap>(POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, {});
    const merged = mergeFrozenPossibleCounterDays(current[pmId], days);
    setPreference.mutate({
      key: POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
      value: { ...current, [pmId]: merged },
    });
  };

  /** Met à jour le planning d’une carte Possible et recalcule les compteurs aliments + gel badge. */
  const updatePlanningWithCounters = (pmId: string, day: string | null, time: string | null) => {
    const pm = possibleMeals.find(p => p.id === pmId);
    let earliestCounter: string | null = null;
    if (pm?.meals) {
      const ing = pm.ingredients_override ?? pm.meals.ingredients;
      const analysis = analyzeMealIngredients({ ...pm.meals, ingredients: ing }, foodItems);
      earliestCounter = analysis.earliestCounterDate;
    }

    updatePlanning.mutate({
      id: pmId,
      day_of_week: day,
      meal_time: time,
      counter_start_date: day && time ? undefined : earliestCounter,
    });
    if (pm) {
      const ing = pm.ingredients_override ?? pm.meals?.ingredients;
      const fallbackDate = earliestCounter || pm.counter_start_date || null;
      // Re-gel AVANT de passer les aliments en Prog. (sinon le calcul renvoie null et efface le badge).
      if (day?.trim() && time?.trim()) {
        freezePossibleBadgeCounter(pmId, ing, day, time, pm.created_at, fallbackDate);
      }
      updateFoodItemCountersForPlanning(pmId, ing, day, time, fallbackDate, pm.created_at, possibleMeals);
    }
  };

  // Forcer le rafraîchissement des repas possibles au montage pour s'assurer que le planning affiche les dernières données
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  }, []);

  // Sélections de petit déjeuner par jour
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const dessertFoodItemIds = getPreference<string[]>(DESSERT_FOOD_PREF_KEY, []);
  const ingredientMacroLibrary = getPreference<IngredientMacroLibraryItem[]>("ingredient_macro_library", []);
  const dessertExtraStockSnapshots = getPreference<Record<string, Record<string, FoodItem[][]>>>('planning_dessert_extra_stock_snapshots', {});
  const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});
  const nextExtraSelections = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
  /** Cache local des desserts sélectionnés avant persistance du snapshot (évite la disparition à stock 0). */
  const pendingDessertCatalogRef = useRef(new Map<string, {
    id: string;
    name: string;
    cal: number;
    prot: number;
    fiber: number;
    mealPayload: Meal;
  }>());
  const [pendingDessertCatalogTick, setPendingDessertCatalogTick] = useState(0);
  const { getDayCalories, getDayProtein, getDayFiber, DAILY_GOAL, DAILY_GOAL_LOW, DAILY_FIBER_GOAL: DAILY_FIBER_GOAL_PREF_FROM_HOOK, getBreakfastForDay } = useCalorieBalance(isAvailableCb);
  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const possiblePetitDej = possibleMeals.filter(pm => pm.meals?.category === 'petit_dejeuner');
  /** Transforme une fiche repas en payload complet utilisable par les transferts de stock. */
  const buildMealTransferPayload = useCallback((meal: Meal): Meal => ({
    id: meal.id,
    name: meal.name,
    category: meal.category,
    calories: meal.calories,
    protein: meal.protein,
    grams: meal.grams,
    ingredients: meal.ingredients,
    sort_order: meal.sort_order,
    created_at: meal.created_at,
    is_available: meal.is_available,
    is_favorite: meal.is_favorite,
    oven_temp: meal.oven_temp ?? null,
    oven_minutes: meal.oven_minutes ?? null,
    description: meal.description ?? null,
  }), []);

  /** Liste complète des desserts "au choix" à ingrédient unique + Shaker whey. */
  const allSingleIngredientDessertExtras = useMemo(() => {
    const desserts = getMealsByCategory('dessert');
    const shakers = meals.filter(m => m.name.toLowerCase() === "shaker whey");
    const candidates = [...desserts];
    for (const s of shakers) {
      if (!candidates.find(c => c.id === s.id)) candidates.push(s as any);
    }

    const extrasByCustomId = new Map<string, {
      id: string;
      name: string;
      cal: number;
      prot: number;
      mealPayload: Meal;
    }>();

    candidates
      .filter((meal) => {
        if (!meal.ingredients?.trim()) return false;
        if (meal.name.toLowerCase() === "shaker whey") return true;
        const groups = parseIngredientGroups(meal.ingredients);
        if (groups.length !== 1) return false;
        const firstOr = groups[0];
        if (!firstOr || firstOr.length !== 1) return false;
        const bundle = firstOr[0] ?? [];
        const required = bundle.filter((i) => !i.optional);
        return required.length === 1;
      })
      .map((meal) => {
        let cal = getMealCal(meal) ?? 0;
        let prot = getMealPro(meal) ?? 0;
        let fiber = getMealFiber(meal, undefined, undefined, undefined, foodItems, foodMacroIndex) ?? 0;
        if (cal <= 0 && prot <= 0 && fiber <= 0) {
          const fallback = resolveSingleIngredientMealDessertMacros(meal as Meal, foodItems, ingredientMacroLibrary);
          cal = fallback.cal;
          prot = fallback.pro;
          fiber = fallback.fiber;
        }
        const mealPayload = buildMealTransferPayload(meal as Meal);
        return {
          id: buildDessertExtraId(meal.name, cal, prot),
          name: meal.name,
          cal,
          prot,
          fiber,
          mealPayload,
        };
      })
      .forEach((extra) => {
        // Plusieurs fiches repas peuvent représenter le même extra (ex. Shaker whey).
        // On déduplique par id custom pour éviter deux lignes identiques dans le popover.
        if (!extrasByCustomId.has(extra.id)) extrasByCustomId.set(extra.id, extra);
      });

    buildFoodDessertExtras(foodItems, dessertFoodItemIds, ingredientMacroLibrary).forEach((extra) => {
      const nameKey = normalizeKey(extra.name);
      for (const [existingId, existingExtra] of [...extrasByCustomId]) {
        if (normalizeKey(existingExtra.name) === nameKey) {
          extrasByCustomId.delete(existingId);
        }
      }
      extrasByCustomId.set(extra.id, extra);
    });

    const selectedFoodDessertIds = [
      ...Object.values(extraSelections).flat(),
      ...Object.values(nextExtraSelections).flat(),
    ].filter((id): id is string => !!parseFoodDessertExtraId(id));

    const supplementedFoodDesserts = supplementFoodDessertExtrasFromSnapshots(
      Array.from(extrasByCustomId.values()).filter((extra) => extra.id.startsWith("food-dessert::")),
      dessertExtraStockSnapshots,
      ingredientMacroLibrary,
      selectedFoodDessertIds,
    );
    for (const extra of supplementedFoodDesserts) {
      extrasByCustomId.set(extra.id, extra);
    }

    for (const selectedId of selectedFoodDessertIds) {
      if (findSnapshotFoodItemForDessertExtra(dessertExtraStockSnapshots, selectedId)) {
        pendingDessertCatalogRef.current.delete(selectedId);
      }
    }
    for (const [pendingId, pendingEntry] of pendingDessertCatalogRef.current) {
      if (selectedFoodDessertIds.includes(pendingId)) {
        extrasByCustomId.set(pendingId, pendingEntry);
      }
    }

    const deduped = deduplicateDessertExtraCatalog(
      Array.from(extrasByCustomId.values()),
      foodItems,
      selectedFoodDessertIds,
    );
    return stripDessertCatalogDuplicatesForSelections(
      deduped,
      selectedFoodDessertIds,
      dessertExtraStockSnapshots,
    );
  }, [buildMealTransferPayload, dessertExtraStockSnapshots, dessertFoodItemIds, extraSelections, foodItems, foodMacroIndex, getMealsByCategory, ingredientMacroLibrary, meals, nextExtraSelections, pendingDessertCatalogTick]);
  /** Desserts à ingrédient unique actuellement ajoutables (stock > 0). */
  const singleIngredientDessertExtras = useMemo(() => {
    const withExpiry = allSingleIngredientDessertExtras
      .filter((d) => {
        const multiple = getMealMultiple(d.mealPayload, stockMap);
        return (multiple ?? 0) > 0;
      })
      .map((d) => {
        const groups = parseIngredientGroups(d.mealPayload.ingredients || "");
        const first = groups[0]?.[0]?.find((i) => !i.optional);
        const ingName = first?.name || "";
        const dates = foodItems
          .filter((fi) => fi.storage_type !== "extras" && fi.storage_type !== "test" && strictNameMatch(fi.name, ingName))
          .map((fi) => fi.expiration_date)
          .filter((v): v is string => !!v)
          .sort((a, b) => a.localeCompare(b));
        return { ...d, sortExpiry: dates[0] ?? null };
      });
    withExpiry.sort((a, b) => {
      if (a.sortExpiry && b.sortExpiry) return a.sortExpiry.localeCompare(b.sortExpiry);
      if (a.sortExpiry) return -1;
      if (b.sortExpiry) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
    return withExpiry;
  }, [allSingleIngredientDessertExtras, stockMap, foodItems]);
  const singleIngredientDessertById = useMemo(
    () => new Map(allSingleIngredientDessertExtras.map((d) => [d.id, d])),
    [allSingleIngredientDessertExtras]
  );

  /**
   * Mémorise localement un dessert avant déduction du dernier stock pour qu'il reste affichable en « Sélectionnés ».
   */
  const rememberPendingDessertExtra = useCallback((dessertExtraId: string) => {
    const entry = singleIngredientDessertById.get(dessertExtraId);
    if (!entry) return;
    pendingDessertCatalogRef.current.set(dessertExtraId, entry);
    setPendingDessertCatalogTick((tick) => tick + 1);
  }, [singleIngredientDessertById]);

  /**
   * Somme les macros des extras d'un jour en incluant le catalogue desserts et les snapshots (stock épuisé).
   */
  const sumDayExtras = useCallback(
    (ids: string[] | undefined) =>
      aggregateExtraSelectionMacros(
        ids,
        foodItems,
        ingredientMacroLibrary,
        singleIngredientDessertById,
        dessertExtraStockSnapshots,
      ),
    [dessertExtraStockSnapshots, foodItems, ingredientMacroLibrary, singleIngredientDessertById],
  );
  /** Disponibilité en stock de chaque dessert (sert notamment à masquer le bouton +). */
  const canAddDessertById = useMemo(
    () =>
      new Map(
        allSingleIngredientDessertExtras.map((d) => [
          d.id,
          (getMealMultiple(d.mealPayload, stockMap) ?? 0) > 0,
        ])
      ),
    [allSingleIngredientDessertExtras, stockMap]
  );
  const dessertPossibleCountById = useMemo(
    () =>
      new Map(
        allSingleIngredientDessertExtras.map((d) => [
          d.id,
          Math.max(0, Math.floor(getMealMultiple(d.mealPayload, stockMap) ?? 0)),
        ])
      ),
    [allSingleIngredientDessertExtras, stockMap]
  );

  /** Lit la mémoire des snapshots de stock des desserts extras pour pouvoir restaurer fidèlement chaque occurrence. */
  const readDessertExtraStockSnapshots = useCallback(() => {
    return getPreference<Record<string, Record<string, FoodItem[][]>>>('planning_dessert_extra_stock_snapshots', {});
  }, [getPreference]);

  /** Écrit la mémoire des snapshots de stock des desserts extras dans les préférences utilisateur. */
  const writeDessertExtraStockSnapshots = useCallback((value: Record<string, Record<string, FoodItem[][]>>) => {
    return setPreference.mutateAsync({ key: 'planning_dessert_extra_stock_snapshots', value });
  }, [setPreference]);

  /**
   * Construit le store de snapshots après ajout d'une occurrence, sans écrire immédiatement en base.
   */
  const buildDessertExtraSnapshotStoreAfterPush = useCallback((
    dessertExtraId: string,
    iso: string,
    key: string,
    snapshot: FoodItem[],
  ): Record<string, Record<string, FoodItem[][]>> => {
    const day = iso || key;
    const store = { ...readDessertExtraStockSnapshots() };
    const dayStore = { ...(store[day] || {}) };
    const cur = [...(dayStore[dessertExtraId] || [])];
    cur.push(snapshot);
    dayStore[dessertExtraId] = cur;
    store[day] = dayStore;
    return store;
  }, [readDessertExtraStockSnapshots]);

  /** Ajoute un snapshot de stock pour une occurrence de dessert extra sur un jour donné. */
  const pushDessertExtraSnapshot = useCallback(async (dessertExtraId: string, iso: string, key: string, snapshot: FoodItem[]) => {
    const store = buildDessertExtraSnapshotStoreAfterPush(dessertExtraId, iso, key, snapshot);
    await writeDessertExtraStockSnapshots(store);
  }, [buildDessertExtraSnapshotStoreAfterPush, writeDessertExtraStockSnapshots]);

  /**
   * Persiste en une fois la sélection extras et, si besoin, le snapshot dessert associé.
   */
  const persistExtraSelectionAndSnapshot = useCallback(async (
    selectionKey: 'planning_extra_selections' | 'next_week_extra_selections',
    selectionValue: Record<string, string[]>,
    snapshotStore?: Record<string, Record<string, FoodItem[][]>>,
  ) => {
    const entries: { key: string; value: Record<string, string[]> | Record<string, Record<string, FoodItem[][]>> }[] = [
      { key: selectionKey, value: selectionValue },
    ];
    if (snapshotStore) {
      entries.unshift({ key: 'planning_dessert_extra_stock_snapshots', value: snapshotStore });
    }
    await setPreferencesBatch.mutateAsync(entries);
  }, [setPreferencesBatch]);

  /** Retire et renvoie le dernier snapshot mémorisé pour restaurer exactement une occurrence de dessert. */
  const popDessertExtraSnapshot = useCallback((dessertExtraId: string, iso: string, key: string): FoodItem[] | null => {
    const day = iso || key;
    const store = { ...readDessertExtraStockSnapshots() };
    const dayStore = { ...(store[day] || {}) };
    const cur = [...(dayStore[dessertExtraId] || [])];
    if (cur.length === 0) return null;
    const last = cur.pop() || null;
    if (cur.length > 0) dayStore[dessertExtraId] = cur;
    else delete dayStore[dessertExtraId];
    if (Object.keys(dayStore).length > 0) store[day] = dayStore;
    else delete store[day];
    writeDessertExtraStockSnapshots(store);
    return last;
  }, [readDessertExtraStockSnapshots, writeDessertExtraStockSnapshots]);

  /** Applique une occurrence d’ajout/retrait dessert avec décompte réel + restauration via snapshot. */
  const applyDessertExtraStockDelta = useCallback(async (
    dessertExtraId: string,
    delta: 1 | -1,
    iso: string,
    key: string,
    options?: { persistSnapshot?: boolean },
  ): Promise<{ ok: boolean; snapshots?: FoodItem[] }> => {
    // Semaine courante et aperçu semaine prochaine : décompte immédiat. Archive (-1) : lecture seule.
    if (weekOffset < 0) return { ok: false };
    const dessert = singleIngredientDessertById.get(dessertExtraId);
    if (!dessert) return { ok: false };
    const isInfiniteDessertStock = getMealMultiple(dessert.mealPayload, stockMap) === Infinity;
    if (delta > 0) {
      rememberPendingDessertExtra(dessertExtraId);
      const res = await deductIngredientsFromStock(dessert.mealPayload);
      // Une déduction valide peut être un UPDATE (pas seulement un DELETE) :
      // on s'appuie donc sur la présence de snapshots touchés, pas sur consumedIds.
      // Si tout le stock concerné est infini (ex. Shaker whey), il n'y a rien à snapshotter.
      if (!res || ((res.snapshots?.length ?? 0) === 0 && !isInfiniteDessertStock)) return { ok: false };
      if ((res.snapshots?.length ?? 0) === 0) return { ok: true };
      if (options?.persistSnapshot !== false) {
        await pushDessertExtraSnapshot(dessertExtraId, iso, key, res.snapshots || []);
      }
      qc.invalidateQueries({ queryKey: ["food_items"] });
      return { ok: true, snapshots: res.snapshots };
    }
    const snapshot = popDessertExtraSnapshot(dessertExtraId, iso, key);
    if (!snapshot && isInfiniteDessertStock) return { ok: true };
    // Sans snapshot, on ne restaure pas pour éviter d'inventer du stock qui n'a jamais été décrémenté.
    if (!snapshot) return { ok: false };
    await restoreIngredientsToStock(dessert.mealPayload, snapshot);
    qc.invalidateQueries({ queryKey: ["food_items"] });
    return { ok: true };
  }, [deductIngredientsFromStock, popDessertExtraSnapshot, pushDessertExtraSnapshot, qc, rememberPendingDessertExtra, restoreIngredientsToStock, singleIngredientDessertById, stockMap, weekOffset]);

  const setBreakfastForDay = (day: string, selId: string | null) => {
    const updated = { ...breakfastSelections };
    const oldSelId = breakfastSelections[day];

    // Effacer l'ancienne planification s'il s'agissait d'un PossibleMeal
    if (oldSelId?.startsWith('pm:')) {
      const oldPmId = oldSelId.slice(3);
      if (selId !== oldSelId) {
        updatePlanningWithCounters(oldPmId, null, null);
      }
    }

    if (selId) {
      updated[day] = selId;
      if (selId.startsWith('pm:')) {
        const pmId = selId.slice(3);
        updatePlanningWithCounters(pmId, day, 'matin');
      }
    } else {
      delete updated[day];
    }
    setPreference.mutate({ key: 'planning_breakfast', value: updated });

    // Activer auto-consommation pour "Dèj choco", désactiver sur les autres changements
    const selectedMeal = getBreakfastMealFromSelId(selId);
    const isDejeChoco = selectedMeal?.name?.toLowerCase().includes('dèj choco') || selectedMeal?.name?.toLowerCase().includes('dej choco');
    if (isDejeChoco) {
      const updatedAC = { ...autoConsumeBreakfast, [day]: true };
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    } else if (autoConsumeBreakfast[day]) {
      const updatedAC = { ...autoConsumeBreakfast };
      delete updatedAC[day];
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    }
  };

  /** Résoudre un ID de sélection en un objet Meal (pour usage interne) */
  const getBreakfastMealFromSelId = (selId: string | null | undefined) => {
    if (!selId) return null;
    if (selId.startsWith('pm:')) {
      const pmId = selId.slice(3);
      return possiblePetitDej.find(pm => pm.id === pmId)?.meals || null;
    }
    if (selId.startsWith('meal:')) {
      const mealId = selId.slice(5);
      return petitDejMeals.find(m => m.id === mealId) || null;
    }
    // Ancien format (Legacy)
    return petitDejMeals.find(m => m.id === selId) || possiblePetitDej.find(pm => pm.meal_id === selId)?.meals || null;
  };
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverUnplanned, setDragOverUnplanned] = useState(false);

  const slotDragRef = useRef<{ pmId: string; slotKey: string } | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null);

  const todayRef = useRef<HTMLDivElement | null>(null);
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  const [popupPm, setPopupPm] = useState<PossibleMeal | null>(null);
  const [popupCalOverride, setPopupCalOverride] = useState<string | undefined>(undefined);
  const [popupProOverride, setPopupProOverride] = useState<string | undefined>(undefined);
  const [popupBreakfast, setPopupBreakfast] = useState<{ meal: any; day: string } | null>(null);
  const [additiveModes, setAdditiveModes] = useState<Record<string, { active: boolean; value: string }>>({});
  const [openExtrasDay, setOpenExtrasDay] = useState<string | null>(null);
  const [draggedSelectedExtraId, setDraggedSelectedExtraId] = useState<string | null>(null);
  const [draggedSelectedExtraOrigin, setDraggedSelectedExtraOrigin] = useState<{ iso: string; key: string } | null>(null);
  const [selectedExtrasTopByDay, setSelectedExtrasTopByDay] = useState<Record<string, string[]>>({});
  const [selectedExtrasMiddleByDay, setSelectedExtrasMiddleByDay] = useState<Record<string, string[]>>({});
  const [selectedExtrasDropZone, setSelectedExtrasDropZone] = useState<string | null>(null);
  const [customExtraName, setCustomExtraName] = useState('');
  const [customExtraCal, setCustomExtraCal] = useState('');
  const [customExtraProt, setCustomExtraProt] = useState('');
  const [customExtraFiber, setCustomExtraFiber] = useState('');
  const backupCardTapRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (todayRef.current) {
      setTimeout(() => {
        const el = todayRef.current;
        if (!el) return;
        const headerHeight = 112;
        const top = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top, behavior: "smooth" });
      }, 200);
    }
  }, []);

  // Auto-consommation du petit déjeuner pour les jours passés
  const autoConsumedDays = getPreference<Record<string, boolean>>('planning_auto_consumed_days', {});
  const autoConsumeChecked = useRef(false);
  useEffect(() => {
    if (autoConsumeChecked.current) return;
    if (prefsLoading) return; // Attendre le chargement des préférences
    if (foodItems.length === 0) return; // Attendre le chargement des aliments
    if (possibleMeals === undefined) return; // Attendre les repas possibles
    autoConsumeChecked.current = true;

    const runAutoConsume = async () => {
      // Vérifier depuis la DB pour éviter une double consommation
      const { data: freshConsumedData } = await supabase.from('user_preferences')
        .select('value').eq('key', 'planning_auto_consumed_days').maybeSingle();
      const freshConsumed = (freshConsumedData?.value as Record<string, boolean>) ?? {};

      const todayIdx = DAY_KEY_TO_INDEX[todayKey];
      const pastDays = DAYS.filter((_, i) => i < todayIdx);

      const toConsume: string[] = [];
      for (const day of pastDays) {
        if (autoConsumeBreakfast[day] && breakfastSelections[day] && !freshConsumed[day]) {
          toConsume.push(day);
        }
      }

      if (toConsume.length > 0) {
        const updatedConsumed = { ...freshConsumed };
        for (const day of toConsume) {
          updatedConsumed[day] = true;
          const selId = breakfastSelections[day];
          // Résoudre l'ID de sélection préfixé
          let breakfast: any = null;
          if (selId.startsWith('pm:')) {
            const pmId = selId.slice(3);
            const pm = possibleMeals.find(p => p.id === pmId);
            if (pm?.meals) breakfast = { ...pm.meals, ingredients: pm.ingredients_override ?? pm.meals.ingredients };
          } else if (selId.startsWith('meal:')) {
            const mId = selId.slice(5);
            breakfast = petitDejMeals.find(m => m.id === mId);
          } else {
            // Ancien ID simple (Legacy)
            breakfast = petitDejMeals.find(m => m.id === selId) || possibleMeals.find(pm => pm.meal_id === selId)?.meals;
          }
          if (breakfast) {
            // Construire un objet de type Meal pour les fonctions de transfert
            const mealObj = {
              id: breakfast.id,
              name: breakfast.name,
              category: breakfast.category || 'petit_dejeuner',
              calories: breakfast.calories,
              protein: breakfast.protein,
              grams: breakfast.grams,
              ingredients: breakfast.ingredients,
              sort_order: breakfast.sort_order,
              created_at: breakfast.created_at,
              is_available: (breakfast as any).is_available ?? false,
              is_favorite: (breakfast as any).is_favorite ?? false,
              oven_temp: breakfast.oven_temp ?? null,
              oven_minutes: breakfast.oven_minutes ?? null,
              description: (breakfast as Meal).description ?? null,
            } as Meal;

            if (mealObj.ingredients?.trim()) {
              // Utiliser une déduction basée sur les ingrédients
              await deductIngredientsFromStock(mealObj);
            } else {
              // Utiliser une déduction par correspondance de nom
              await deductNameMatchStock(mealObj);
            }
            qc.invalidateQueries({ queryKey: ["food_items"] });
          }
        }
        setPreference.mutate({ key: 'planning_auto_consumed_days', value: updatedConsumed });
      }
    };
    runAutoConsume();
  }, [foodItems.length, prefsLoading, possibleMeals]);

  const planningMeals = possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    // Catégories hors plats : n'afficher que si elles ont une date de planification assignée
    return !!pm.day_of_week && !!pm.meal_time;
  });

  // Détermine le slot visuel effectif d'une carte (slot planifié ou override temporaire d'affichage).
  const getVisualSlotForPm = (pm: PossibleMeal) => {
    const override = planningSlotOverrides[pm.id];
    // Un override ne vaut que pour la date actuellement planifiée.
    // Si la carte est replanifiée depuis Possible, on force l'affichage sur le nouveau vrai créneau.
    if (override?.day && override?.time && override.day === pm.day_of_week) {
      return { day: override.day, time: override.time };
    }
    return { day: pm.day_of_week ?? null, time: pm.meal_time ?? null };
  };

  const getMealsForSlot = (day: string, time: string, iso?: string): PossibleMeal[] =>
    planningMeals
      .filter((pm) => {
        const visual = getVisualSlotForPm(pm);
        return (visual.day === day || (iso && visual.day === iso)) && visual.time === time;
      })
      .sort((a, b) => a.sort_order - b.sort_order);

  const getDisplayDay = (day: string | null | undefined) => {
    if (!day) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      try {
        return format(parseISO(day), 'EEEE d/MM', { locale: fr }).toUpperCase();
      } catch (e) {
        return day;
      }
    }
    return DAY_LABELS[day] || (DAY_KEY_TO_INDEX[day?.toLowerCase()] !== undefined ? DAY_LABELS[day.toLowerCase()] : day);
  };

  const unplanned = planningMeals.filter((pm) => !pm.day_of_week || !pm.meal_time);

  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const proOverrides = getPreference<Record<string, string>>('planning_pro_overrides', {});

  const { manualResetBusy, restoreBusy, handleManualReset, handleRestoreBackup } = usePlanningResetRestore({
    qc,
    possibleMeals,
    weekDates,
    calOverrides,
    proOverrides,
    getDayCalories,
    getPreference,
    setPreference,
  });
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const planningSlotOverrides = getPreference<Record<string, { day: string; time: string }>>('planning_slot_overrides', {});

  /**
   * Assigne une carte à un créneau Planning en persistant meal_time (y compris goûter)
   * et en nettoyant tout override d’affichage obsolète.
   */
  const assignPmToPlanningSlot = (pmId: string, day: string, time: string) => {
    const updated = { ...planningSlotOverrides };
    if (updated[pmId]) {
      delete updated[pmId];
      setPreference.mutate({ key: "planning_slot_overrides", value: updated });
    }
    updatePlanningWithCounters(pmId, day, time);
  };

  /** Retire une carte du planning (Hors planning) et purge l’override d’affichage. */
  const clearPmPlanningSlot = (pmId: string) => {
    const updated = { ...planningSlotOverrides };
    delete updated[pmId];
    setPreference.mutate({ key: "planning_slot_overrides", value: updated });
    updatePlanningWithCounters(pmId, null, null);
  };

  const {
    touchDragActive,
    touchHighlight,
    touchPressPending,
    touchCancelHint,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  } = usePlanningTouchDrag({
    assignPmToPlanningSlot,
    clearPmPlanningSlot,
  });

  /** Migre les anciens overrides goûter (affichage seul) vers un vrai meal_time persisté. */
  const migratedGouterOverridesRef = useRef(false);
  useEffect(() => {
    if (migratedGouterOverridesRef.current || prefsLoading) return;
    const gouterOverrides = Object.entries(planningSlotOverrides).filter(
      ([, slot]) => slot?.time === "gouter" && !!slot.day,
    );
    if (gouterOverrides.length === 0) {
      migratedGouterOverridesRef.current = true;
      return;
    }
    migratedGouterOverridesRef.current = true;
    const updated = { ...planningSlotOverrides };
    for (const [pmId, slot] of gouterOverrides) {
      delete updated[pmId];
      updatePlanningWithCounters(pmId, slot.day, slot.time);
    }
    setPreference.mutate({ key: "planning_slot_overrides", value: updated });
  }, [planningSlotOverrides, prefsLoading]);
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const manualProteins = getPreference<Record<string, number>>('planning_manual_proteins', {});
  const manualFibers = getPreference<Record<string, number>>('planning_manual_fibers', {});
  const breakfastManualProteins = getPreference<Record<string, number>>('planning_breakfast_manual_proteins', {});
  const extraProteins = getPreference<Record<string, number>>('planning_extra_proteins', {});
  const extraFibers = getPreference<Record<string, number>>('planning_extra_fibers', {});
  const testItemIds = getPreference<string[]>('food_test_ids', []);
  const extrasDividerAfterId = getPreference<string | null>(FOOD_EXTRAS_DIVIDER_PREF_KEY, null);
  const testItemIdSet = new Set(testItemIds);
  // Assignation visuelle d’un extra à un créneau (matin/midi/soir) d’un jour donné.
  // Clé = `${iso}-${slot}`, valeur = liste d’ids d’aliments (pas de customExtra ici).
  const extraSlotAssignments = getPreference<Record<string, string[]>>('planning_extra_slot_assignments', {});

  const savedSnapshots = getPreference<Record<string, PlanningSnapshotEntry>>('planning_saved_snapshots', {});
  /**
   * Résout le snapshot d'extra directement lié au jour affiché.
   * Les anciens snapshots ISO d'un même jour de semaine ne sont pas repris ici :
   * ils peuvent réafficher en semaine prochaine un extra qui vient d'être oublié.
   */
  const resolveExtraSnapshotForDay = (iso: string, key: string) => {
    const direct = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
    if (direct) return direct;
    return null;
  };
  const [flashedKeys, setFlashedKeys] = useState<Record<string, boolean>>({});
  const WEEKLY_GOAL = DAILY_GOAL * DEFAULT_WEEKLY_MULTIPLIER;
  const WEEKLY_GOAL_LOW = DAILY_GOAL_LOW > 0 ? DAILY_GOAL_LOW * DEFAULT_WEEKLY_MULTIPLIER : 0;
  const DAILY_PROTEIN_GOAL_PREF = getPreference<number>('planning_protein_goal', DAILY_PROTEIN_GOAL);
  const DAILY_FIBER_GOAL_PREF = getPreference<number>('planning_fiber_goal', DAILY_FIBER_GOAL_PREF_FROM_HOOK || DAILY_FIBER_GOAL);
  const NEXT_DAILY_GOAL = getPreference<number>('next_week_daily_goal', DAILY_GOAL);
  const NEXT_DAILY_GOAL_LOW = getPreference<number>('next_week_daily_goal_low', DAILY_GOAL_LOW);
  /** Case « Masquer calories » (entête site) : remplace le chiffre kcal du jour par « Calories ». */
  const hideDayCalorieTotals = getPreference<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);
  const NEXT_PROTEIN_GOAL = getPreference<number>('next_week_protein_goal', DAILY_PROTEIN_GOAL_PREF);
  const NEXT_FIBER_GOAL = getPreference<number>('next_week_fiber_goal', DAILY_FIBER_GOAL_PREF);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [editingProteinGoal, setEditingProteinGoal] = useState(false);
  const [proteinGoalInput, setProteinGoalInput] = useState("");
  const [editingFiberGoal, setEditingFiberGoal] = useState(false);
  const [fiberGoalInput, setFiberGoalInput] = useState("");
  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const autoConsumeBreakfast = getPreference<Record<string, boolean>>('planning_auto_consume_breakfast', {});

  // Préférences pour la semaine prochaine (persistent au reset)
  const nextBreakfastSelections = getPreference<Record<string, string>>('next_week_breakfast', {});
  const nextManualCalories = getPreference<Record<string, number>>('next_week_manual_calories', {});
  const nextManualProteins = getPreference<Record<string, number>>('next_week_manual_proteins', {});
  const nextManualFibers = getPreference<Record<string, number>>('next_week_manual_fibers', {});
  const nextExtraCalories = getPreference<Record<string, number>>('next_week_extra_calories', {});
  const nextExtraProteins = getPreference<Record<string, number>>('next_week_extra_proteins', {});
  const nextExtraFibers = getPreference<Record<string, number>>('next_week_extra_fibers', {});
  const nextExtraSlotAssignments = getPreference<Record<string, string[]>>('next_week_extra_slot_assignments', {});
  const nextBreakfastManualCalories = getPreference<Record<string, number>>('next_week_breakfast_manual_calories', {});
  const nextBreakfastManualProteins = getPreference<Record<string, number>>('next_week_breakfast_manual_proteins', {});
  const nextDrinkChecks = getPreference<Record<string, boolean>>('next_week_drink_checks', {});

  // Recherche de repas pour la vue de sauvegarde
  const allMealsById = useMemo(() => {
    const map = new Map<string, Meal>();
    for (const m of meals) map.set(m.id, m);
    return map;
  }, [meals]);

  // Ouvre la popup de détail d'une carte Possible, avec overrides optionnels (ex. semaine précédente).
  const openPlanningCardPopup = (
    pm: PossibleMeal,
    overrides?: { cal?: string | number; pro?: string | number },
  ) => {
    setPopupCalOverride(
      overrides?.cal != null && String(overrides.cal).trim() !== ""
        ? String(overrides.cal)
        : undefined,
    );
    setPopupProOverride(
      overrides?.pro != null && String(overrides.pro).trim() !== ""
        ? String(overrides.pro)
        : undefined,
    );
    setPopupPm(pm);
  };

  // Retrouve le repas lié à une carte de sauvegarde (catalogue actuel ou instantané embarqué).
  const resolveBackupCardMeal = (card: any): Meal | null => {
    if (card?.meals) return card.meals as Meal;
    const fromCatalog = card?.meal_id ? allMealsById.get(card.meal_id) : null;
    if (fromCatalog) return fromCatalog;
    if (!card?.meal_name) return null;
    return {
      id: card.meal_id || card.id,
      name: card.meal_name,
      category: card.meal_category ?? "plat",
      calories: card.meal_calories ?? null,
      protein: card.meal_protein ?? null,
      grams: card.meal_grams ?? null,
      ingredients: card.ingredients_override ?? card.meal_ingredients ?? null,
      sort_order: card.sort_order ?? 0,
      created_at: card.created_at ?? new Date(0).toISOString(),
      is_available: true,
      is_favorite: false,
      oven_temp: card.meal_oven_temp ?? null,
      oven_minutes: card.meal_oven_minutes ?? null,
      description: card.meal_description ?? null,
    };
  };

  // Reconstruit une carte Possible depuis la sauvegarde hebdo pour afficher la même popup en lecture seule.
  const openBackupPlanningCardPopup = (
    card: any,
    calOverride?: string | number,
    proOverride?: string | number,
  ) => {
    const meal = resolveBackupCardMeal(card);
    if (!meal) {
      toast({
        title: "Détail indisponible",
        description: "Ce repas n'a plus assez d'informations dans la sauvegarde.",
        variant: "destructive",
      });
      return;
    }
    openPlanningCardPopup(
      {
        id: card.id,
        meal_id: card.meal_id,
        quantity: card.quantity ?? 1,
        expiration_date: card.expiration_date ?? null,
        day_of_week: card.day_of_week ?? null,
        meal_time: card.meal_time ?? null,
        counter_start_date: card.counter_start_date ?? null,
        sort_order: card.sort_order ?? 0,
        created_at: card.created_at ?? new Date(0).toISOString(),
        meals: meal,
        ingredients_override: card.ingredients_override ?? null,
      },
      { cal: calOverride, pro: proOverride },
    );
  };

  // Déclenche la popup sur double-clic desktop ou double-tap mobile pour une carte de sauvegarde.
  const handleBackupCardOpen = (cardKey: string, open: () => void) => {
    const now = Date.now();
    const last = backupCardTapRef.current;
    if (last && last.key === cardKey && now - last.at < 450) {
      backupCardTapRef.current = null;
      open();
      return;
    }
    backupCardTapRef.current = { key: cardKey, at: now };
  };

  const backupTotals = useMemo(() => {
    if (weekOffset !== -1) return null;
    const backupRaw = getPreference<any>('possible_meals_backup', null);
    if (!backupRaw) return null;

    const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
    const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);
    const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
    const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
    const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
    const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
    const bES = isNF ? (backupRaw.extraSelections || {}) : {};
    const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
    const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
    const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
    const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
    const bCO = isNF
      ? mergeBackupCardOverrides(backupRaw.calOverrides, calOverrides, cards.map((c) => c.id))
      : {};
    const bPO = isNF
      ? mergeBackupCardOverrides(backupRaw.proOverrides, proOverrides, cards.map((c) => c.id))
      : {};

    // Objectifs tels qu’au moment de la sauvegarde (ne pas utiliser les objectifs courants / semaine suivante)
    const archivedDailyGoal =
      isNF && backupRaw.daily_goal != null && backupRaw.daily_goal > 0 ? backupRaw.daily_goal : DEFAULT_DAILY_GOAL;
    const archivedProteinGoal =
      isNF && backupRaw.protein_goal != null && backupRaw.protein_goal > 0 ? backupRaw.protein_goal : DAILY_PROTEIN_GOAL;

    let totalCal = 0;
    let totalPro = 0;

    const bDates = weekDates;
    bDates.forEach(({ key, iso }) => {
      const isTodayBack = iso === todayISO;
      let dayCal = 0;
      let dayPro = 0;

      // Repas
      cards.filter(c => c.day_of_week === key || c.day_of_week === iso).forEach(c => {
        const m = allMealsById.get(c.meal_id);
        if (m) {
          const overrideCal = c.id ? bCO[c.id] : undefined;
          const overridePro = c.id ? bPO[c.id] : undefined;
          const fullPm = { ...c, meals: m };
          dayCal += getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
          dayPro += getCardDisplayProtein(fullPm, overridePro, isAvailableCb, foodItems, foodMacroIndex);
        }
      });

      // Manuel
      dayCal += (bMC[iso] || bMC[key] || 0);
      dayPro += (bMP[iso] || bMP[key] || 0);

      // Extra (manuel + liste : inclut les ids `custom::…` de la sauvegarde)
      const selExtra = sumDayExtras(bES[iso] || bES[key]);
      const eCal = (bEC[iso] || bEC[key] || 0) + selExtra.cal;
      const ePro = (bEP[iso] || bEP[key] || 0) + selExtra.pro;
      dayCal += eCal;
      dayPro += ePro;

      // Petit déjeuner
      const bfSel = bBS[iso] || bBS[key];
      if (bfSel) {
        if (bfSel.startsWith('pm:')) {
          const pm = cards.find((p: { id: string }) => p.id === bfSel.slice(3));
          const dayMatinCards = cards.filter(
            (c: { day_of_week: string; meal_time: string }) =>
              (c.day_of_week === iso || c.day_of_week === key) && c.meal_time === 'matin',
          );
          if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, iso, key, dayMatinCards)) {
            dayCal += getCardDisplayCalories(pm, bCO[pm.id], isAvailableCb);
            dayPro += getCardDisplayProtein(pm, bPO[pm.id], isAvailableCb, foodItems, foodMacroIndex);
          }
        } else {
          const m = allMealsById.get(bfSel);
          if (m) {
            dayCal += parseCalories(m.calories);
            dayPro += parseProtein(m.protein);
          }
        }
      }
      dayCal += (bBC[iso] || bBC[key] || 0);
      dayPro += (bBP[iso] || bBP[key] || 0);

      for (const time of TIMES) {
        if (bDC[`${iso}-${time}`] || bDC[`${key}-${time}`]) dayCal += DRINK_CALORIES;
      }

      totalCal += dayCal;
      totalPro += dayPro;
    });

    return { totalCal, totalPro, archivedDailyGoal, archivedProteinGoal };
  }, [getPreference, weekOffset, allMealsById, foodItems, weekDates, calOverrides, proOverrides, todayISO, isAvailableCb, foodMacroIndex]);

  const handleAddExtraItem = (day: string, item: FoodItem, remove = false) => {
    const updated = { ...extraSelections };
    const current = updated[day] || [];
    if (remove) {
      // Retirer une instance
      const idx = current.lastIndexOf(item.id);
      if (idx >= 0) {
        updated[day] = [...current.slice(0, idx), ...current.slice(idx + 1)];
      }
    } else {
      // Toujours ajouter (autoriser les doublons)
      updated[day] = [...current, item.id];
    }
    setPreference.mutate({ key: 'planning_extra_selections', value: updated });
  };

  // Garantit qu’un extra est présent dans `planning_extra_selections` pour un jour donné.
  // Fonctionne pour les extras standards ET personnalisés (`custom::...`).
  const ensureExtraSelectedForDay = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const cur = extraSelections[iso] || extraSelections[key] || [];
    if (cur.includes(extraId)) return;
    const updated = { ...extraSelections };
    if (iso) updated[iso] = [...cur, extraId]; else updated[key] = [...cur, extraId];
    setPreference.mutate({ key: 'planning_extra_selections', value: updated });
  };

  // Assigne un extra à un créneau précis du jour et le retire des autres créneaux du même jour.
  const assignExtraToDaySlot = (extraId: string, iso: string, key: string, slot: ExtraDaySlot) => {
    if (!extraId) return;
    ensureExtraSelectedForDay(extraId, iso, key);
    const selectedForDay = extraSelections[iso] || extraSelections[key] || [];
    const occurrenceCount = Math.max(1, selectedForDay.filter((id) => id === extraId).length);
    const assignments = assignExtraToDaySlotMap(
      extraSlotAssignments,
      extraId,
      iso,
      key,
      slot,
      occurrenceCount,
    );
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: assignments });
  };

  // Retire un extra du créneau ciblé d’un jour (ne le désélectionne pas au niveau jour).
  const removeExtraFromDaySlot = (extraId: string, iso: string, key: string, slot: ExtraDaySlot) => {
    if (!extraId) return;
    const updated = removeExtraFromDaySlotMap(extraSlotAssignments, extraId, iso, key, slot);
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: updated });
  };

  // Liste les ids d'extras déjà posés dans les slots d'une journée (matin/midi/soir/goûter).
  const getAssignedExtraIdsForDayLocal = (iso: string, key: string): string[] =>
    getAssignedExtraIdsForDay(extraSlotAssignments, iso, key);

  // Retire un extra de tous les slots de la journée (retour dans la catégorie "Extras").
  const unassignExtraFromAllDaySlots = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const updated = unassignExtraFromAllDaySlotsMap(extraSlotAssignments, extraId, iso, key);
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: updated });
  };

  // Désélectionne complètement un extra du jour (toutes occurrences) + le retire de tous les slots.
  const deselectExtraForDay = async (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const updatedSel = { ...extraSelections };
    const cur = updatedSel[iso] || updatedSel[key] || [];
    const count = cur.filter((id) => id === extraId).length;
    if (singleIngredientDessertById.has(extraId) && count > 0) {
      for (let i = 0; i < count; i++) {
        await applyDessertExtraStockDelta(extraId, -1, iso, key);
      }
    }
    const next = cur.filter((id) => id !== extraId);
    if (iso) updatedSel[iso] = next;
    else updatedSel[key] = next;
    setPreference.mutate({ key: 'planning_extra_selections', value: updatedSel });
    unassignExtraFromAllDaySlots(extraId, iso, key);
  };

  /** Retire une seule occurrence d'un extra du jour, avec restauration de stock pour les desserts dédiés. */
  const removeOneSelectedExtraForDay = async (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const current = extraSelections[iso] || extraSelections[key] || [];
    if (!current.includes(extraId)) return;
    if (singleIngredientDessertById.has(extraId)) {
      await applyDessertExtraStockDelta(extraId, -1, iso, key);
    }
    const nextSelections = removeOneExtraOccurrenceForDay(extraSelections, iso, key, extraId);
    setPreference.mutate({ key: 'planning_extra_selections', value: nextSelections });
    const remaining = (nextSelections[iso] || nextSelections[key] || []).filter((id) => id === extraId).length;
    if (remaining <= 0) {
      unassignExtraFromAllDaySlots(extraId, iso, key);
    }
  };

  // Déplace un extra entre deux jours en évitant les courses d'écritures (suppression + ajout atomiques).
  const moveExtraBetweenDaysToSlot = (
    extraId: string,
    sourceIso: string,
    sourceKey: string,
    targetIso: string,
    targetKey: string,
    targetSlot: ExtraDaySlot,
  ) => {
    if (!extraId) return;
    const { selections: nextSelections, assignments: nextAssignments } = moveExtraBetweenDaysToSlotMaps(
      extraSelections,
      extraSlotAssignments,
      extraId,
      sourceIso,
      sourceKey,
      targetIso,
      targetKey,
      targetSlot,
    );
    setPreference.mutate({ key: 'planning_extra_selections', value: nextSelections });
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: nextAssignments });
  };

  // Garantit qu'un extra est sélectionné pour un jour de la semaine suivante.
  const ensureNextExtraSelectedForDay = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const cur = nextExtraSelections[iso] || nextExtraSelections[key] || [];
    if (cur.includes(extraId)) return;
    const updated = { ...nextExtraSelections };
    if (iso) updated[iso] = [...cur, extraId];
    else updated[key] = [...cur, extraId];
    setPreference.mutate({ key: 'next_week_extra_selections', value: updated });
  };

  // Assigne un extra à un créneau précis pour la semaine suivante.
  const assignNextExtraToDaySlot = (
    extraId: string,
    iso: string,
    key: string,
    slot: ExtraDaySlot,
  ) => {
    if (!extraId) return;
    const updatedSel = { ...nextExtraSelections };
    const cur = updatedSel[iso] || updatedSel[key] || [];
    if (!cur.includes(extraId)) {
      updatedSel[iso] = [...cur, extraId];
      delete updatedSel[key];
    }
    const selectedForDay = updatedSel[iso] || updatedSel[key] || [];
    const occurrenceCount = Math.max(1, selectedForDay.filter((id) => id === extraId).length);
    const assignments = assignExtraToDaySlotMap(
      nextExtraSlotAssignments,
      extraId,
      iso,
      key,
      slot,
      occurrenceCount,
    );
    setPreference.mutate({ key: 'next_week_extra_selections', value: updatedSel });
    setPreference.mutate({ key: 'next_week_extra_slot_assignments', value: assignments });
  };

  // Retire un extra de tous les créneaux d'un jour (semaine suivante).
  const unassignNextExtraFromAllDaySlots = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const updated = unassignExtraFromAllDaySlotsMap(nextExtraSlotAssignments, extraId, iso, key);
    setPreference.mutate({ key: 'next_week_extra_slot_assignments', value: updated });
  };

  // Désélectionne complètement un extra du jour pour la semaine suivante.
  const deselectNextExtraForDay = async (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const updatedSel = { ...nextExtraSelections };
    const cur = updatedSel[iso] || updatedSel[key] || [];
    const dessert = singleIngredientDessertById.get(extraId);
    const matchingIds = dessert
      ? cur.filter((id) =>
          id === extraId ||
          resolveDessertCatalogId(id, allSingleIngredientDessertExtras, singleIngredientDessertById) === extraId,
        )
      : cur.filter((id) => id === extraId);
    const count = matchingIds.length;
    if (singleIngredientDessertById.has(extraId) && count > 0) {
      for (let i = 0; i < count; i++) {
        await applyDessertExtraStockDelta(extraId, -1, iso, key);
      }
    }
    const removeSet = new Set(matchingIds);
    const next = cur.filter((id) => !removeSet.has(id));
    if (iso) updatedSel[iso] = next;
    else updatedSel[key] = next;
    delete updatedSel[key];
    setPreference.mutate({ key: 'next_week_extra_selections', value: updatedSel });
    for (const id of new Set([...matchingIds, extraId])) {
      unassignNextExtraFromAllDaySlots(id, iso, key);
    }
  };

  /**
   * Ajoute une occurrence d'extra en semaine prochaine et déduit le stock dessert si applicable.
   */
  const addNextWeekExtraOccurrence = async (extraId: string, iso: string, key: string): Promise<boolean> => {
    let snapshotStore: Record<string, Record<string, FoodItem[][]>> | undefined;
    if (singleIngredientDessertById.has(extraId)) {
      const { ok, snapshots } = await applyDessertExtraStockDelta(extraId, 1, iso, key, { persistSnapshot: false });
      if (!ok) return false;
      if (snapshots?.length) {
        snapshotStore = buildDessertExtraSnapshotStoreAfterPush(extraId, iso, key, snapshots);
      }
    }
    const current = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
    const updated = { ...current };
    updated[iso] = [...(updated[iso] || updated[key] || []), extraId];
    delete updated[key];
    await persistExtraSelectionAndSnapshot('next_week_extra_selections', updated, snapshotStore);
    return true;
  };

  /**
   * Retire une occurrence d'extra en semaine prochaine et restaure le stock dessert si applicable.
   */
  const removeOneNextWeekExtraOccurrence = async (extraId: string, iso: string, key: string) => {
    const currentPrefs = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
    const current = currentPrefs[iso] || currentPrefs[key] || [];
    const dessert = singleIngredientDessertById.get(extraId);
    const storedId = dessert
      ? findStoredSelectionIdForDessert(current, dessert, allSingleIngredientDessertExtras, singleIngredientDessertById)
      : extraId;
    if (!storedId || !current.includes(storedId)) return;
    if (singleIngredientDessertById.has(extraId)) {
      await applyDessertExtraStockDelta(extraId, -1, iso, key);
    }
    const updated = removeOneExtraOccurrenceForDay(currentPrefs, iso, key, storedId);
    setPreference.mutate({ key: 'next_week_extra_selections', value: updated });
    const remaining = (updated[iso] || updated[key] || []).filter((id) => {
      if (!dessert) return id === storedId;
      return id === storedId || resolveDessertCatalogId(id, allSingleIngredientDessertExtras, singleIngredientDessertById) === extraId;
    }).length;
    if (remaining <= 0) {
      for (const id of new Set([storedId, extraId])) {
        unassignNextExtraFromAllDaySlots(id, iso, key);
      }
    }
  };

  // Déplace un extra entre deux jours/créneaux pour la semaine suivante.
  const moveNextExtraBetweenDaysToSlot = (
    extraId: string,
    sourceIso: string,
    sourceKey: string,
    targetIso: string,
    targetKey: string,
    targetSlot: ExtraDaySlot,
  ) => {
    if (!extraId) return;
    const { selections: nextSelections, assignments: nextAssignments } = moveExtraBetweenDaysToSlotMaps(
      nextExtraSelections,
      nextExtraSlotAssignments,
      extraId,
      sourceIso,
      sourceKey,
      targetIso,
      targetKey,
      targetSlot,
    );
    setPreference.mutate({ key: 'next_week_extra_selections', value: nextSelections });
    setPreference.mutate({ key: 'next_week_extra_slot_assignments', value: nextAssignments });
  };

  // Gère le dépôt dans un créneau de la semaine suivante (repas planifié ou extra).
  const handleNextWeekDrop = (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) {
      // Goûter : même persistance que midi/soir (plus d’override d’affichage seul)
      assignPmToPlanningSlot(pmId, day, time);
      return;
    }
    const extraId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
    if (extraId) {
      const iso = day;
      const dayKeyFromIso = weekDates.find((w) => w.iso === iso)?.key || '';
      const origin = draggedSelectedExtraOrigin;
      if (isExtraDaySlot(time)) {
        if (origin && origin.iso && origin.iso !== iso) {
          moveNextExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, iso, dayKeyFromIso, time);
        } else {
          assignNextExtraToDaySlot(extraId, iso, dayKeyFromIso, time);
        }
      }
      setDraggedSelectedExtraId(null);
      setDraggedSelectedExtraOrigin(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) {
      // Goûter : même persistance que midi/soir (plus d’override d’affichage seul)
      assignPmToPlanningSlot(pmId, day, time);
      return;
    }
    // Drop d’un extra sélectionné dans ce créneau (matin/midi/goûter/soir).
    const extraId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
    if (extraId && isExtraDaySlot(time)) {
      const iso = day;
      const dayKeyFromIso = weekDates.find(w => w.iso === iso)?.key || '';
      const origin = draggedSelectedExtraOrigin;
      if (origin && origin.iso && origin.iso !== iso) {
        moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, iso, dayKeyFromIso, time);
      } else {
        assignExtraToDaySlot(extraId, iso, dayKeyFromIso, time);
      }
      setDraggedSelectedExtraId(null);
      setDraggedSelectedExtraOrigin(null);
    }
  };

  const handleDropOnCard = (e: React.DragEvent, targetPm: PossibleMeal) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotDragOver(null);
    const extraId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
    if (extraId) {
      const targetDay = targetPm.day_of_week;
      const targetTime = targetPm.meal_time;
      if (targetDay && isExtraDaySlot(targetTime)) {
        const dayKeyFromIso = weekDates.find(w => w.iso === targetDay)?.key || '';
        const origin = draggedSelectedExtraOrigin;
        if (origin && origin.iso && origin.iso !== targetDay) {
          moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, targetDay, dayKeyFromIso, targetTime);
        } else {
          assignExtraToDaySlot(extraId, targetDay, dayKeyFromIso, targetTime);
        }
        setDraggedSelectedExtraId(null);
        setDraggedSelectedExtraOrigin(null);
      }
      return;
    }
    const draggedPmId = e.dataTransfer.getData("pmId");
    if (!draggedPmId || draggedPmId === targetPm.id) return;

    const targetVisual = getVisualSlotForPm(targetPm);
    const targetDay = targetVisual.day || targetPm.day_of_week!;
    const targetTime = targetVisual.time || targetPm.meal_time!;
    const draggedPm = possibleMeals.find(p => p.id === draggedPmId);

    // Si la carte vient d'un autre créneau ou est non planifiée, mettre d'abord à jour sa planification
    if (!draggedPm || draggedPm.day_of_week !== targetDay || draggedPm.meal_time !== targetTime) {
      assignPmToPlanningSlot(draggedPmId, targetDay, targetTime);
    }

    const slot = getMealsForSlot(targetDay, targetTime);
    const filtered = slot.filter((p) => p.id !== draggedPmId);
    const targetIdx = filtered.findIndex((p) => p.id === targetPm.id);
    const insertAt = targetIdx === -1 ? filtered.length : targetIdx;
    filtered.splice(insertAt, 0, { id: draggedPmId } as PossibleMeal);
    reorderPossibleMeals.mutate(filtered.map((p, i) => ({ id: p.id, sort_order: i })));
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) clearPmPlanningSlot(pmId);
  };

  /** Retire une carte d’un créneau via le bouton × de la mini-carte. */
  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    clearPmPlanningSlot(pm.id);
  };

  const renderMiniCard = (pm: PossibleMeal, compact = false, hideIngredients = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const displayIngredients = pm.ingredients_override ?? meal.ingredients;
    const mealForAnalysis = { ...meal, ingredients: displayIngredients };
    const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);

    // Badge = valeur figée (prefs) uniquement — plus de calcul live Aliments.
    const frozenCounterDays = readFrozenPossibleCounterDays(frozenCounterDaysByPmId, pm.id);
    const counterDays = frozenCounterDays !== undefined ? frozenCounterDays : null;
    const counterBadgeTitle = formatFrozenPossibleCounterTooltip(frozenCounterDays);
    const counterUrgent = counterDays !== null && counterDays >= 3;

    const expiredIngs = analysis.expiredIngredientNames;
    const soonIngs = analysis.expiringSoonIngredientNames;

    const overrideCal = parsePositivePlanningOverride(calOverrides[pm.id]);
    const plannedDayIso = resolvePlannedDayIso(pm.day_of_week, weekDates);
    const expired = isExpiredOnPlannedDay(pm.expiration_date, plannedDayIso);

    // Utiliser la détection de ratio partagée
    let displayMeal = meal;
    const detectedRatio = getOverrideScaleRatio(meal, pm.ingredients_override);
    if (detectedRatio !== null && meal.grams) {
      const baseG = parseFloat(meal.grams.replace(/[^0-9.]/g, '')) || 0;
      if (baseG > 0) {
        displayMeal = { ...meal, grams: String(Math.round(baseG * detectedRatio)) };
      }
    }

    // Utiliser le même calcul que la carte "possible" : macros de la portion visible, pas du total #quantity.
    const rawCalNum = overrideCal ?? getDisplayedPMCalories(pm, detectedRatio ?? undefined, isAvailableCb);
    const displayCal = rawCalNum ? String(Math.round(rawCalNum)) : null;
    const overridePro = parsePositivePlanningOverride(proOverrides[pm.id]);
    const rawProNum = overridePro ?? getDisplayedPMProtein(pm, detectedRatio ?? undefined, isAvailableCb, foodItems, foodMacroIndex);
    const displayPro = rawProNum ? String(Math.round(rawProNum)) : null;
    const rawFiberNum = getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex);
    const displayFiber = rawFiberNum ? String(Math.round(rawFiberNum)) : null;

    return (
      <PlanningMiniCard
        key={pm.id}
        pm={pm}
        meal={displayMeal}
        expired={expired}
        expiredIngredientNames={expiredIngs}
        expiringSoonIngredientNames={soonIngs}
        counterDays={counterDays}
        counterBadgeTitle={counterBadgeTitle}
        counterUrgent={counterUrgent}
        isPast={(() => {
          if (!pm.day_of_week) return false;
          const target = getDateForDayKey(pm.day_of_week, new Date());
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return target.getTime() < today.getTime();
        })()}
        displayCal={displayCal}
        displayPro={displayPro}
        displayFiber={displayFiber}
        compact={compact}
        hideIngredients={hideIngredients}
        hideCalorieDisplay={hideDayCalorieTotals}
        isTouchDevice={isTouchDevice}
        touchDragActive={touchDragActive}
        slotDragOver={slotDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("pmId", pm.id);
          e.dataTransfer.setData("mealId", pm.meal_id);
          e.dataTransfer.setData("source", "planning-slot");
          slotDragRef.current = { pmId: pm.id, slotKey: `${pm.day_of_week}-${pm.meal_time}` };
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSlotDragOver(pm.id);
        }}
        onDragLeave={() => setSlotDragOver(null)}
        onDrop={(e) => handleDropOnCard(e, pm)}
        onTouchStart={(e) => handleTouchStart(e, pm)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onRemove={() => handleRemoveFromSlot(pm)}
        onCalorieChange={(val) => {
          const updated = { ...calOverrides };
          if (parsePositivePlanningOverride(val) !== null) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_cal_overrides', value: updated });
        }}
        onProteinChange={(val) => {
          const updated = { ...proOverrides };
          if (parsePositivePlanningOverride(val) !== null) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_pro_overrides', value: updated });
        }}
        onDoubleClick={() => openPlanningCardPopup(pm)}
        stockMap={stockMap}
      />
    );
  };

  const weekTotal = weekDates.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);

  const repairedDailyCalorieHistory = useMemo(() => {
    const previousWeekDates = buildWeekDates(-1, new Date());
    const backupRaw = getPreference<unknown>("possible_meals_backup", null);
    const backupCtx = parseBackupCalorieContext(backupRaw, calOverrides, proOverrides);
    const backupFull =
      backupRaw && typeof backupRaw === "object" && !Array.isArray(backupRaw)
        ? (backupRaw as PossibleMealsFullBackup)
        : null;
    return ensurePreviousWeekCalorieHistory(
      asNumberRecord(getPreference<unknown>(PLANNING_DAILY_CALORIE_HISTORY_KEY, null)),
      backupFull,
      backupCtx,
      previousWeekDates,
      allMealsById,
      foodItems,
      dessertFoodItemIds,
      dessertExtraStockSnapshots,
      ingredientMacroLibrary,
      isAvailableCb,
    );
  }, [
    getPreference,
    calOverrides,
    proOverrides,
    allMealsById,
    foodItems,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    isAvailableCb,
  ]);

  useEffect(() => {
    const stored = asNumberRecord(getPreference<unknown>(PLANNING_DAILY_CALORIE_HISTORY_KEY, null));
    const changed = JSON.stringify(stored) !== JSON.stringify(repairedDailyCalorieHistory);
    if (!changed) return;
    setPreference.mutate({ key: PLANNING_DAILY_CALORIE_HISTORY_KEY, value: repairedDailyCalorieHistory });
  }, [getPreference, repairedDailyCalorieHistory, setPreference]);

  const rollingCalorieStats = useMemo(() => {
    const currentWeekIsos = new Set(buildWeekDates(0, new Date()).map((d) => d.iso));
    const backupRaw = getPreference<unknown>("possible_meals_backup", null);
    const backupCtx = parseBackupCalorieContext(backupRaw, calOverrides, proOverrides);
    const backupFull =
      backupRaw && typeof backupRaw === "object" && !Array.isArray(backupRaw)
        ? (backupRaw as PossibleMealsFullBackup)
        : null;
    const rollingParams = {
      getLiveDayCalories: getDayCalories,
      currentWeekIsos,
      dailyCalorieHistory: repairedDailyCalorieHistory,
      backupCtx,
      backupWeekRange: resolveBackupWeekRange(backupFull),
      mealsById: allMealsById,
      foodItems,
      isAvailable: isAvailableCb,
      foodMacroIndex,
      extraMacroParams: {
        dessertFoodItemIds,
        dessertExtraStockSnapshots,
        macroLibrary: ingredientMacroLibrary,
      },
    };
    const rolling7 = computeRollingDayCalorieAverage({
      ...rollingParams,
      rollingDays: ROLLING_WINDOW_7_DAYS,
    });
    const rolling14 = computeRollingDayCalorieAverage({
      ...rollingParams,
      rollingDays: ROLLING_WINDOW_14_DAYS,
    });
    return {
      rolling7DayAvg: rolling7.average,
      rolling7DaysCounted: rolling7.daysCounted,
      rolling14DayAvg: rolling14.average,
      rolling14DaysCounted: rolling14.daysCounted,
    };
  }, [
    getDayCalories,
    getPreference,
    calOverrides,
    proOverrides,
    allMealsById,
    foodItems,
    isAvailableCb,
    foodMacroIndex,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    repairedDailyCalorieHistory,
  ]);

  const {
    rolling7DayAvg,
    rolling7DaysCounted,
    rolling14DayAvg,
    rolling14DaysCounted,
  } = rollingCalorieStats;

  const handleGlobalCalBlur = (val: number) => {
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_daily_goal", value: val });
    else {
      setPreference.mutate({ key: "planning_daily_goal", value: val });
      setPreference.mutate({ key: "next_week_daily_goal", value: val });
    }
  };

  /**
   * Enregistre la borne basse de la fourchette calorique (semaine courante et brouillon suivant).
   * Validation souple : 0 (ou vide) désactive la fourchette ; sinon la borne basse est bornée
   * à la borne haute pour ne jamais la dépasser.
   */
  const handleGlobalCalLowBlur = (val: number) => {
    const currentHigh = weekOffset === 1 ? NEXT_DAILY_GOAL : DAILY_GOAL;
    const clamped = val && val > 0 ? Math.min(val, currentHigh) : 0;
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_daily_goal_low", value: clamped });
    else {
      setPreference.mutate({ key: "planning_daily_goal_low", value: clamped });
      setPreference.mutate({ key: "next_week_daily_goal_low", value: clamped });
    }
  };

  const handleGlobalProtBlur = (val: number) => {
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_protein_goal", value: val });
    else {
      setPreference.mutate({ key: "planning_protein_goal", value: val });
      setPreference.mutate({ key: "next_week_protein_goal", value: val });
    }
  };

  /** Enregistre l'objectif fibre global pour la semaine courante et le brouillon semaine prochaine. */
  const handleGlobalFiberBlur = (val: number) => {
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_fiber_goal", value: val });
    else {
      setPreference.mutate({ key: "planning_fiber_goal", value: val });
      setPreference.mutate({ key: "next_week_fiber_goal", value: val });
    }
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-3 overflow-x-hidden planning-responsive ${touchDragActive ? "touch-none" : ""}`}>
      {(touchPressPending || touchDragActive || touchCancelHint) && (
        <div
          className="fixed bottom-4 left-1/2 z-[10000] -translate-x-1/2 pointer-events-none px-3 py-1.5 rounded-full text-[11px] font-semibold shadow-lg border backdrop-blur-sm"
          style={{
            background: touchCancelHint
              ? "rgba(120,40,40,0.88)"
              : touchDragActive
                ? "rgba(30,30,30,0.88)"
                : "rgba(40,40,60,0.85)",
            color: "#fff",
            borderColor: "rgba(255,255,255,0.2)",
          }}
          role="status"
        >
          {touchCancelHint
            ? touchCancelHint
            : touchDragActive
              ? "Relâche sur un créneau · Escape pour annuler"
              : "Maintenir pour déplacer"}
        </div>
      )}
      <PlanningHeader
        weekOffset={weekOffset}
        onWeekOffsetChange={setWeekOffset}
        manualResetBusy={manualResetBusy}
        onManualReset={handleManualReset}
        restoreBusy={restoreBusy}
        onRestoreBackup={handleRestoreBackup}
        dailyGoal={DAILY_GOAL}
        dailyGoalLow={DAILY_GOAL_LOW}
        nextDailyGoal={NEXT_DAILY_GOAL}
        nextDailyGoalLow={NEXT_DAILY_GOAL_LOW}
        dailyProteinGoal={DAILY_PROTEIN_GOAL_PREF}
        nextProteinGoal={NEXT_PROTEIN_GOAL}
        dailyFiberGoal={DAILY_FIBER_GOAL_PREF}
        nextFiberGoal={NEXT_FIBER_GOAL}
        onGlobalCalBlur={handleGlobalCalBlur}
        onGlobalCalLowBlur={handleGlobalCalLowBlur}
        onGlobalProtBlur={handleGlobalProtBlur}
        onGlobalFiberBlur={handleGlobalFiberBlur}
        backupTotals={backupTotals}
      />

      {weekOffset === 0 ? (<>
        {weekDates.map(({ key, iso, display }) => {
          const isToday_ = iso === todayISO;
          const dayCalories = getDayCalories(key, iso);
          const dayFiber = getDayFiber(key, iso);
          const matinMeals = getMealsForSlot(key, 'matin', iso);
          const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
          const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb, foodItems, foodMacroIndex), 0);
          const matinFiber = matinMeals.reduce((s, pm) => s + getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);

          const breakfast = getBreakfastForDay(key, iso);
          let baseBreakfastCals = 0;
          let baseBreakfastPro = 0;
          let baseBreakfastFiber = 0;
          if (breakfast) {
            const selId = (iso && breakfastSelections[iso]) || undefined;
            if (selId?.startsWith('pm:')) {
              const pmId = selId.slice(3);
              const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
              const isAlsoMatin = possiblePdj && (possiblePdj.day_of_week === key || possiblePdj.day_of_week === iso) && possiblePdj.meal_time === 'matin';
              if (isAlsoMatin) {
                baseBreakfastCals = 0;
                baseBreakfastPro = 0;
                baseBreakfastFiber = 0;
              } else {
                baseBreakfastCals = possiblePdj ? getCardDisplayCalories(possiblePdj, calOverrides[possiblePdj.id], isAvailableCb) : parseCalories(breakfast.calories);
                baseBreakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj, proOverrides[possiblePdj.id], isAvailableCb, foodItems, foodMacroIndex) : parseProtein(breakfast.protein);
                baseBreakfastFiber = possiblePdj ? getCardDisplayFiber(possiblePdj, undefined, isAvailableCb, foodItems, foodMacroIndex) : getMealFiber(breakfast, undefined, undefined, undefined, foodItems, foodMacroIndex) ?? 0;
              }
            } else {
              baseBreakfastCals = getMealCal(breakfast);
              baseBreakfastPro = getMealPro(breakfast);
              baseBreakfastFiber = getMealFiber(breakfast, undefined, undefined, undefined, foodItems, foodMacroIndex) ?? 0;
            }
          } else {
            baseBreakfastCals = (iso && breakfastManualCalories[iso]) || 0;
            baseBreakfastPro = (iso && breakfastManualProteins[iso]) || 0;
          }

          const breakfastAssignedIds =
            extraSlotAssignments[`${iso}-matin`] ?? extraSlotAssignments[`${key}-matin`] ?? [];
          const breakfastAssigned = sumDayExtras(breakfastAssignedIds);
          const breakfastTotalCals = baseBreakfastCals + matinCals + breakfastAssigned.cal;
          const breakfastTotalPro = baseBreakfastPro + matinPro + breakfastAssigned.pro;
          const breakfastTotalFiber = baseBreakfastFiber + matinFiber + breakfastAssigned.fiber;
          const gouterAssignedIds =
            extraSlotAssignments[`${iso}-gouter`] ?? extraSlotAssignments[`${key}-gouter`] ?? [];
          const gouterAssigned = sumDayExtras(gouterAssignedIds);
          const gouterMeals = getMealsForSlot(key, 'gouter', iso);
          const gouterMealCals = gouterMeals.reduce((sum, pm) => sum + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
          const gouterMealPro = gouterMeals.reduce((sum, pm) => sum + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb, foodItems, foodMacroIndex), 0);
          const gouterMealFiber = gouterMeals.reduce((sum, pm) => sum + getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);
          const hasGouterMeals = gouterMeals.length > 0;
          const gouterManualCal = manualCalories[`${iso}-gouter`] || 0;
          const gouterManualPro = manualProteins[`${iso}-gouter`] || 0;
          const gouterManualFiber = manualFibers[`${iso}-gouter`] || 0;
          const effectiveGouterManualCal = hasGouterMeals ? 0 : gouterManualCal;
          const effectiveGouterManualPro = hasGouterMeals ? 0 : gouterManualPro;
          const effectiveGouterManualFiber = hasGouterMeals ? 0 : gouterManualFiber;
          const gouterDrink = Boolean(drinkChecks[`${iso}-gouter`] || drinkChecks[`${key}-gouter`]);
          const gouterTotalCals = effectiveGouterManualCal + gouterAssigned.cal + gouterMealCals + (gouterDrink ? DRINK_CALORIES : 0);
          const gouterTotalPro = effectiveGouterManualPro + gouterAssigned.pro + gouterMealPro;
          const gouterTotalFiber = effectiveGouterManualFiber + gouterAssigned.fiber + gouterMealFiber;

          const breakfastDropKey = `${iso}-matin`;
          const isBreakfastDragOver = dragOverSlot === breakfastDropKey || dragOverSlot === `${key}-matin`;
          const breakfastAssignedSlotIds =
            extraSlotAssignments[breakfastDropKey] ?? extraSlotAssignments[`${key}-matin`] ?? [];
          const liveBreakfastBreakdown = buildLiveBreakfastBreakdownItems({
            key,
            iso,
            matinMeals,
            breakfast,
            breakfastSelections,
            possibleMeals,
            calOverrides,
            proOverrides,
            breakfastManualCalories,
            breakfastManualProteins,
            breakfastAssignedIds: breakfastAssignedSlotIds,
            foodItems,
            isAvailable: isAvailableCb,
            foodMacroIndex,
            getMealCal,
            getMealPro,
          });
          return (
            <PlanningDayColumn
              key={iso}
              dayIso={iso}
              display={display}
              isToday={isToday_}
              columnRef={isToday_ ? todayRef : undefined}
              breakfastBlock={(
                <PlanningBreakfastBlock
                  dayKey={key}
                  dayIso={iso}
                  isBreakfastDragOver={isBreakfastDragOver}
                  breakfastDropKey={breakfastDropKey}
                  liveBreakfastBreakdown={liveBreakfastBreakdown}
                  breakfastTotalCals={breakfastTotalCals}
                  breakfastTotalPro={breakfastTotalPro}
                  breakfastTotalFiber={breakfastTotalFiber}
                  hideDayCalorieTotals={hideDayCalorieTotals}
                  breakfastSelections={breakfastSelections}
                  breakfastManualCalories={breakfastManualCalories}
                  breakfastManualProteins={breakfastManualProteins}
                  autoConsumeBreakfast={autoConsumeBreakfast}
                  possiblePetitDej={possiblePetitDej}
                  petitDejMeals={petitDejMeals}
                  weekDates={weekDates}
                  matinMeals={matinMeals}
                  breakfastAssignedSlotIds={breakfastAssignedSlotIds}
                  foodItems={foodItems}
                  singleIngredientDessertById={singleIngredientDessertById}
                  dessertCatalog={allSingleIngredientDessertExtras}
                  dessertPossibleCountById={dessertPossibleCountById}
                  savedSnapshots={savedSnapshots}
                  flashedKeys={flashedKeys}
                  setFlashedKeys={setFlashedKeys}
                  weekOffset={weekOffset}
                  nextBreakfastSelections={nextBreakfastSelections}
                  nextBreakfastManualCalories={nextBreakfastManualCalories}
                  nextBreakfastManualProteins={nextBreakfastManualProteins}
                  jsDayToKey={JS_DAY_TO_KEY}
                  draggedSelectedExtraId={draggedSelectedExtraId}
                  draggedSelectedExtraOrigin={draggedSelectedExtraOrigin}
                  setDragOverSlot={setDragOverSlot}
                  setDraggedSelectedExtraId={setDraggedSelectedExtraId}
                  setDraggedSelectedExtraOrigin={setDraggedSelectedExtraOrigin}
                  moveExtraBetweenDaysToSlot={moveExtraBetweenDaysToSlot}
                  assignExtraToDaySlot={assignExtraToDaySlot}
                  getBreakfastForDay={getBreakfastForDay}
                  setPopupBreakfast={setPopupBreakfast}
                  setBreakfastForDay={setBreakfastForDay}
                  updatePlanningWithCounters={updatePlanningWithCounters}
                  setPreference={setPreference}
                  getMealCal={getMealCal}
                  getMealPro={getMealPro}
                  deselectExtraForDay={deselectExtraForDay}
                />
              )}
              goalsBar={(
                <PlanningDayGoalsBar
                  dayCalories={dayCalories}
                  dayProtein={getDayProtein(key, iso)}
                  dayFiber={dayFiber}
                  dailyGoal={DAILY_GOAL}
                  dailyGoalLow={DAILY_GOAL_LOW}
                  dailyProteinGoal={DAILY_PROTEIN_GOAL_PREF}
                  dailyFiberGoal={DAILY_FIBER_GOAL_PREF}
                  hideDayCalorieTotals={hideDayCalorieTotals}
                  editingGoal={editingGoal}
                  goalInput={goalInput}
                  editingProteinGoal={editingProteinGoal}
                  proteinGoalInput={proteinGoalInput}
                  editingFiberGoal={editingFiberGoal}
                  fiberGoalInput={fiberGoalInput}
                  onStartEditGoal={() => { setEditingGoal(true); setGoalInput(String(DAILY_GOAL)); }}
                  onGoalInputChange={setGoalInput}
                  onGoalBlur={() => {
                    const val = parseInt(goalInput);
                    if (val && val > 0) {
                      setPreference.mutate({ key: 'planning_daily_goal', value: val });
                      setPreference.mutate({ key: 'next_week_daily_goal', value: val });
                    }
                    setEditingGoal(false);
                  }}
                  onGoalCancel={() => setEditingGoal(false)}
                  onStartEditProteinGoal={() => { setEditingProteinGoal(true); setProteinGoalInput(String(DAILY_PROTEIN_GOAL_PREF)); }}
                  onProteinGoalInputChange={setProteinGoalInput}
                  onProteinGoalBlur={() => {
                    const val = parseInt(proteinGoalInput);
                    if (val && val > 0) {
                      setPreference.mutate({ key: 'planning_protein_goal', value: val });
                      setPreference.mutate({ key: 'next_week_protein_goal', value: val });
                    }
                    setEditingProteinGoal(false);
                  }}
                  onProteinGoalCancel={() => setEditingProteinGoal(false)}
                  onStartEditFiberGoal={() => { setEditingFiberGoal(true); setFiberGoalInput(String(DAILY_FIBER_GOAL_PREF)); }}
                  onFiberGoalInputChange={setFiberGoalInput}
                  onFiberGoalBlur={() => {
                    const val = parseInt(fiberGoalInput);
                    if (val && val > 0) handleGlobalFiberBlur(val);
                    setEditingFiberGoal(false);
                  }}
                  onFiberGoalCancel={() => setEditingFiberGoal(false)}
                />
              )}
              mainGrid={(
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 sm:gap-3">
                {MAIN_GRID_TIMES.map((time) => {
                  const slotKey = `${iso}-${time}`;
                  const slotMeals = getMealsForSlot(key, time, iso);
                  const slotAssignedIds =
                    extraSlotAssignments[`${iso}-${time}`] ?? extraSlotAssignments[`${key}-${time}`] ?? [];
                  const isOver = dragOverSlot === slotKey || touchHighlight === slotKey || dragOverSlot === `${key}-${time}` || touchHighlight === `${key}-${time}`;
                  const slotCalsMeals = slotMeals.reduce((s, p) => s + getCardDisplayCalories(p, calOverrides[p.id], isAvailableCb), 0);
                  const slotProMeals = slotMeals.reduce((s, p) => s + getCardDisplayProtein(p, proOverrides[p.id], isAvailableCb, foodItems, foodMacroIndex), 0);
                  const slotFiberMeals = slotMeals.reduce((s, p) => s + getCardDisplayFiber(p, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);
                  const slotAssigned = sumDayExtras(slotAssignedIds);
                  const slotDrink = Boolean(drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`]);
                  // Sans carte repas : total = inputs manuels + extras (+ boisson).
                  // Avec cartes : total = cartes + extras (+ boisson) — les inputs sont masqués.
                  const hasSlotMeals = slotMeals.length > 0;
                  const slotManualCal = hasSlotMeals
                    ? 0
                    : (pickPlanningSlotValue(manualCalories, iso, key, time) ?? 0);
                  const slotManualPro = hasSlotMeals
                    ? 0
                    : (pickPlanningSlotValue(manualProteins, iso, key, time) ?? 0);
                  const slotManualFiber = hasSlotMeals
                    ? 0
                    : (pickPlanningSlotValue(manualFibers, iso, key, time) ?? 0);
                  const slotCals = slotCalsMeals + slotManualCal + slotAssigned.cal + (slotDrink ? DRINK_CALORIES : 0);
                  const slotPro = slotProMeals + slotManualPro + slotAssigned.pro;
                  const slotFiber = slotFiberMeals + slotManualFiber + slotAssigned.fiber;
                  return (
                    <PlanningSlotSection
                      key={time}
                      dayKey={key}
                      dayIso={iso}
                      time={time}
                      isOver={isOver}
                      slotDrink={slotDrink}
                      hideDayCalorieTotals={hideDayCalorieTotals}
                      hasSlotMeals={hasSlotMeals}
                      slotCalories={slotCals}
                      slotProteins={slotPro}
                      slotFibers={slotFiber}
                      manualCalories={manualCalories[`${iso}-${time}`] || 0}
                      manualProteins={manualProteins[`${iso}-${time}`] || 0}
                      manualFibers={manualFibers[`${iso}-${time}`] || 0}
                      slotAssignedIds={slotAssignedIds}
                      foodItems={foodItems}
                      dessertById={singleIngredientDessertById}
                      dessertCatalog={allSingleIngredientDessertExtras}
                      dessertPossibleCountById={dessertPossibleCountById}
                      snapshotFlashed={!!flashedKeys[`manual-${iso}-${time}`]}
                      snapshotSaved={!!(savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`])}
                      snapshotTitle={formatPlanningSnapshotTitle(savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`])}
                      mealCards={slotMeals.map((pm) => renderMiniCard(pm, false, time === 'midi' || time === 'soir'))}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSlot(slotKey);
                      }}
                      onDragLeave={() => setDragOverSlot(null)}
                      onDrop={(e) => handleDrop(e, iso, time)}
                      onToggleDrink={() => {
                        const updated = { ...drinkChecks };
                        if (updated[`${iso}-${time}`]) delete updated[`${iso}-${time}`];
                        else if (updated[`${key}-${time}`]) delete updated[`${key}-${time}`];
                        else updated[`${iso}-${time}`] = true;
                        setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                      }}
                      onSaveManualCalories={(val) => {
                        const updated = { ...manualCalories };
                        if (val > 0) updated[`${iso}-${time}`] = val;
                        else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                        setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                      }}
                      onSaveManualProteins={(val) => {
                        const updated = { ...manualProteins };
                        if (val > 0) updated[`${iso}-${time}`] = val;
                        else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                        setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                      }}
                      onSaveManualFibers={(val) => {
                        const updated = { ...manualFibers };
                        if (val > 0) updated[`${iso}-${time}`] = val;
                        else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                        setPreference.mutate({ key: 'planning_manual_fibers', value: updated });
                      }}
                      onSaveSnapshot={() => {
                        const snapKey = `manual-${iso}-${time}`;
                        const cal = manualCalories[`${iso}-${time}`] || 0;
                        const prot = manualProteins[`${iso}-${time}`] || 0;
                        const fiber = manualFibers[`${iso}-${time}`] || 0;
                        const cleaned = clearWeekdayScopedSnapshots(savedSnapshots, "manual", iso, key, JS_DAY_TO_KEY, time);
                        const updated = { ...cleaned, [snapKey]: { cal, prot, fiber, savedAt: Date.now() } };
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                        if (weekOffset === 0) {
                          const kKeySlot = `${key}-${time}`;
                          if (cal > 0) {
                            const nxtCal = { ...nextManualCalories };
                            nxtCal[kKeySlot] = cal;
                            setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                          }
                          if (prot > 0) {
                            const nxtPro = { ...nextManualProteins };
                            nxtPro[kKeySlot] = prot;
                            setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                          }
                          if (fiber > 0) {
                            const nxtFiber = { ...nextManualFibers };
                            nxtFiber[kKeySlot] = fiber;
                            setPreference.mutate({ key: 'next_week_manual_fibers', value: nxtFiber });
                          }
                          if (drinkChecks[`${iso}-${time}`]) {
                            const nxtDrk = { ...nextDrinkChecks };
                            nxtDrk[kKeySlot] = true;
                            setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                          }
                        }
                        setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                        setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                      }}
                      onClearSnapshot={() => {
                        const updated = clearWeekdayScopedSnapshots(savedSnapshots, "manual", iso, key, JS_DAY_TO_KEY, time);
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                        if (weekOffset === 0) {
                          const kKeySlot = `${key}-${time}`;
                          const kIsoSlot = `${iso}-${time}`;
                          const nxtCal = { ...nextManualCalories }; delete nxtCal[kKeySlot]; delete nxtCal[kIsoSlot];
                          setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                          const nxtPro = { ...nextManualProteins }; delete nxtPro[kKeySlot]; delete nxtPro[kIsoSlot];
                          setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                          const nxtFiber = { ...nextManualFibers }; delete nxtFiber[kKeySlot]; delete nxtFiber[kIsoSlot];
                          setPreference.mutate({ key: 'next_week_manual_fibers', value: nxtFiber });
                          const nxtDrk = { ...nextDrinkChecks }; delete nxtDrk[kKeySlot]; delete nxtDrk[kIsoSlot];
                          setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                        }
                      }}
                      onDeselectExtra={deselectExtraForDay}
                      onDragStartExtra={(extraId, dayIso, dayKey, e) => {
                        setDraggedSelectedExtraId(extraId);
                        setDraggedSelectedExtraOrigin({ iso: dayIso, key: dayKey });
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', extraId);
                      }}
                      onDragEndExtra={() => {
                        setDraggedSelectedExtraId(null);
                        setDraggedSelectedExtraOrigin(null);
                      }}
                    />
                  );
                })}
                {/* Colonne Extra */}
                <PlanningExtraColumn
                  dayKey={key}
                  dayIso={iso}
                  dragOverSlot={dragOverSlot}
                  setDragOverSlot={setDragOverSlot}
                  draggedSelectedExtraId={draggedSelectedExtraId}
                  setDraggedSelectedExtraId={setDraggedSelectedExtraId}
                  setDraggedSelectedExtraOrigin={setDraggedSelectedExtraOrigin}
                  unassignExtraFromAllDaySlots={unassignExtraFromAllDaySlots}
                  extraCalories={extraCalories}
                  extraProteins={extraProteins}
                  extraFibers={extraFibers}
                  extraSelections={extraSelections}
                  extraSlotAssignments={extraSlotAssignments}
                  setPreference={setPreference}
                  getPreference={getPreference}
                  openExtrasDay={openExtrasDay}
                  setOpenExtrasDay={setOpenExtrasDay}
                  isTouchDevice={isTouchDevice}
                  foodItems={foodItems}
                  testItemIdSet={testItemIdSet}
                  foodSortModes={foodSortModes}
                  sortDirections={sortDirections}
                  extrasDividerAfterId={extrasDividerAfterId}
                  allSingleIngredientDessertExtras={allSingleIngredientDessertExtras}
                  singleIngredientDessertExtras={singleIngredientDessertExtras}
                  singleIngredientDessertById={singleIngredientDessertById}
                  dessertExtraStockSnapshots={dessertExtraStockSnapshots}
                  canAddDessertById={canAddDessertById}
                  dessertPossibleCountById={dessertPossibleCountById}
                  ingredientMacroLibrary={ingredientMacroLibrary}
                  sumDayExtras={sumDayExtras}
                  getAssignedExtraIdsForDayLocal={getAssignedExtraIdsForDayLocal}
                  removeOneSelectedExtraForDay={removeOneSelectedExtraForDay}
                  applyDessertExtraStockDelta={applyDessertExtraStockDelta}
                  buildDessertExtraSnapshotStoreAfterPush={buildDessertExtraSnapshotStoreAfterPush}
                  persistExtraSelectionAndSnapshot={persistExtraSelectionAndSnapshot}
                  savedSnapshots={savedSnapshots}
                  flashedKeys={flashedKeys}
                  setFlashedKeys={setFlashedKeys}
                  weekOffset={weekOffset}
                  nextExtraSelections={nextExtraSelections}
                  nextExtraCalories={nextExtraCalories}
                  nextExtraProteins={nextExtraProteins}
                  nextExtraFibers={nextExtraFibers}
                  nextExtraSlotAssignments={nextExtraSlotAssignments}
                  jsDayToKey={JS_DAY_TO_KEY}
                  selectedExtrasTopByDay={selectedExtrasTopByDay}
                  setSelectedExtrasTopByDay={setSelectedExtrasTopByDay}
                  selectedExtrasMiddleByDay={selectedExtrasMiddleByDay}
                  setSelectedExtrasMiddleByDay={setSelectedExtrasMiddleByDay}
                  selectedExtrasDropZone={selectedExtrasDropZone}
                  setSelectedExtrasDropZone={setSelectedExtrasDropZone}
                  customExtraName={customExtraName}
                  setCustomExtraName={setCustomExtraName}
                  customExtraCal={customExtraCal}
                  setCustomExtraCal={setCustomExtraCal}
                  customExtraProt={customExtraProt}
                  setCustomExtraProt={setCustomExtraProt}
                  customExtraFiber={customExtraFiber}
                  setCustomExtraFiber={setCustomExtraFiber}
                  hideDayCalorieTotals={hideDayCalorieTotals}
                  remainingDayCalories={getRemainingDayCalories(DAILY_GOAL, dayCalories)}
                />
              </div>
              )}
              gouterBand={(
                <PlanningGouterBand
                  dayKey={key}
                  dayIso={iso}
                  isOver={dragOverSlot === `${iso}-gouter` || touchHighlight === `${iso}-gouter`}
                  gouterDrink={gouterDrink}
                  hasGouterMeals={hasGouterMeals}
                  hideDayCalorieTotals={hideDayCalorieTotals}
                  gouterManualCal={gouterManualCal}
                  gouterManualPro={gouterManualPro}
                  gouterManualFiber={gouterManualFiber}
                  gouterTotalCals={gouterTotalCals}
                  gouterTotalPro={gouterTotalPro}
                  gouterTotalFiber={gouterTotalFiber}
                  gouterAssignedIds={gouterAssignedIds}
                  foodItems={foodItems}
                  dessertById={singleIngredientDessertById}
                  dessertCatalog={allSingleIngredientDessertExtras}
                  dessertPossibleCountById={dessertPossibleCountById}
                  mealCards={gouterMeals.map((pm) => (
                    <div key={pm.id} className="inline-block mr-1 [&>div]:min-w-[132px] [&>div]:!px-3 [&>div]:!py-1.5 [&>div]:text-center [&>div>div]:items-center">
                      {renderMiniCard(pm, true)}
                    </div>
                  ))}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSlot(`${iso}-gouter`);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === `${iso}-gouter` ? null : cur))}
                  onDrop={(e) => handleDrop(e, iso, 'gouter')}
                  onToggleDrink={() => {
                    const updated = { ...drinkChecks };
                    if (updated[`${iso}-gouter`]) delete updated[`${iso}-gouter`];
                    else if (updated[`${key}-gouter`]) delete updated[`${key}-gouter`];
                    else updated[`${iso}-gouter`] = true;
                    setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                  }}
                  onSaveManualCalories={(val) => {
                    const updated = { ...manualCalories };
                    if (val > 0) updated[`${iso}-gouter`] = val;
                    else { delete updated[`${iso}-gouter`]; delete updated[`${key}-gouter`]; }
                    setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                  }}
                  onSaveManualProteins={(val) => {
                    const updated = { ...manualProteins };
                    if (val > 0) updated[`${iso}-gouter`] = val;
                    else { delete updated[`${iso}-gouter`]; delete updated[`${key}-gouter`]; }
                    setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                  }}
                  onSaveManualFibers={(val) => {
                    const updated = { ...manualFibers };
                    if (val > 0) updated[`${iso}-gouter`] = val;
                    else { delete updated[`${iso}-gouter`]; delete updated[`${key}-gouter`]; }
                    setPreference.mutate({ key: 'planning_manual_fibers', value: updated });
                  }}
                  onDeselectExtra={deselectExtraForDay}
                  onDragStartExtra={(extraId, dayIso, dayKey, e) => {
                    setDraggedSelectedExtraId(extraId);
                    setDraggedSelectedExtraOrigin({ iso: dayIso, key: dayKey });
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', extraId);
                  }}
                  onDragEndExtra={() => {
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                  }}
                />
              )}
            />
          );
        })}
        {/* Total calorique de la semaine */}
        {(() => {
          const todayIndexNum = weekDates.findIndex(d => d.iso === todayISO);
          const datesUpToToday = todayIndexNum >= 0 ? weekDates.slice(0, todayIndexNum + 1) : [];
          const totalUpToToday = datesUpToToday.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);
          const avgCal = datesUpToToday.length > 0 ? Math.round(totalUpToToday / datesUpToToday.length) : 0;
          return (
            <PlanningWeekTotalsFooter
              title="Total semaine"
              weekTotal={weekTotal}
              avgCal={avgCal}
              avgDaysLabel={`${datesUpToToday.length}j`}
              goalLow={DAILY_GOAL_LOW}
              goalHigh={DAILY_GOAL}
              displayGoalLow={WEEKLY_GOAL_LOW}
              displayGoalHigh={WEEKLY_GOAL}
              hideDayCalorieTotals={hideDayCalorieTotals}
              weekDayScale={DEFAULT_WEEKLY_MULTIPLIER}
              rolling7DayAvg={rolling7DayAvg}
              rolling7DaysCounted={rolling7DaysCounted}
              rolling14DayAvg={rolling14DayAvg}
              rolling14DaysCounted={rolling14DaysCounted}
            />
          );
        })()}

        {/* Hors planning — zone de dépôt pour déplanifier */}
        <UnplannedDropZone
          isDragOver={dragOverUnplanned}
          isTouchHighlight={touchHighlight === "unplanned"}
          isEmpty={unplanned.length === 0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverUnplanned(true);
          }}
          onDragLeave={() => setDragOverUnplanned(false)}
          onDrop={handleDropUnplanned}
        >
          {unplanned.map((pm) => renderMiniCard(pm, true))}
        </UnplannedDropZone>
      </>) : weekOffset <= -1 ? (
        /* ─── Semaine précédente (Vue de sauvegarde) ─── */
        <PlanningBackupWeekView
          weekDates={weekDates}
          getPreference={getPreference}
          calOverrides={calOverrides}
          proOverrides={proOverrides}
          allMealsById={allMealsById}
          openBackupPlanningCardPopup={openBackupPlanningCardPopup}
          handleBackupCardOpen={handleBackupCardOpen}
          resolveBackupCardMeal={resolveBackupCardMeal}
          setPopupBreakfast={setPopupBreakfast}
          foodItems={foodItems}
          foodMacroIndex={foodMacroIndex}
          isAvailableCb={isAvailableCb}
          singleIngredientDessertById={singleIngredientDessertById}
          ingredientMacroLibrary={ingredientMacroLibrary}
          sumDayExtras={sumDayExtras}
          hideDayCalorieTotals={hideDayCalorieTotals}
          backupTotals={backupTotals!}
          openExtrasDay={openExtrasDay}
          setOpenExtrasDay={setOpenExtrasDay}
          parseCalories={parseCalories}
          parseProtein={parseProtein}
        />
      ) : (
        /* ─── Planification de la semaine prochaine ─── */
        <PlanningNextWeekView
          weekDates={weekDates}
          savedSnapshots={savedSnapshots}
          nextBreakfastSelections={nextBreakfastSelections}
          nextBreakfastManualCalories={nextBreakfastManualCalories}
          nextBreakfastManualProteins={nextBreakfastManualProteins}
          nextExtraCalories={nextExtraCalories}
          nextExtraProteins={nextExtraProteins}
          nextExtraFibers={nextExtraFibers}
          nextExtraSelections={nextExtraSelections}
          nextExtraSlotAssignments={nextExtraSlotAssignments}
          nextManualCalories={nextManualCalories}
          nextManualProteins={nextManualProteins}
          nextManualFibers={nextManualFibers}
          nextDrinkChecks={nextDrinkChecks}
          allMealsById={allMealsById}
          possiblePetitDej={possiblePetitDej}
          petitDejMeals={petitDejMeals}
          calOverrides={calOverrides}
          proOverrides={proOverrides}
          foodItems={foodItems}
          foodMacroIndex={foodMacroIndex}
          isAvailableCb={isAvailableCb}
          getMealsForSlot={getMealsForSlot}
          sumDayExtras={sumDayExtras}
          resolveExtraSnapshotForDay={resolveExtraSnapshotForDay}
          allSingleIngredientDessertExtras={allSingleIngredientDessertExtras}
          singleIngredientDessertExtras={singleIngredientDessertExtras}
          singleIngredientDessertById={singleIngredientDessertById}
          dessertExtraStockSnapshots={dessertExtraStockSnapshots}
          canAddDessertById={canAddDessertById}
          dessertPossibleCountById={dessertPossibleCountById}
          ingredientMacroLibrary={ingredientMacroLibrary}
          testItemIdSet={testItemIdSet}
          foodSortModes={foodSortModes}
          sortDirections={sortDirections}
          extrasDividerAfterId={extrasDividerAfterId}
          hideDayCalorieTotals={hideDayCalorieTotals}
          NEXT_DAILY_GOAL={NEXT_DAILY_GOAL}
          NEXT_DAILY_GOAL_LOW={NEXT_DAILY_GOAL_LOW}
          NEXT_PROTEIN_GOAL={NEXT_PROTEIN_GOAL}
          NEXT_FIBER_GOAL={NEXT_FIBER_GOAL}
          dragOverSlot={dragOverSlot}
          setDragOverSlot={setDragOverSlot}
          draggedSelectedExtraId={draggedSelectedExtraId}
          setDraggedSelectedExtraId={setDraggedSelectedExtraId}
          setDraggedSelectedExtraOrigin={setDraggedSelectedExtraOrigin}
          openExtrasDay={openExtrasDay}
          setOpenExtrasDay={setOpenExtrasDay}
          isTouchDevice={isTouchDevice}
          customExtraName={customExtraName}
          setCustomExtraName={setCustomExtraName}
          customExtraCal={customExtraCal}
          setCustomExtraCal={setCustomExtraCal}
          customExtraProt={customExtraProt}
          setCustomExtraProt={setCustomExtraProt}
          customExtraFiber={customExtraFiber}
          setCustomExtraFiber={setCustomExtraFiber}
          setPreference={setPreference}
          handleNextWeekDrop={handleNextWeekDrop}
          unassignNextExtraFromAllDaySlots={unassignNextExtraFromAllDaySlots}
          deselectNextExtraForDay={deselectNextExtraForDay}
          removeOneNextWeekExtraOccurrence={removeOneNextWeekExtraOccurrence}
          addNextWeekExtraOccurrence={addNextWeekExtraOccurrence}
          renderMiniCard={renderMiniCard}
          getMealCal={getMealCal}
          getMealPro={getMealPro}
          parseCalories={parseCalories}
          parseProtein={parseProtein}
        />
      )}

      <Dialog open={!!popupPm} onOpenChange={(open) => {
        if (!open) {
          setPopupPm(null);
          setPopupCalOverride(undefined);
          setPopupProOverride(undefined);
        }
      }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du repas</DialogTitle>
          {popupPm && popupPm.meals && (() => {
            const meal = popupPm.meals;
            const displayIngredients = popupPm.ingredients_override ?? meal.ingredients;
            const popupDisplayIngredients = ingredientsForPossibleCardDisplay(displayIngredients);
            const mealForAnalysis = { ...meal, ingredients: displayIngredients };
            const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);
            // Badge = valeur figée (prefs) uniquement.
            const frozenCounterDays = readFrozenPossibleCounterDays(frozenCounterDaysByPmId, popupPm.id);
            const popupRatio = getOverrideScaleRatio(meal, popupPm.ingredients_override);
            const popupCal =
              parsePositivePlanningOverride(popupCalOverride) ??
              parsePositivePlanningOverride(calOverrides[popupPm.id]) ??
              getDisplayedPMCalories(popupPm, popupRatio ?? undefined, isAvailableCb);
            const popupPro =
              parsePositivePlanningOverride(popupProOverride) ??
              parsePositivePlanningOverride(proOverrides[popupPm.id]) ??
              getDisplayedPMProtein(popupPm, popupRatio ?? undefined, isAvailableCb, foodItems, foodMacroIndex);
            const popupFiber = getCardDisplayFiber(popupPm, undefined, isAvailableCb, foodItems, foodMacroIndex);
            const displayCal = popupCal ? String(Math.round(popupCal)) : null;
            const displayPro = popupPro ? String(Math.round(popupPro)) : null;
            const displayFiber = popupFiber != null && popupFiber > 0 ? String(Math.round(popupFiber)) : null;
            const counterDays = frozenCounterDays !== undefined ? frozenCounterDays : null;
            const counterBadgeTitle = formatFrozenPossibleCounterTooltip(frozenCounterDays);
            const plannedDayIso = resolvePlannedDayIso(popupPm.day_of_week, weekDates);
            const expired = isExpiredOnPlannedDay(popupPm.expiration_date, plannedDayIso);
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">{getCategoryEmoji(meal.category)} {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && !hideDayCalorieTotals && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {displayFiber && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1" title="Fibres">
                      <Wheat className="h-3.5 w-3.5" /> {displayFiber}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                  {counterDays !== null && (
                    <span
                      className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`}
                      title={counterBadgeTitle}
                    >
                      <Timer className="h-3.5 w-3.5" /> {counterDays}j
                    </span>
                  )}
                </div>
                {popupPm.expiration_date && (
                  <p className={`text-sm mb-2 ${expired ? "text-red-300 font-bold" : "text-white/70"}`}>
                    📅 {format(parseISO(popupPm.expiration_date), "d MMMM yyyy", { locale: fr })}
                  </p>
                )}
                {popupDisplayIngredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90">
                      <StructuredIngredientInline
                        ingredients={popupDisplayIngredients}
                        stockMap={stockMap}
                        forcePlainWhite
                      />
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                {meal.description?.trim() && (
                  <div className="bg-black/20 rounded-xl p-3 mt-2">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" /> Préparation
                    </p>
                    <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{meal.description}</p>
                  </div>
                )}
                {popupPm.day_of_week && popupPm.meal_time && (
                  <p className="text-xs text-white/50 mt-3">
                    {getDisplayDay(popupPm.day_of_week)} — {TIME_LABELS[popupPm.meal_time]}
                  </p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Popup au double-clic sur le petit déjeuner */}
      <Dialog open={!!popupBreakfast} onOpenChange={(open) => { if (!open) setPopupBreakfast(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du petit déjeuner</DialogTitle>
          {popupBreakfast && (() => {
            const meal = popupBreakfast.meal;
            const displayCal = getMealCal(meal);
            const displayPro = getMealPro(meal);
            const fiberNum = getMealFiber(meal, undefined, undefined, undefined, foodItems, foodMacroIndex);
            const displayFiber = fiberNum != null && fiberNum > 0 ? String(Math.round(fiberNum)) : null;
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">🥐 {meal.name}</h3>
                <p className="text-[10px] text-white/60 mb-2 uppercase font-black tracking-widest">
                  {getDisplayDay(popupBreakfast.day)}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && !hideDayCalorieTotals && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {displayFiber && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1" title="Fibres">
                      <Wheat className="h-3.5 w-3.5" /> {displayFiber}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                </div>
                {meal.ingredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90">
                      <StructuredIngredientInline
                        ingredients={meal.ingredients}
                        stockMap={stockMap}
                        softUnavailableStyle
                      />
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                {meal.description?.trim() && (
                  <div className="bg-black/20 rounded-xl p-3 mt-2">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" /> Préparation
                    </p>
                    <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{meal.description}</p>
                  </div>
                )}
                <p className="text-xs text-white/50 mt-3">
                  {DAY_LABELS[popupBreakfast.day]}
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
