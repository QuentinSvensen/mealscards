import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Loader2, ChevronDown, ChevronRight, ShieldAlert, Apple, Infinity as InfinityIcon, Star, List, Flame, Search, Drumstick, Wheat, Timer } from "lucide-react";
import { DevMenu } from "@/components/DevMenu";
import { Chronometer } from "@/components/Chronometer";
import { PinLock } from "@/components/PinLock";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { clearAvailableThresholdDayIso } from "@/lib/availableThresholdDaySession";
import {
  availableFullRemainingPrefKey,
  availableSeuilMaxPrefKey,
  isAvailableSeuilMaxDefaultOn,
  shouldAutoEnableFullRemainingWithSeuilMax,
} from "@/lib/availableSeuilMaxPrefs";
import {
  appendPossibleOnlyMealId,
  POSSIBLE_ONLY_MEAL_IDS_PREF_KEY,
} from "@/lib/possibleOnlyMeals";
import {
  MASTER_SOURCE_PM_IDS_PREF_KEY,
  addMasterSourcePmIds,
  filterStockAffectingPossibleMeals,
  isPossibleMealStockExempt,
} from "@/lib/masterSourcePossibleMeals";
import { shouldSuppressStockRealtime } from "@/lib/stockRealtimeGate";
import { debounceInvalidateQueries } from "@/lib/queryInvalidationDebounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { colorFromName } from "@/lib/foodColors";

import { useMeals, type MealCategory, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import { useShoppingList } from "@/hooks/useShoppingList";
import { usePreferences } from "@/hooks/usePreferences";
import { useSortModes } from "@/hooks/useSortModes";
import { toast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

import {
  normalizeForMatch, normalizeKey, strictNameMatch, accentSafeKeyMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups, computeIngredientCalories, smartFoodContains,
  extractIngredientMacros,
} from "@/lib/ingredientUtils";
import { OptionalIngredientsMoveDialog } from "@/components/OptionalIngredientsMoveDialog";
import { useOptionalIngredientsMoveDialog } from "@/hooks/useOptionalIngredientsMoveDialog";
import { useProgCounterReconcile } from "@/hooks/useProgCounterReconcile";
import { useMoveToPossible } from "@/hooks/useMoveToPossible";
import { useIndexStockMoveHandlers } from "@/hooks/useIndexStockMoveHandlers";
import { useStickyChromeHeight } from "@/hooks/useStickyChromeHeight";
import { useWeeklyAutoReset } from "@/hooks/useWeeklyAutoReset";
import { useLazyFragmentsPreload } from "@/hooks/useLazyFragmentsPreload";
import { useSyncPlanningQueriesOnResume } from "@/hooks/useSyncPlanningQueriesOnResume";
import {
  buildStockMap, buildFoodItemIndex, findStockKey, pickBestAlternative,
  getMealMultiple, getMealFractionalRatio,
  analyzeMealIngredients,
  getMissingIngredients, isFoodUsedInMeals,
  formatExpirationLabel, compareExpirationWithCounter,
  sortStockDeductionPriority, buildScaledMealForRatio, scaleIngredientStringExact,
  getDisplayedCalories, getDisplayedProtein, getDisplayedFiber, propagateIngredientMacros, resolveCounterStartForPossibleBadge,
  getDisplayedPMCalories, getDisplayedPMProtein, getDisplayedPMFiber,
  findEarliestActiveCounterDate,
  findEarliestFutureCounterDate,
  resolveInheritedFutureLotOpening,
  computePossibleFrozenCounterDays,
  resolveFrozenPossibleCounterDays,
  isLotProgOpeningAtMealSlot,
  hasNoFoodCounterEvidenceWhileStockRemains,
  POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
  type PossibleFrozenCounterDaysMap,
  type FoodItemIndex,
  buildFrozenBadgePreferenceEntry,
  buildClearFrozenBadgePreferenceEntry,
  buildCopyFrozenBadgePreferenceEntry,
  isCountOnlyFoodItem,
  isFoodItemFullySealed,
} from "@/lib/stockUtils";
import { useMealTransfers, computePlannedCounterDate } from "@/hooks/useMealTransfers";
import {
  attachPortionDeduction,
  mergeDeductionSnapshotMaps,
  remapDessertFoodPreferenceIds,
  remapMorningMealPreferenceIds,
  toFoodItemInsertPayload,
  wasDessertFoodSnapshot,
  wasMorningMealSnapshot,
} from "@/lib/stockDeductionSnapshot";
import type { IngredientMacroAutofillSources, IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import {
  NINJA_CREAMI_BASE_GROUPS_KEY,
  NINJA_CREAMI_BASE_LINES_KEY,
  NINJA_CREAMI_EXTRAS_LINES_KEY,
  NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY,
  NINJA_CREAMI_MEAL_IDS_KEY,
  NINJA_CREAMI_TEST_PM_IDS_KEY,
  NINJA_CREAMI_TESTED_OVERVIEW_NOTES_KEY,
  NINJA_CREAMI_TESTED_SORT_KEY,
  NINJA_CREAMI_TESTS_GROUP_ORDER_KEY,
  addNinjaCreamiMealId,
  addNinjaCreamiTestPmId,
  applyNinjaCreamiAuChoixDisplayNames,
  applyNinjaCreamiMealDisplayNames,
  filterNinjaCreamiTestedMeals,
  filterOutNinjaCreamiMeals,
  flattenNinjaCreamiBaseGroups,
  loadNinjaCreamiBaseGroupsLocalBackup,
  normalizeNinjaCreamiBaseGroups,
  normalizeNinjaCreamiCatalogLines,
  parseNinjaCreamiTestsGroupOrder,
  normalizeNinjaCreamiMealDisplayNames,
  NINJA_CREAMI_AU_CHOIX_NAME_PREFIX,
  ninjaCreamiBaseGroupsHaveContent,
  removeNinjaCreamiMealDisplayName,
  removeNinjaCreamiMealId,
  resolveIngredientsForNinjaCreamiTestedSave,
  saveNinjaCreamiBaseGroupsLocalBackup,
  setNinjaCreamiMealDisplayName,
  isNinjaCreamiStockExemptPossibleMeal,
  syncNinjaCatalogLinesToMacroLibrary,
  upsertMacroLibraryFromNinjaLineName,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
} from "@/domain/ninjaCreami/ninjaCreami";
import {
  BONUS_LOW_CALORIE_GROUPS_KEY,
  BONUS_ZERO_CALORIE_GROUPS_KEY,
  BONUS_ZERO_CALORIE_LINES_KEY,
  BONUS_ZERO_CALORIE_LOCAL_BACKUP_KEY,
  flattenBonusZeroCalorieGroups,
  normalizeBonusLowCalorieGroups,
  normalizeBonusZeroCalorieGroups,
  saveBonusCatalogLocalBackup,
  markBonusCatalogSynced,
} from "@/domain/bonusZeroCalorie/bonusZeroCalorie";
import { DESSERT_FOOD_PREF_KEY, DESSERT_FOOD_NAME_KEYS_PREF_KEY, addDessertFoodNameKey } from "@/lib/foodDessertUtils";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import { prioritizeNumberedPotsAmongUnplanned } from "@/domain/planning/possiblePlanningSort";

/** Préférence Macro : grammes/unité (même clé que `INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY`). */
const INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY = "ingredient_macro_unit_grams";

/**
 * Enveloppe un import dynamique : en cas d'erreur de chunk, tente un rechargement (cache SW, sessionStorage).
 */
const lazyRetry = (importFn: () => Promise<any>, name: string) => {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (error: any) {
      const msg = (error?.message || error || "").toString().toLowerCase();
      const isChunkError = error.name === 'ChunkLoadError' ||
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('failed to load module script') ||
        msg.includes('chunkloaderror');

      if (isChunkError && !sessionStorage.getItem(`retry-${name}`)) {
        sessionStorage.setItem(`retry-${name}`, 'true');
        console.warn(`Module load error for ${name}, attempting safety reload...`);

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach(r => r.unregister()));
        }

        if (typeof caches !== "undefined") {
          caches.keys().then((keys) => {
            Promise.all(keys.map(k => caches.delete(k))).then(() => {
              location.reload();
            });
          }).catch(() => location.reload());
        } else {
          location.reload();
        }
      }
      throw error;
    }
  });
};

/** Import dynamique de la liste de courses (préchargement). */
const importShoppingList = () => import("@/components/ShoppingList").then((m) => ({ default: m.ShoppingList }));
/** Import dynamique du générateur de plan de repas. */
const importMealPlanGenerator = () => import("@/components/MealPlanGenerator").then((m) => ({ default: m.MealPlanGenerator }));
/** Import dynamique de la gestion des aliments. */
const importFoodItems = () => import("@/components/FoodItems").then((m) => ({ default: m.FoodItems }));
/** Import dynamique du générateur de repas max (export par défaut du module). */
/** Import dynamique du planning hebdomadaire. */
const importWeeklyPlanning = () => import("@/components/WeeklyPlanning").then((m) => ({ default: m.WeeklyPlanning }));
/** Import dynamique de la liste maîtresse. */
const importMasterList = () => import("@/components/MasterList").then((m) => ({ default: m.MasterList }));
/** Import dynamique de la liste des repas possibles. */
const importPossibleList = () => import("@/components/PossibleList").then((m) => ({ default: m.PossibleList }));
/** Import dynamique de la liste des repas disponibles. */
const importAvailableList = () => import("@/components/AvailableList").then((m) => ({ default: m.AvailableList }));
/** Import dynamique de la section Ninja Creami (Desserts). */
const importNinjaCreamiSection = () =>
  import("@/components/NinjaCreamiSection").then((m) => ({ default: m.NinjaCreamiSection }));
/** Import dynamique de la section « Tous 0 calorie » (Bonus). */
const importZeroCalorieBonusSection = () =>
  import("@/components/ZeroCalorieBonusSection").then((m) => ({ default: m.ZeroCalorieBonusSection }));
/** Import dynamique de la section « un par un ». */
const importUnParUnSection = () => import("@/components/UnParUnSection").then((m) => ({ default: m.UnParUnSection }));
/** Import dynamique du référentiel des macros d'ingrédients. */
const importMacroIngredients = () => import("@/components/MacroIngredients").then((m) => ({ default: m.MacroIngredients }));
/** Import dynamique de la liste des boissons énergisantes. */
const importEnergyDrinksList = () => import("@/components/EnergyDrinksList").then((m) => ({ default: m.EnergyDrinksList }));

const LazyShoppingList = lazyRetry(importShoppingList, "ShoppingList");
const LazyMealPlanGenerator = lazyRetry(importMealPlanGenerator, "MealPlanGenerator");
const LazyFoodItems = lazyRetry(importFoodItems, "FoodItems");
const LazyWeeklyPlanning = lazyRetry(importWeeklyPlanning, "WeeklyPlanning");
const LazyMasterList = lazyRetry(importMasterList, "MasterList");
const LazyPossibleList = lazyRetry(importPossibleList, "PossibleList");
const LazyAvailableList = lazyRetry(importAvailableList, "AvailableList");
const LazyNinjaCreamiSection = lazyRetry(importNinjaCreamiSection, "NinjaCreamiSection");
const LazyZeroCalorieBonusSection = lazyRetry(importZeroCalorieBonusSection, "ZeroCalorieBonusSection");
const LazyUnParUnSection = lazyRetry(importUnParUnSection, "UnParUnSection");
const LazyMacroIngredients = lazyRetry(importMacroIngredients, "MacroIngredients");
const LazyEnergyDrinksList = lazyRetry(importEnergyDrinksList, "EnergyDrinksList");

// ═══════════════════════════════════════════════════════════════════════════════
// Catégories de repas disponibles dans l'application
// ═══════════════════════════════════════════════════════════════════════════════
const CATEGORIES: { value: MealCategory; label: string; emoji: string; }[] = [
  { value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
  { value: "entree", label: "Entrées", emoji: "🥗" },
  { value: "plat", label: "Plats", emoji: "🍽️" },
  { value: "dessert", label: "Desserts", emoji: "🍰" },
  { value: "bonus", label: "Bonus", emoji: "⭐" }];

/** Valide le nom d'un repas avant création */
function validateMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Le nom est requis";
  if (trimmed.length > 100) return "Nom trop long (100 car. max)";
  return null;
}

import type { SortMode, MasterSortMode, AvailableSortMode, UnParUnSortMode } from "@/hooks/useSortModes";
import {
  sortMealsByMasterMode,
} from "@/lib/mealListSort";
type MainPage = "aliments" | "repas" | "macros" | "planning" | "courses";


const ROUTE_TO_PAGE: Record<string, MainPage> = {
  "/aliments": "aliments",
  "/repas": "repas",
  "/macros": "macros",
  "/planning": "planning",
  "/courses": "courses"
};

const PAGE_TO_ROUTE: Record<MainPage, string> = {
  aliments: "/aliments",
  repas: "/repas",
  macros: "/macros",
  planning: "/planning",
  courses: "/courses"
};

const EMPTY_MACRO_LIBRARY: IngredientMacroLibraryItem[] = [];
const EMPTY_DEDUCTION_SNAPSHOTS: Record<string, FoodItem[]> = {};
const MORNING_MEAL_PREF_KEY = "morning_meal_food_item_ids";

/** Remet le scroll de la fenêtre en haut (le conteneur scrollable réel est window, pas un overflow parent). */
function scrollWindowToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL : Index
// ═══════════════════════════════════════════════════════════════════════════════
/** Page racine : navigation repas / aliments / planning / courses, session, reset hebdomadaire et vues lazy. */
const Index = () => {
  const qc = useQueryClient();
  const [session, setSession] = useState<import("@supabase/supabase-js").Session | null | undefined>(undefined);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const mainPage: MainPage = ROUTE_TO_PAGE[location.pathname] ?? "repas";
  /** Change l’onglet principal et remonte le scroll hors Planning (évite la fuite du scroll auto jour courant). */
  const setMainPage = (page: MainPage) => {
    if (page !== "planning") scrollWindowToTop();
    navigate(PAGE_TO_ROUTE[page]);
  };

  // Filet de sécurité (back/forward, URL directe) : hors Planning, toujours repartir du haut de page.
  useEffect(() => {
    if (mainPage === "planning") return;
    scrollWindowToTop();
  }, [mainPage]);

  const unlocked = !!session;

  // ─── Hooks de données (activés seulement après authentification) ──────────
  const { items: foodItems, deleteItem: deleteFoodItemMutation, updateItem: updateFoodItemMutation } = useFoodItems({ enabled: unlocked });
  const deleteFoodItem = (id: string) => deleteFoodItemMutation.mutate(id);

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, setMealAvailable, renameMeal, updateCalories, updateGrams, updateProtein, updateFiber, updateIngredients,
    updateOvenTemp, updateOvenMinutes, updateDescription,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity, splitPossibleMealQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals({ enabled: unlocked });

  const { groups: shoppingGroups, items: shoppingItems, toggleSecondaryCheck: toggleShoppingSecondaryCheck, updateItemQuantity: updateShoppingItemQuantity } = useShoppingList({ enabled: unlocked });
  const { getPreference, setPreference, setPreferencesBatch, isLoading: isPreferencesLoading } = usePreferences({ enabled: unlocked });
  const hideDayCalorieTotals = getPreference<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);
  const macroLibrary = getPreference<IngredientMacroLibraryItem[]>("ingredient_macro_library", EMPTY_MACRO_LIBRARY);
  const saveMacroLibrary = useCallback(
    (library: IngredientMacroLibraryItem[]) => {
      setPreference.mutate({ key: "ingredient_macro_library", value: library });
    },
    [setPreference],
  );
  const ninjaCreamiMealIds = getPreference<string[]>(NINJA_CREAMI_MEAL_IDS_KEY, []);
  const ninjaCreamiTestPmIds = getPreference<string[]>(NINJA_CREAMI_TEST_PM_IDS_KEY, []);
  const ninjaCreamiMealDisplayNamesRaw = getPreference(NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY, {});
  const ninjaCreamiMealDisplayNames = useMemo(
    () => normalizeNinjaCreamiMealDisplayNames(ninjaCreamiMealDisplayNamesRaw),
    [ninjaCreamiMealDisplayNamesRaw],
  );
  const ninjaCreamiBaseGroupsRaw = getPreference(NINJA_CREAMI_BASE_GROUPS_KEY, null);
  const ninjaCreamiBaseLinesRaw = getPreference(NINJA_CREAMI_BASE_LINES_KEY, []);
  const ninjaCreamiExtrasLinesRaw = getPreference(NINJA_CREAMI_EXTRAS_LINES_KEY, []);
  const ninjaCreamiBaseGroups = useMemo(
    () =>
      normalizeNinjaCreamiBaseGroups(
        ninjaCreamiBaseGroupsRaw,
        ninjaCreamiBaseLinesRaw,
        loadNinjaCreamiBaseGroupsLocalBackup(),
      ),
    [ninjaCreamiBaseGroupsRaw, ninjaCreamiBaseLinesRaw],
  );
  const ninjaCreamiBaseLines = useMemo(
    () => flattenNinjaCreamiBaseGroups(ninjaCreamiBaseGroups),
    [ninjaCreamiBaseGroups],
  );
  const ninjaCreamiExtrasLines = useMemo(
    () => normalizeNinjaCreamiCatalogLines(ninjaCreamiExtrasLinesRaw),
    [ninjaCreamiExtrasLinesRaw],
  );
  const ninjaCreamiTestsGroupOrder = parseNinjaCreamiTestsGroupOrder(
    getPreference(NINJA_CREAMI_TESTS_GROUP_ORDER_KEY, null),
  );
  const ninjaCreamiTestedOverviewNotes = getPreference<string>(
    NINJA_CREAMI_TESTED_OVERVIEW_NOTES_KEY,
    "",
  );
  const bonusZeroCalorieGroupsRaw = getPreference(BONUS_ZERO_CALORIE_GROUPS_KEY, null);
  const bonusZeroCalorieLinesRaw = getPreference(BONUS_ZERO_CALORIE_LINES_KEY, []);
  const bonusZeroCalorieGroups = useMemo(() => {
    return normalizeBonusZeroCalorieGroups(
      bonusZeroCalorieGroupsRaw,
      bonusZeroCalorieLinesRaw,
    );
  }, [bonusZeroCalorieGroupsRaw, bonusZeroCalorieLinesRaw]);
  const bonusLowCalorieGroupsRaw = getPreference(BONUS_LOW_CALORIE_GROUPS_KEY, null);
  const bonusLowCalorieGroups = useMemo(
    () => normalizeBonusLowCalorieGroups(bonusLowCalorieGroupsRaw),
    [bonusLowCalorieGroupsRaw],
  );

  // Migre / répare Base uniquement quand on a du contenu (jamais d’écriture vide qui wipe le cloud).
  useEffect(() => {
    if (isPreferencesLoading) return;
    if (!ninjaCreamiBaseGroupsHaveContent(ninjaCreamiBaseGroups)) return;

    saveNinjaCreamiBaseGroupsLocalBackup(ninjaCreamiBaseGroups);

    const rawHasGroups =
      Array.isArray(ninjaCreamiBaseGroupsRaw) && ninjaCreamiBaseGroupsRaw.length > 0;
    const rawGroupsHaveContent =
      rawHasGroups &&
      ninjaCreamiBaseGroupsHaveContent(
        normalizeNinjaCreamiBaseGroups(ninjaCreamiBaseGroupsRaw, [], null),
      );

    // Prefs cloud absentes ou vides alors que l’UI a récupéré legacy/backup → resynchroniser.
    if (rawGroupsHaveContent) return;

    setPreferencesBatch.mutate([
      { key: NINJA_CREAMI_BASE_GROUPS_KEY, value: ninjaCreamiBaseGroups },
      { key: NINJA_CREAMI_BASE_LINES_KEY, value: ninjaCreamiBaseLines },
    ]);
  }, [
    isPreferencesLoading,
    ninjaCreamiBaseGroups,
    ninjaCreamiBaseGroupsRaw,
    ninjaCreamiBaseLines,
    setPreferencesBatch,
  ]);

  // Complète Macro ingrédients avec les macros déjà saisies dans Ninja Creami (vides/0 seulement).
  useEffect(() => {
    if (isPreferencesLoading) return;
    const next = syncNinjaCatalogLinesToMacroLibrary(macroLibrary, [
      ...ninjaCreamiBaseLines,
      ...ninjaCreamiExtrasLines,
    ]);
    if (next !== macroLibrary) saveMacroLibrary(next);
  }, [
    isPreferencesLoading,
    macroLibrary,
    ninjaCreamiBaseLines,
    ninjaCreamiExtrasLines,
    saveMacroLibrary,
  ]);

  // ─── Données dérivées (memoized) ────────────────────────────────────────
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  const { deductIngredientsFromStock, restoreIngredientsToStock, adjustStockForIngredientChange, deductNameMatchStock, updateFoodItemCountersForPlanning, reconcileMissedProgCounters } = useMealTransfers(foodItems);
  const foodStockBaselines = getPreference<Record<string, { quantity?: number | null; totalGrams?: number }>>(
    "food_item_stock_baselines",
    {},
  );

  useLazyFragmentsPreload(unlocked, {
    importShoppingList,
    importMealPlanGenerator,
    importFoodItems,
    importWeeklyPlanning,
    importMasterList,
    importPossibleList,
    importAvailableList,
    importNinjaCreamiSection,
    importZeroCalorieBonusSection,
    importUnParUnSection,
    importMacroIngredients,
    importEnergyDrinksList,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Déconnexion : vider le jour de seuil « Au choix » (mémoire JS, pas de stockage navigateur).
      if (event === "SIGNED_OUT") {
        clearAvailableThresholdDayIso();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Gestionnaire d'erreurs global pour les modules ──────────────────────
  useEffect(() => {
    const handleGlobalModuleError = (e: ErrorEvent | PromiseRejectionEvent) => {
      const err = (e as any).error || (e as any).reason || (e as any).message || e;
      const msg = (err?.message || err || "").toString();

      if (msg.includes("ChunkLoadError") || msg.includes("Failed to load module script")) {
        const now = Date.now();
        const last = parseInt(sessionStorage.getItem("global-module-retry") || "0");
        if (now - last > 10000) {
          sessionStorage.setItem("global-module-retry", now.toString());
          console.error("Global module error detected, triggering safety reload...");
          location.reload();
        }
      }
    };

    window.addEventListener("error", handleGlobalModuleError, true);
    window.addEventListener("unhandledrejection", handleGlobalModuleError, true);
    return () => {
      window.removeEventListener("error", handleGlobalModuleError, true);
      window.removeEventListener("unhandledrejection", handleGlobalModuleError, true);
    };
  }, []);

  // ─── Pas de refetch massif au focus/visibility (gros driver d'egress Free Plan) ───
  // Le cache React Query + PersistQueryClient suffisent ; sync multi-appareils via Realtime debouncé.

  useEffect(() => {
    const TAB_KEY = 'mealcards_open_tabs';
    const count = parseInt(localStorage.getItem(TAB_KEY) || '0');
    localStorage.setItem(TAB_KEY, String(count + 1));
    const handleUnload = () => {
      // En dev (reload HMR ou F5), on garde la session pour éviter de retaper le PIN à chaque modif.
      if (import.meta.env.DEV || sessionStorage.getItem("mealcards_preserve_session") === "1") {
        sessionStorage.removeItem("mealcards_preserve_session");
        return;
      }
      const current = parseInt(localStorage.getItem(TAB_KEY) || '1');
      if (current <= 1) {
        supabase.auth.signOut();
        localStorage.setItem(TAB_KEY, '0');
      } else {
        localStorage.setItem(TAB_KEY, String(current - 1));
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      const current = parseInt(localStorage.getItem(TAB_KEY) || '1');
      localStorage.setItem(TAB_KEY, String(Math.max(0, current - 1)));
    };
  }, []);

  // "unlocked" calculé ci-dessus pour bloquer les hooks de données avant le déverrouillage par PIN

  useEffect(() => {
    if (!unlocked) return;
    // Stats admin : un seul fetch à l'ouverture (plus de polling /60s → Edge Functions egress).
    const fetchBlockedCount = async () => {
      try {
        const { data } = await supabase.functions.invoke("verify-pin", { body: { admin_stats: true } });
        if (data?.blocked_count !== undefined) setBlockedCount(data.blocked_count);
      } catch {/* ignore */ }
    };
    fetchBlockedCount();
  }, [unlocked]);

  // Forcer le filtre « seuil max » (calories restantes) à ON pour Entrée / Plat / Dessert / Bonus.
  // Petit déjeuner reste OFF. Réappliqué à chaque session une fois les prefs chargées.
  const calorieFilterForced = useRef(false);
  useEffect(() => {
    if (!unlocked) {
      calorieFilterForced.current = false;
      return;
    }
    if (isPreferencesLoading || calorieFilterForced.current) return;
    calorieFilterForced.current = true;

    const prefEntries: { key: string; value: unknown }[] = [];
    for (const cat of CATEGORIES) {
      const key = availableSeuilMaxPrefKey(cat.value);
      const wantOn = isAvailableSeuilMaxDefaultOn(cat.value);
      const current = getPreference<boolean>(key, wantOn);
      if (current !== wantOn) {
        prefEntries.push({ key, value: wantOn });
      }
      // Plat au choix : si seuil max actif (ou forcé ON), activer aussi « 100 % ».
      if (wantOn && shouldAutoEnableFullRemainingWithSeuilMax(cat.value)) {
        const fullKey = availableFullRemainingPrefKey(cat.value);
        if (!getPreference<boolean>(fullKey, false)) {
          prefEntries.push({ key: fullKey, value: true });
        }
      }
    }

    // Forcer le tri par "péremption" par défaut pour toutes les catégories "au choix" (AvailableList)
    const availableSortModes = getPreference<Record<string, string>>('meal_available_sort_modes', {});
    const updatedSortModes = { ...availableSortModes };
    let changed = false;
    for (const cat of CATEGORIES) {
      if (updatedSortModes[cat.value] !== 'expiration') {
        updatedSortModes[cat.value] = 'expiration';
        changed = true;
      }
    }
    if (changed) {
      prefEntries.push({ key: 'meal_available_sort_modes', value: updatedSortModes });
    }
    if (prefEntries.length === 1) setPreference.mutate(prefEntries[0]);
    else if (prefEntries.length > 1) setPreferencesBatch.mutate(prefEntries);
  }, [unlocked, isPreferencesLoading, getPreference, setPreference, setPreferencesBatch]);

  const macroLookup = useMemo(() => {
    const map = new Map<string, { cal: string; pro: string }>();
    const merge = (ingredients: string | null | undefined) => {
      if (!ingredients) return;
      for (const [key, val] of extractIngredientMacros(ingredients)) {
        const existing = map.get(key);
        if (!existing || (!existing.cal && val.cal) || (!existing.pro && val.pro)) {
          map.set(key, { cal: val.cal || existing?.cal || "", pro: val.pro || existing?.pro || "" });
        }
      }
    };
    for (const meal of meals) merge(meal.ingredients);
    for (const pm of possibleMeals) {
      merge(pm.ingredients_override ?? pm.meals?.ingredients ?? null);
    }
    return map;
  }, [meals, possibleMeals]);

  const macroUnitGramsByKey = getPreference<Record<string, number>>(
    INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY,
    {},
  );

  const ingredientMacroAutofillSources = useMemo<IngredientMacroAutofillSources>(
    () => ({
      foodItems,
      macroLibrary,
      mealMacros: macroLookup,
      unitGramsByKey: macroUnitGramsByKey,
      catalogMeals: meals,
    }),
    [foodItems, macroLibrary, macroLookup, macroUnitGramsByKey, meals],
  );

  // Macros bas en calorie : affichage via autofill local dans la liste (pas d’écriture
  // auto des prefs — évite qu’un 2ᵉ onglet périmé réécrase le catalogue).

  useEffect(() => {
    if (!unlocked) return;
    const channel = supabase
      .channel('global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items' }, () => {
        // Les updates locaux appliquent déjà un optimistic update. On debounce le refetch
        // Realtime pour éviter une salve de select(*) (egress Free Plan).
        if (shouldSuppressStockRealtime()) return;
        debounceInvalidateQueries(qc, ["food_items"], 5000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => {
        debounceInvalidateQueries(qc, ["meals"], 5000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'possible_meals' }, () => {
        debounceInvalidateQueries(qc, ["possible_meals"], 5000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_preferences' }, () => {
        debounceInvalidateQueries(qc, ["user_preferences"], 2000);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('Sync temps réel : La connexion a échoué. Assurez-vous que le Realtime est activé dans votre tableau de bord Supabase.');
        }
      });
    return () => {
      if (channel) {
        supabase.removeChannel(channel).catch(() => { /* silent */ });
      }
    };
  }, [unlocked, qc]);

  // Nettoyage automatique du dimanche — une fois par semaine (hook dédié).
  const lastWeeklyReset = getPreference<string>('last_weekly_reset', '');
  useWeeklyAutoReset({
    unlocked,
    isLoading,
    isPreferencesLoading,
    lastWeeklyReset,
    possibleMeals,
    meals,
    foodItems,
    qc,
    setPreference,
  });

  const [activeCategory, setActiveCategory] = useState<MealCategory>(() => {
    if (location.pathname === '/repas') {
      const hour = new Date().getHours();
      return hour < 11 ? "petit_dejeuner" : "plat";
    }
    return "plat";
  });
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<"all" | "possible">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const SNAPSHOT_PREF_KEY = 'deduction_snapshots_v1';
  const persistedSnapshots = getPreference<Record<string, FoodItem[]>>(SNAPSHOT_PREF_KEY, EMPTY_DEDUCTION_SNAPSHOTS);
  const [deductionSnapshots, setDeductionSnapshots] = useState<Record<string, FoodItem[]>>({});
  const snapshotsSynced = useRef(false);
  const snapshotsJsonRef = useRef('');
  /** Snapshots effectifs : fusion persisté + local (fiable même après rechargement ou le lendemain). */
  const effectiveDeductionSnapshots = useMemo(
    () =>
      mergeDeductionSnapshotMaps(
        persistedSnapshots ?? EMPTY_DEDUCTION_SNAPSHOTS,
        deductionSnapshots,
      ),
    [deductionSnapshots, persistedSnapshots],
  );
  useEffect(() => {
    if (snapshotsSynced.current) return;
    if (!persistedSnapshots || Object.keys(persistedSnapshots).length === 0) return;
    const json = JSON.stringify(persistedSnapshots);
    if (json === snapshotsJsonRef.current) return;
    snapshotsJsonRef.current = json;
    setDeductionSnapshots(persistedSnapshots);
    snapshotsSynced.current = true;
  }, [persistedSnapshots]);
  const updateSnapshots = (updater: (prev: Record<string, FoodItem[]>) => Record<string, FoodItem[]>) => {
    setDeductionSnapshots(prev => {
      const base = mergeDeductionSnapshotMaps(
        persistedSnapshots ?? EMPTY_DEDUCTION_SNAPSHOTS,
        prev,
      );
      const next = updater(base);
      setPreference.mutate({ key: SNAPSHOT_PREF_KEY, value: next });
      return next;
    });
  };

  /** Jours de badge compteur figés par carte Possible (indépendants du stock live). */
  const frozenCounterDaysByPmId = getPreference<PossibleFrozenCounterDaysMap>(
    POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
    {},
  );

  /**
   * Fige (ou re-fige) le badge compteur d’une carte Possible à partir des aliments à cet instant.
   * Appelé à l’arrivée en Possible, et one-shot quand on pose jour+créneau (ex. Croque → 1j samedi).
   * Ne remplace jamais une valeur numérique figée par `null` (merge).
   * `baseStartDate` : vraie ouverture (snapshot / carte) pour recalculer même si le stock est déjà en Prog.
   */
  const freezePossibleBadgeCounter = (
    pmId: string,
    ingredients: string | null | undefined,
    dayKey?: string | null,
    mealTime?: string | null,
    createdAt?: string,
    foodItemsForFreeze: FoodItem[] = foodItems,
    baseStartDate?: string | null,
  ) => {
    const current = getPreference<PossibleFrozenCounterDaysMap>(POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, {});
    setPreference.mutate(
      buildFrozenBadgePreferenceEntry({
        pmId,
        ingredients,
        foodItems: foodItemsForFreeze,
        index: foodItemIndex,
        dayKey,
        mealTime,
        createdAt,
        baseStartDate,
        currentMap: current,
      }),
    );
  };

  /** Supprime l’entrée de gel pour une carte Possible retirée. */
  const clearFrozenPossibleBadgeCounter = (pmId: string) => {
    const current = getPreference<PossibleFrozenCounterDaysMap>(POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, {});
    const entry = buildClearFrozenBadgePreferenceEntry(pmId, current);
    if (entry) setPreference.mutate(entry);
  };

  /** Copie la valeur figée d’une carte source vers une nouvelle carte (duplication). */
  const copyFrozenPossibleBadgeCounter = (sourcePmId: string, targetPmId: string) => {
    const current = getPreference<PossibleFrozenCounterDaysMap>(POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, {});
    const entry = buildCopyFrozenBadgePreferenceEntry(sourcePmId, targetPmId, current);
    if (entry) setPreference.mutate(entry);
  };

  // Backfill one-shot : cartes Possible déjà présentes sans entrée de gel (évite la perte de badge).
  // Guérit aussi un Xj fantôme quand l’ouverture carte = créneau (ex. Prog. jeu. Midi + 1j stale).
  const freezeBackfillDoneRef = useRef(false);
  useEffect(() => {
    if (freezeBackfillDoneRef.current) return;
    if (!unlocked || foodItems.length === 0 || possibleMeals.length === 0) return;
    const current = getPreference<PossibleFrozenCounterDaysMap>(POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, {});
    let next: PossibleFrozenCounterDaysMap = current;
    let changed = false;
    for (const pm of possibleMeals) {
      const ing = pm.ingredients_override ?? pm.meals?.ingredients;
      // Ouverture programmée par une carte planifiée plus tôt (Sandwich jeu. → Pâtes ven.) :
      // sans elle, ce re-calcul effacerait un Xj légitime dès que le lot n’a pas de compteur en base.
      const inheritedOpening = resolveInheritedFutureLotOpening(
        pm,
        possibleMeals,
        foodItems,
        foodItemIndex,
      );
      const baseStartDate = inheritedOpening ?? pm.counter_start_date;
      if (!Object.prototype.hasOwnProperty.call(next, pm.id)) {
        const days = computePossibleFrozenCounterDays(
          ing,
          foodItems,
          foodItemIndex,
          undefined,
          pm.day_of_week,
          pm.meal_time,
          pm.created_at,
          inheritedOpening,
        );
        next = { ...next, [pm.id]: days };
        changed = true;
        continue;
      }
      const existing = next[pm.id];
      if (
        typeof existing === "number" &&
        pm.day_of_week?.trim() &&
        pm.meal_time?.trim()
      ) {
        const lotProgAtSlot = isLotProgOpeningAtMealSlot(
          ing,
          foodItems,
          pm.day_of_week,
          pm.meal_time,
          foodItemIndex,
        );
        const healed = resolveFrozenPossibleCounterDays(
          existing,
          computePossibleFrozenCounterDays(
            ing,
            foodItems,
            foodItemIndex,
            undefined,
            pm.day_of_week,
            pm.meal_time,
            pm.created_at,
            baseStartDate,
          ),
          {
            baseStartDate,
            dayKey: pm.day_of_week,
            mealTime: pm.meal_time,
            lotProgOpensAtThisSlot: lotProgAtSlot,
            noFoodCounterEvidence:
              !inheritedOpening &&
              hasNoFoodCounterEvidenceWhileStockRemains(
                ing, foodItems, foodItemIndex,
              ),
          },
        );
        if (healed !== existing) {
          next = { ...next, [pm.id]: healed };
          changed = true;
        }
      }
    }
    freezeBackfillDoneRef.current = true;
    if (changed) {
      setPreference.mutate({ key: POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY, value: next });
    }
  }, [unlocked, foodItems, possibleMeals, foodItemIndex, getPreference, setPreference]);

  const [masterSourcePmIds, setMasterSourcePmIdsState] = useState<Set<string>>(new Set());
  const [unParUnSourcePmIds, setUnParUnSourcePmIds] = useState<Set<string>>(new Set());
  const masterSourceHydratedRef = useRef(false);

  // Restaure les cartes « issus de Tous » depuis les prefs (contour jaune après rechargement).
  useEffect(() => {
    if (!unlocked || isPreferencesLoading || masterSourceHydratedRef.current) return;
    masterSourceHydratedRef.current = true;
    setMasterSourcePmIdsState(new Set(getPreference<string[]>(MASTER_SOURCE_PM_IDS_PREF_KEY, [])));
  }, [unlocked, isPreferencesLoading, getPreference]);

  /** Met à jour le Set des cartes issues de Tous et persiste la liste en préférences. */
  const setMasterSourcePmIds = useCallback(
    (updater: SetStateAction<Set<string>>) => {
      setMasterSourcePmIdsState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setPreference.mutate({
          key: MASTER_SOURCE_PM_IDS_PREF_KEY,
          value: Array.from(next),
        });
        return next;
      });
    },
    [setPreference],
  );

  const ninjaStockExemptIds = useMemo(
    () => ({
      ninjaTestPmIds: ninjaCreamiTestPmIds,
      ninjaTestedMealIds: ninjaCreamiMealIds,
    }),
    [ninjaCreamiMealIds, ninjaCreamiTestPmIds],
  );

  /** Meals Ninja Creami exclus des suggestions « aliments pour compléter ». */
  const ninjaCreamiExcludeMealIds = useMemo(() => {
    const ids = new Set(ninjaCreamiMealIds);
    const testPmSet = new Set(ninjaCreamiTestPmIds);
    for (const pm of possibleMeals) {
      if (testPmSet.has(pm.id) && pm.meal_id) ids.add(pm.meal_id);
    }
    return ids;
  }, [ninjaCreamiMealIds, ninjaCreamiTestPmIds, possibleMeals]);

  /** Contour jaune (Tous / Tests / Recettes testées) : la carte ne doit pas toucher au stock. */
  const isStockExemptPossibleCard = useCallback(
    (pmId: string, mealId?: string | null) =>
      isPossibleMealStockExempt({ id: pmId, meal_id: mealId }, masterSourcePmIds, ninjaStockExemptIds),
    [masterSourcePmIds, ninjaStockExemptIds],
  );

  useSyncPlanningQueriesOnResume(qc, unlocked);

  useProgCounterReconcile({
    enabled: unlocked,
    isLoading,
    possibleMeals,
    foodItems,
    foodStockBaselines,
    masterSourcePmIds,
    reconcileMissedProgCounters,
  });

  const wasMorningMealFoodItem = useCallback(
    (fi: FoodItem) => getPreference<string[]>(MORNING_MEAL_PREF_KEY, []).includes(fi.id),
    [getPreference],
  );
  const wasDessertFoodItem = useCallback(
    (fi: FoodItem) => getPreference<string[]>(DESSERT_FOOD_PREF_KEY, []).includes(fi.id),
    [getPreference],
  );

  const attachFoodDeductionSnapshot = useCallback(
    (fi: FoodItem, portion: { grams: number; quantity: number }) =>
      attachPortionDeduction(fi, portion, {
        wasMorningMeal: wasMorningMealFoodItem(fi),
        wasDessertFood: wasDessertFoodItem(fi),
      }),
    [wasDessertFoodItem, wasMorningMealFoodItem],
  );

  /** Réapplique « repas matin » sur la fiche aliment recréée après retour depuis Possible. */
  const syncMorningMealPrefsAfterRestore = useCallback(
    (snapshots: FoodItem[], restoredFoodItems: FoodItem[]) => {
      if (!snapshots.some((snap) => wasMorningMealSnapshot(snap))) return;
      const morningIds = getPreference<string[]>(MORNING_MEAL_PREF_KEY, []);
      const nextIds = remapMorningMealPreferenceIds(snapshots, restoredFoodItems, morningIds);
      const changed =
        nextIds.length !== morningIds.length ||
        nextIds.some((id) => !morningIds.includes(id));
      if (changed) {
        setPreference.mutate({ key: MORNING_MEAL_PREF_KEY, value: nextIds });
      }
    },
    [getPreference, setPreference],
  );

  /** Réapplique « dessert » sur la fiche aliment recréée après retour depuis Possible. */
  const syncDessertFoodPrefsAfterRestore = useCallback(
    (snapshots: FoodItem[], restoredFoodItems: FoodItem[]) => {
      const dessertIds = getPreference<string[]>(DESSERT_FOOD_PREF_KEY, []);
      const dessertNameKeys = getPreference<string[]>(DESSERT_FOOD_NAME_KEYS_PREF_KEY, []);
      if (!snapshots.some((snap) => wasDessertFoodSnapshot(snap) || dessertIds.includes(snap.id))) return;
      const nextIds = remapDessertFoodPreferenceIds(snapshots, restoredFoodItems, dessertIds);
      let nextNameKeys = [...dessertNameKeys];
      for (const snap of snapshots) {
        if (wasDessertFoodSnapshot(snap) || dessertIds.includes(snap.id)) {
          nextNameKeys = addDessertFoodNameKey(nextNameKeys, snap.name);
        }
      }
      for (const id of nextIds) {
        const restored = restoredFoodItems.find((fi) => fi.id === id);
        if (restored?.name) nextNameKeys = addDessertFoodNameKey(nextNameKeys, restored.name);
      }
      const idsChanged =
        nextIds.length !== dessertIds.length ||
        nextIds.some((id) => !dessertIds.includes(id));
      const nameKeysChanged =
        nextNameKeys.length !== dessertNameKeys.length ||
        nextNameKeys.some((key) => !dessertNameKeys.includes(key));
      if (idsChanged) {
        setPreference.mutate({ key: DESSERT_FOOD_PREF_KEY, value: nextIds });
      }
      if (nameKeysChanged) {
        setPreference.mutate({ key: DESSERT_FOOD_NAME_KEYS_PREF_KEY, value: nextNameKeys });
      }
    },
    [getPreference, setPreference],
  );

  /** Réaligne repas matin et dessert après recréation d'une fiche aliment (nouvel id). */
  const syncFoodItemRolePrefsAfterRecreate = useCallback(
    async (snapshots: FoodItem[]) => {
      if (!snapshots.length) return;
      const { data, error } = await supabase.from("food_items").select("*");
      if (error) return;
      const restored = (data ?? []) as FoodItem[];
      syncMorningMealPrefsAfterRestore(snapshots, restored);
      syncDessertFoodPrefsAfterRestore(snapshots, restored);
    },
    [syncDessertFoodPrefsAfterRestore, syncMorningMealPrefsAfterRestore],
  );

  const {
    optionalMoveDialog,
    optionalIncludeKeys,
    optionalQtyEdits,
    askOptionalIngredientInclusions,
    finishOptionalMoveDialog,
    toggleOptionalIncludeKey,
    updateOptionalQtyEdit,
  } = useOptionalIngredientsMoveDialog();

  // Modes de tri — extraits dans un hook dédié
  const {
    sortModes, masterSortModes, availableSortModes, unParUnSortModes, sortDirections,
    toggleSort, toggleMasterSort, toggleAvailableSort, toggleSortDirection,
    resetSortToManual, resetMasterSortToManual, setUnParUnSort,
  } = useSortModes({ enabled: unlocked });


  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);
  const [chronoOpen, setChronoOpen] = useState(false);
  const [coursesTab, setCoursesTab] = useState<"liste" | "menu" | "boissons">("liste");
  const { stickyChromeRef, stickyChromeHeight } = useStickyChromeHeight([mainPage]);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {
      "ninja-creami": true,
      "ninja-creami-tests": true,
    };
    for (const cat of CATEGORIES) {
      defaults[`master-${cat.value}`] = true;
      defaults[`unparun-${cat.value}`] = true;
    }
    return defaults;
  });
  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { handleMoveToPossibleGeneral, handleMovePartialToPossible } = useMoveToPossible({
    data: { meals, possibleMeals, foodItems, foodItemIndex, stockMap },
    mutations: {
      moveToPossible,
      addMealToPossibleDirectly,
      updatePlanning,
      updatePossibleIngredients,
      getPreference,
      setPreference,
    },
    stockOps: {
      deductIngredientsFromStock,
      deductNameMatchStock,
      adjustStockForIngredientChange,
      updateFoodItemCountersForPlanning,
      attachFoodDeductionSnapshot,
    },
    ui: {
      askOptionalIngredientInclusions,
      updateSnapshots,
      freezePossibleBadgeCounter,
      setMasterSourcePmIds,
      setCollapsedSections,
    },
  });

  const { onMoveNameMatchToPossible, onMoveFoodItemToPossible } = useIndexStockMoveHandlers({
    qc,
    foodItems,
    macroLookup,
    ingredientMacroAutofillSources,
    moveToPossible,
    addMealToPossibleDirectly,
    updatePossibleIngredients,
    deductNameMatchStock,
    attachFoodDeductionSnapshot,
    updateSnapshots,
    freezePossibleBadgeCounter,
  });

  const handleLogoClick = () => {
    setLogoClickCount((c) => {
      const next = c + 1;
      if (next >= 3) { setShowDevMenu(true); return 0; }
      return next;
    });
  };

  if (session === undefined) return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>);

  if (!unlocked) return <PinLock onUnlock={() => { }} />;

  const openDialog = (target: "all" | "possible" = "all") => {
    setNewCategory(activeCategory);
    setAddTarget(target);
    setDialogOpen(true);
  };

  const handleAdd = (target?: "all" | "possible") => {
    const finalTarget = target || addTarget;
    const validationError = validateMealName(newName);
    if (validationError) {
      toast({ title: "Données invalides", description: validationError, variant: "destructive" });
      return;
    }
    const trimmedName = newName.trim();
    if (finalTarget === "possible") {
      addMealToPossibleDirectly.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: (data) => {
          if (data?.id) {
            freezePossibleBadgeCounter(data.id, null, null, null, undefined, foodItems);
          }
          if (data?.meal_id) {
            const current = getPreference<string[]>(POSSIBLE_ONLY_MEAL_IDS_PREF_KEY, []);
            setPreference.mutate({
              key: POSSIBLE_ONLY_MEAL_IDS_PREF_KEY,
              value: appendPossibleOnlyMealId(current, data.meal_id),
            });
          }
          setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" });
        }
      });
    } else {
      addMeal.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: () => {
          setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté 🎉" });
        }
      });
    }
  };

  const handleRandomPick = (cat: string) => {
    const pick = getRandomPossible(cat);
    if (!pick) { toast({ title: "Aucun repas possible" }); return; }
    setHighlightedId(pick.id);
    toast({ title: `🎲 ${pick.meals.name}` });
    setTimeout(() => setHighlightedId(null), 3000);
  };

  const getSortedPossible = (cat: string): PossibleMeal[] => {
    const items = getPossibleByCategory(cat);
    const mode = sortModes[cat] || "manual";
    let sorted = items;
    if (mode === "expiration") sorted = sortByExpiration(items);
    else if (mode === "planning") sorted = sortByPlanning(items);
    // Non planifiés : Pot #3 / #6 au-dessus de Pot #?
    return prioritizeNumberedPotsAmongUnplanned(sorted);
  };

  const handleReorderMeals = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getMealsByCategory(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    resetMasterSortToManual(cat);
  };

  const getSortedMaster = (cat: string): Meal[] => {
    let items = getMealsByCategory(cat);
    if (cat === "dessert") {
      items = filterOutNinjaCreamiMeals(items, ninjaCreamiMealIds);
    }
    const mode = masterSortModes[cat] || "manual";
    const asc = sortDirections[`master-${cat}`] !== false;
    /** Aligné MealCard : note basée sur les ingrédients encore en stock. */
    const isIngredientAvailable = (name: string) => {
      const key = findStockKey(stockMap, name);
      if (!key) return false;
      const stock = stockMap.get(key);
      if (!stock) return false;
      return stock.infinite || stock.grams > 0 || stock.count > 0;
    };
    return sortMealsByMasterMode(items, mode, {
      ascending: asc,
      isIngredientAvailable,
      satietySources: ingredientMacroAutofillSources,
    });
  };

  const handleReorderPossible = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getSortedPossible(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderPossibleMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    resetSortToManual(cat);
  };

  return (
    <div className="min-h-screen bg-background">
      {showDevMenu && (
        <DevMenu
          onClose={() => setShowDevMenu(false)}
          getMealsByCategory={getMealsByCategory}
          shoppingGroups={shoppingGroups}
          shoppingItems={shoppingItems}
          foodItems={foodItems}
          blockedCount={blockedCount}
          setBlockedCount={setBlockedCount}
        />
      )}

      <div ref={stickyChromeRef} className="sticky top-0 z-20 bg-background">
        <header className="border-b px-2 py-2 sm:px-4 sm:py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-1 sm:gap-2 min-w-0 w-full">
            <div className="flex items-center gap-1 shrink-0">
              <h1 className="text-base sm:text-xl font-extrabold text-foreground cursor-pointer select-none" onClick={handleLogoClick} title="">🍽️</h1>
              {/* Badge PIN : visible seulement s’il reste de la place (sm+) */}
              {blockedCount !== null && (
                <span
                  title={`${blockedCount} tentative${blockedCount > 1 ? "s" : ""} d'accès non autorisée${blockedCount > 1 ? "s" : ""} depuis la création`}
                  className="hidden sm:flex items-center gap-0.5 text-[9px] font-bold text-destructive/80 bg-destructive/10 rounded-full px-1 py-0.5 cursor-default shrink-0"
                >
                  <ShieldAlert className="h-2 w-2" />{blockedCount}
                </span>
              )}
            </div>

            {/* Groupe central : Macro collé à gauche de la nav, case collée à droite */}
            <div className="flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                onClick={() => setMainPage("macros")}
                className={`shrink-0 py-0.5 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 px-1.5 sm:px-2 bg-muted ${mainPage === "macros" ? "bg-background shadow-sm" : ""}`}
                title="Macro ingrédients"
              >
                <span className="text-[11px] leading-tight md:hidden">🌾</span>
                <Wheat className="hidden h-2.5 w-2.5 shrink-0 md:block md:h-3 md:w-3" />
                <span className={`hidden md:inline text-[8px] md:text-xs whitespace-nowrap leading-tight ${mainPage === "macros" ? "text-amber-500 font-bold" : "text-muted-foreground"}`}>Macro ingrédients</span>
              </button>

              <div className="bg-muted rounded-full p-0.5 py-1 md:py-[6px] flex items-center justify-center gap-0.5 md:gap-1 shrink-0">
                {([
                  { page: "aliments" as MainPage, icon: <Apple className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Aliments", activeColor: "text-lime-600 dark:text-lime-400" },
                  { page: "repas" as MainPage, icon: <UtensilsCrossed className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Repas", activeColor: "text-orange-500" },
                  { page: "planning" as MainPage, icon: <CalendarRange className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Planning", activeColor: "text-blue-500" },
                  { page: "courses" as MainPage, icon: <ShoppingCart className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Courses", activeColor: "text-green-500" },
                ] as const).map(({ page, icon, label, activeColor }) => (
                  <button key={page} onClick={() => setMainPage(page)} title={label}
                    className={`shrink-0 py-0.5 md:py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 md:gap-1 px-1.5 sm:px-2 md:px-3 ${mainPage === page ? "bg-background shadow-sm" : ""}`}>
                    {icon}
                    <span className={`text-[8px] sm:text-[9px] md:text-sm whitespace-nowrap leading-tight ${mainPage === page ? `${activeColor} font-bold` : "text-muted-foreground"}`}>{label}</span>
                  </button>
                ))}
              </div>

              <label
                htmlFor="site-hide-calorie-totals"
                className="flex items-center justify-center gap-1.5 cursor-pointer select-none shrink-0"
                title="Masque les totaux kcal (Planning) et les calories sur les cartes Repas ; « Seuil max » affiche « Calorie »"
              >
                <Checkbox
                  id="site-hide-calorie-totals"
                  checked={hideDayCalorieTotals}
                  onCheckedChange={(checked) => {
                    setPreference.mutate({
                      key: PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY,
                      value: !!checked,
                    });
                  }}
                  className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                />
                <span className="hidden sm:inline text-[9px] md:text-[10px] text-muted-foreground whitespace-nowrap leading-tight">
                  Masquer calories
                </span>
              </label>
            </div>

            <button onClick={() => setChronoOpen(true)}
              className="text-[8px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 shrink-0 bg-muted/60 hover:bg-muted rounded-full px-1.5 sm:px-2.5 py-0.5 sm:py-1"
              title={format(new Date(), "EEEE d MMMM", { locale: fr })}
            >
              <span className="capitalize">{format(new Date(), 'EEE', { locale: fr })}</span>
              <span className="font-black text-foreground">{format(new Date(), 'd')}</span>
            </button>
          </div>
        </header>

        {mainPage === "repas" && (
          <div className="px-3 sm:px-4 pt-2 pb-2">
            <div className="relative max-w-6xl mx-auto">
              <div className="flex items-center gap-2">
                {/* Fond bleu : en 1 colonne, les onglets sont centrés dedans */}
                <div className="flex-1 min-w-0 h-10 rounded-2xl bg-[#2b3954] flex items-center justify-center overflow-x-auto">
                  <div className="inline-flex h-10 items-center p-1 text-muted-foreground md:hidden">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setActiveCategory(c.value)}
                        className={`inline-flex items-center justify-center whitespace-nowrap rounded-xl px-1.5 sm:px-3 py-1 text-[9px] sm:text-xs font-medium transition-all ${activeCategory === c.value ? "bg-background text-foreground shadow-sm" : ""}`}
                      >
                        <span className="mr-0.5">{c.emoji}</span>
                        <span className="leading-tight">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="rounded-full gap-1 text-xs shrink-0 relative z-10" onClick={() => openDialog("all")}>
                      <Plus className="h-3 w-3" /> <span className="hidden sm:inline">Ajouter</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent aria-describedby={undefined}>
                    <DialogHeader><DialogTitle>Nouveau repas</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-3">
                      <Input autoFocus placeholder="Ex: Pâtes carbonara" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()} className="rounded-xl" />
                      <Select value={newCategory} onValueChange={(v) => setNewCategory(v as MealCategory)}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button onClick={() => handleAdd("all")} disabled={!newName.trim()} className="flex-1 text-xs rounded-xl">Tous les repas</Button>
                        <Button onClick={() => handleAdd("possible")} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs rounded-xl">Possibles uniquement</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {/* ≥ md (2 colonnes) : onglets centrés sur la largeur de l’écran */}
              <div className="hidden md:flex absolute inset-0 items-center justify-center pointer-events-none">
                <div className="pointer-events-auto inline-flex h-10 max-w-[calc(100%-7rem)] items-center overflow-x-auto gap-1 p-1 text-muted-foreground">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setActiveCategory(c.value)}
                      className={`inline-flex items-center justify-center whitespace-nowrap rounded-xl px-4 lg:px-5 py-1 text-xs lg:text-sm font-medium transition-all ${activeCategory === c.value ? "bg-background text-foreground shadow-sm" : ""}`}
                    >
                      <span className="mr-1">{c.emoji}</span>
                      <span className="leading-tight">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <Chronometer open={chronoOpen} onOpenChange={setChronoOpen} />

      <OptionalIngredientsMoveDialog
        open={!!optionalMoveDialog}
        mealName={optionalMoveDialog?.mealName ?? ""}
        mealCategory={optionalMoveDialog?.mealCategory ?? null}
        ingredients={optionalMoveDialog?.ingredients ?? null}
        groups={optionalMoveDialog?.groups ?? []}
        includeKeys={optionalIncludeKeys}
        qtyEdits={optionalQtyEdits}
        foodItems={foodItems}
        foodItemIndex={foodItemIndex}
        ingredientMacroSources={ingredientMacroAutofillSources}
        hideDayCalorieTotals={hideDayCalorieTotals}
        onToggleKey={toggleOptionalIncludeKey}
        onQtyEdit={updateOptionalQtyEdit}
        onConfirm={() =>
          finishOptionalMoveDialog({
            includeKeys: new Set(optionalIncludeKeys),
            qtyEdits: optionalQtyEdits,
          })
        }
        onCancel={() => finishOptionalMoveDialog(null)}
      />

      <main className={`${mainPage === "planning" ? "max-w-none w-full" : "max-w-6xl"} mx-auto px-2 pb-3 sm:px-4 sm:pb-4 ${mainPage === "repas" ? "pt-2 sm:pt-3" : "pt-3 sm:pt-4"}`}>
        <Suspense fallback={<div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
          {mainPage === "aliments" && (
            <ErrorBoundary section="Aliments">
              <LazyFoodItems />
            </ErrorBoundary>
          )}
          {mainPage === "macros" && (
            <ErrorBoundary section="Macro ingrédients">
              <LazyMacroIngredients
                meals={meals}
                possibleMeals={possibleMeals}
                foodItems={foodItems}
                macroLibrary={macroLibrary}
                onSaveMacroLibrary={saveMacroLibrary}
                onUpdateMealIngredients={(id, ingredients) => updateIngredients.mutate({ id, ingredients })}
                onUpdatePossibleIngredients={(id, ingredients_override) => updatePossibleIngredients.mutate({ id, ingredients_override })}
                onUpdateFoodItemMacro={(id, updates) => updateFoodItemMutation.mutate({ id, ...updates })}
              />
            </ErrorBoundary>
          )}
          {mainPage === "courses" && (
            <ErrorBoundary section="Courses">
              <div className="sticky z-10 bg-background pb-2 pt-1" style={{ top: stickyChromeHeight }}>
                <div className="flex items-center gap-1 bg-muted rounded-full p-0.5 max-w-md mx-auto">
                  <button onClick={() => setCoursesTab("liste")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "liste" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🛒 Liste</button>
                  <button onClick={() => setCoursesTab("menu")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "menu" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🎲 Menu</button>
                  <button onClick={() => setCoursesTab("boissons")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap px-2 ${coursesTab === "boissons" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>⚡ Boissons</button>
                </div>
                {coursesTab === "liste" && <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none justify-center mt-1.5">
                  <input
                    type="checkbox"
                    checked={getPreference<boolean>('shopping_show_green_checks', true)}
                    onChange={(e) => {
                      const newChecked = e.target.checked;
                      // Optimistically update the preference cache FIRST to prevent stale reads on tab switch
                      qc.setQueryData<{ id: string; key: string; value: any }[]>(["user_preferences"], old =>
                        old?.map(p => p.key === 'shopping_show_green_checks' ? { ...p, value: newChecked } : p) ?? []
                      );
                      if (!newChecked) {
                        // Désactiver : décocher simplement toutes les coches vertes, préserver les quantités blanches
                        for (const si of shoppingItems) {
                          if (si.secondary_checked) toggleShoppingSecondaryCheck.mutate({ id: si.id, secondary_checked: false });
                        }
                      } else {
                        // Réactiver : ré-appliquer les coches à partir des besoins persistés
                        const pNeeds = getPreference<Record<string, { grams: number; count: number; rawName?: string }>>('menu_generator_needs_v1', {});
                        const entries = Object.entries(pNeeds);
                        if (entries.length > 0) {
                          const tjKeys = new Set(foodItems.filter(fi => fi.storage_type === 'toujours').map(fi => normalizeKey(fi.name)));
                          const tjArr = [...tjKeys];
                          const tjGrpIds = new Set(shoppingGroups.filter(g => { const n = normalizeKey(g.name); return n.includes('toujours present') || n.includes('toujours la'); }).map(g => g.id));
                          const isTJ = (si: { name: string; group_id: string | null }, k: string) =>
                            !!(si.group_id && tjGrpIds.has(si.group_id)) || tjKeys.has(k) || tjArr.some(t => smartFoodContains(si.name, t));
                          const matched = new Set<string>();
                          const dqMap = new Map<string, number>();
                          for (const [nk, need] of entries) {
                            const exact: typeof shoppingItems = [];
                            const partial: typeof shoppingItems = [];
                            const matchName = need.rawName || nk;
                            for (const si of shoppingItems) {
                              const k = normalizeKey(si.name);
                              if (isTJ(si, k)) continue;
                              if (normalizeKey(si.name) === normalizeKey(nk)) exact.push(si);
                              else if (smartFoodContains(si.name, matchName)) partial.push(si);
                            }
                            const tgts = exact.length > 0 ? exact : (partial.length === 1 ? partial : []);
                            for (const si of tgts) {
                              matched.add(si.id);
                              const nbV = si.content_quantity ? parseFloat(si.content_quantity.replace(/[^0-9.,]/g, '').replace(',', '.')) : 0;
                              const isG = si.content_quantity_type === 'g' || (!si.content_quantity_type && /g/i.test(si.content_quantity || ''));
                              let qN = 1;
                              if (isG && nbV > 0 && need.grams > 0) qN = Math.ceil(need.grams / nbV);
                              else if (!isG && nbV > 0 && need.count > 0) qN = Math.ceil(need.count / nbV);
                              else if (need.count > 0) qN = Math.ceil(need.count);
                              dqMap.set(si.id, Math.max(dqMap.get(si.id) || 0, qN));
                            }
                          }
                          for (const si of shoppingItems) {
                            if (matched.has(si.id)) {
                              toggleShoppingSecondaryCheck.mutate({ id: si.id, secondary_checked: true });
                            }
                          }
                        }
                        sessionStorage.setItem('menu_initial_sync_done', 'true');
                      }
                      setPreference.mutate({ key: 'shopping_show_green_checks', value: newChecked });
                    }}
                    className="h-3 w-3 rounded accent-green-500"
                  />
                  Menu semaine
                </label>}
              </div>
              {coursesTab === "liste" ? (
                <LazyShoppingList />
              ) : coursesTab === "menu" ? (
                <LazyMealPlanGenerator />
              ) : (
                <LazyEnergyDrinksList />
              )}
            </ErrorBoundary>
          )}
          {mainPage === "planning" && (
            <ErrorBoundary section="Planning">
              <LazyWeeklyPlanning
                masterSourcePmIds={masterSourcePmIds}
                unParUnSourcePmIds={unParUnSourcePmIds}
                ninjaCreamiTestPmIds={ninjaCreamiTestPmIds}
                ninjaCreamiMealIds={ninjaCreamiMealIds}
              />
            </ErrorBoundary>
          )}
          {mainPage === "repas" &&
            <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MealCategory)}>
              {CATEGORIES.map((cat) =>
                <TabsContent key={cat.value} value={cat.value} className="mt-0">
                  <ErrorBoundary section={`Repas - ${cat.label}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <div className="flex flex-col gap-3 sm:gap-4 order-1">
                        <LazyMasterList
                          category={cat}
                          meals={getSortedMaster(cat.value)}
                          foodItems={foodItems}
                          sortMode={(masterSortModes[cat.value] || "manual") as any}
                          sortAsc={sortDirections[`master-${cat.value}`] !== false}
                          onToggleSort={() => toggleMasterSort(cat.value)}
                          onToggleSortDirection={() => toggleSortDirection(`master-${cat.value}`)}
                          collapsed={collapsedSections[`master-${cat.value}`] ?? false}
                          onToggleCollapse={() => toggleSectionCollapse(`master-${cat.value}`)}
                          onMoveToPossible={(id) => handleMoveToPossibleGeneral(id, "master")}
                          onRename={(id, name) => renameMeal.mutate({ id, name })}
                          onDelete={(id) => deleteMeal.mutate(id)}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateProtein={(id, prot) => updateProtein.mutate({ id, protein: prot })}
                          onUpdateFiber={(id, fiber) => updateFiber.mutate({ id, fiber })}
                          onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                          onUpdateIngredients={(id, ing) => {
                            if (ing) {
                              const { sourceIngredients, updates } = propagateIngredientMacros(id, ing, meals);
                              updateIngredients.mutate({ id, ingredients: sourceIngredients });
                              for (const u of updates) updateIngredients.mutate({ id: u.id, ingredients: u.ingredients });
                            } else {
                              updateIngredients.mutate({ id, ingredients: ing });
                            }
                          }}
                          onToggleFavorite={(id) => {
                            const meal = meals.find((m) => m.id === id);
                            if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                          onUpdateDescription={(id, description) => updateDescription.mutate({ id, description })}
                          onReorder={(from, to) => handleReorderMeals(cat.value, from, to)}
                          ingredientMacroAutofillSources={ingredientMacroAutofillSources} />

                        {cat.value === "bonus" && (
                          <div className="space-y-3">
                          <LazyZeroCalorieBonusSection
                            title="Tous · 0 calorie"
                            groups={bonusZeroCalorieGroups}
                            onGroupsChange={(groups) => {
                              saveBonusCatalogLocalBackup(BONUS_ZERO_CALORIE_LOCAL_BACKUP_KEY, groups);
                              setPreferencesBatch.mutate(
                                [
                                  { key: BONUS_ZERO_CALORIE_GROUPS_KEY, value: groups },
                                  {
                                    key: BONUS_ZERO_CALORIE_LINES_KEY,
                                    value: flattenBonusZeroCalorieGroups(groups),
                                  },
                                ],
                                {
                                  onSuccess: () =>
                                    markBonusCatalogSynced(BONUS_ZERO_CALORIE_LOCAL_BACKUP_KEY),
                                },
                              );
                            }}
                            collapsed={collapsedSections["bonus-zero-cal-tous"] ?? true}
                            onToggleCollapse={() => toggleSectionCollapse("bonus-zero-cal-tous")}
                            ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                            ingredientSuggestions={foodItems.map((fi) => fi.name)}
                            onIngredientNameCommit={(line: NinjaCreamiCatalogLine) => {
                              if (!line.name.trim()) return;
                              const nextLib = upsertMacroLibraryFromNinjaLineName(
                                macroLibrary,
                                line.name,
                                line.cal,
                                line.pro,
                                line.fiber,
                                { overwrite: true },
                              );
                              if (nextLib !== macroLibrary) saveMacroLibrary(nextLib);
                            }}
                            onCreateFromSelection={({ name, ingredients, calories, protein, fiber }) => {
                              addMealToPossibleDirectly.mutate(
                                {
                                  name,
                                  category: "bonus",
                                  ingredients,
                                  calories,
                                  protein,
                                  fiber,
                                },
                                {
                                  onSuccess: (data) => {
                                    if (data?.id) {
                                      freezePossibleBadgeCounter(
                                        data.id,
                                        null,
                                        null,
                                        null,
                                        undefined,
                                        foodItems,
                                      );
                                      // Pas de lien Master / stock → pas d’encadré jaune.
                                    }
                                    toast({ title: "Carte Possible créée depuis Tous · 0 calorie 🍃" });
                                  },
                                },
                              );
                            }}
                          />
                          <LazyZeroCalorieBonusSection
                            title="Tous · bas en calorie"
                            groups={bonusLowCalorieGroups}
                            onGroupsChange={(groups) => {
                              saveBonusCatalogLocalBackup(BONUS_LOW_CALORIE_LOCAL_BACKUP_KEY, groups);
                              setPreference.mutate(
                                {
                                  key: BONUS_LOW_CALORIE_GROUPS_KEY,
                                  value: groups,
                                },
                                {
                                  onSuccess: () =>
                                    markBonusCatalogSynced(BONUS_LOW_CALORIE_LOCAL_BACKUP_KEY),
                                },
                              );
                            }}
                            collapsed={collapsedSections["bonus-low-cal-tous"] ?? true}
                            onToggleCollapse={() => toggleSectionCollapse("bonus-low-cal-tous")}
                            hideMacros={false}
                            ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                            ingredientSuggestions={foodItems.map((fi) => fi.name)}
                            onIngredientNameCommit={(line: NinjaCreamiCatalogLine) => {
                              if (!line.name.trim()) return;
                              const nextLib = upsertMacroLibraryFromNinjaLineName(
                                macroLibrary,
                                line.name,
                                line.cal,
                                line.pro,
                                line.fiber,
                                { overwrite: true },
                              );
                              if (nextLib !== macroLibrary) saveMacroLibrary(nextLib);
                            }}
                            onCreateFromSelection={({ name, ingredients, calories, protein, fiber }) => {
                              addMealToPossibleDirectly.mutate(
                                {
                                  name,
                                  category: "bonus",
                                  ingredients,
                                  calories,
                                  protein,
                                  fiber,
                                },
                                {
                                  onSuccess: (data) => {
                                    if (data?.id) {
                                      freezePossibleBadgeCounter(
                                        data.id,
                                        null,
                                        null,
                                        null,
                                        undefined,
                                        foodItems,
                                      );
                                    }
                                    toast({ title: "Carte Possible créée depuis Tous · bas en calorie 🍃" });
                                  },
                                },
                              );
                            }}
                          />
                          </div>
                        )}

                        {cat.value === "dessert" && (
                          <LazyNinjaCreamiSection
                            collapsed={collapsedSections["ninja-creami"] ?? true}
                            onToggleCollapse={() => toggleSectionCollapse("ninja-creami")}
                            testedCollapsed={collapsedSections["ninja-creami-tested"] ?? false}
                            onToggleTestedCollapse={() => toggleSectionCollapse("ninja-creami-tested")}
                            testsCollapsed={collapsedSections["ninja-creami-tests"] ?? true}
                            onToggleTestsCollapse={() => toggleSectionCollapse("ninja-creami-tests")}
                            testedMeals={applyNinjaCreamiMealDisplayNames(
                              filterNinjaCreamiTestedMeals(
                                getMealsByCategory("dessert"),
                                ninjaCreamiMealIds,
                              ),
                              ninjaCreamiMealDisplayNames,
                            )}
                            testedSortMode={masterSortModes[NINJA_CREAMI_TESTED_SORT_KEY] || "manual"}
                            testedSortAsc={sortDirections[`master-${NINJA_CREAMI_TESTED_SORT_KEY}`] !== false}
                            onToggleTestedSort={() => toggleMasterSort(NINJA_CREAMI_TESTED_SORT_KEY)}
                            onToggleTestedSortDirection={() =>
                              toggleSortDirection(`master-${NINJA_CREAMI_TESTED_SORT_KEY}`)
                            }
                            foodItems={foodItems}
                            baseGroups={ninjaCreamiBaseGroups}
                            extrasLines={ninjaCreamiExtrasLines}
                            onBaseGroupsChange={(groups) => {
                              // Refuse d’écraser une Base remplie par une sauvegarde vide (course prefs).
                              if (
                                !ninjaCreamiBaseGroupsHaveContent(groups) &&
                                ninjaCreamiBaseGroupsHaveContent(ninjaCreamiBaseGroups)
                              ) {
                                return;
                              }
                              if (ninjaCreamiBaseGroupsHaveContent(groups)) {
                                saveNinjaCreamiBaseGroupsLocalBackup(groups);
                              }
                              setPreferencesBatch.mutate([
                                { key: NINJA_CREAMI_BASE_GROUPS_KEY, value: groups },
                                {
                                  key: NINJA_CREAMI_BASE_LINES_KEY,
                                  value: flattenNinjaCreamiBaseGroups(groups),
                                },
                              ]);
                            }}
                            onExtrasLinesChange={(lines) =>
                              setPreference.mutate({ key: NINJA_CREAMI_EXTRAS_LINES_KEY, value: lines })
                            }
                            testsGroupOrder={ninjaCreamiTestsGroupOrder}
                            onTestsGroupOrderChange={(order) =>
                              setPreference.mutate({
                                key: NINJA_CREAMI_TESTS_GROUP_ORDER_KEY,
                                value: order,
                              })
                            }
                            onIngredientNameCommit={(line: NinjaCreamiCatalogLine) => {
                              if (!line.name.trim()) return;
                              const nextLib = upsertMacroLibraryFromNinjaLineName(
                                macroLibrary,
                                line.name,
                                line.cal,
                                line.pro,
                                line.fiber,
                                { overwrite: true },
                              );
                              if (nextLib !== macroLibrary) saveMacroLibrary(nextLib);
                            }}
                            ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                            onAddTestedRecipe={() => {
                              const name = window.prompt("Nom de la recette testée");
                              if (!name?.trim()) return;
                              const validationError = validateMealName(name);
                              if (validationError) {
                                toast({
                                  title: "Données invalides",
                                  description: validationError,
                                  variant: "destructive",
                                });
                                return;
                              }
                              addMeal.mutate(
                                { name: name.trim(), category: "dessert" },
                                {
                                  onSuccess: (data) => {
                                    if (data?.id) {
                                      setPreference.mutate({
                                        key: NINJA_CREAMI_MEAL_IDS_KEY,
                                        value: addNinjaCreamiMealId(ninjaCreamiMealIds, data.id),
                                      });
                                    }
                                    toast({ title: "Recette testée ajoutée 🎉" });
                                  },
                                },
                              );
                            }}
                            onMoveToPossible={(id) => handleMoveToPossibleGeneral(id, "master")}
                            onRename={(id, name) => {
                              // Nom local Recettes testées : ne pas renommer meals.name
                              // (sinon la carte Possible liée change aussi).
                              setPreference.mutate({
                                key: NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY,
                                value: setNinjaCreamiMealDisplayName(
                                  ninjaCreamiMealDisplayNames,
                                  id,
                                  name,
                                ),
                              });
                            }}
                            onDelete={(id) => {
                              // Retire uniquement de « Recettes testées » : ne pas supprimer le repas
                              // (sinon les cartes Possible liées disparaissent aussi).
                              setPreference.mutate({
                                key: NINJA_CREAMI_MEAL_IDS_KEY,
                                value: removeNinjaCreamiMealId(ninjaCreamiMealIds, id),
                              });
                              setPreference.mutate({
                                key: NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY,
                                value: removeNinjaCreamiMealDisplayName(
                                  ninjaCreamiMealDisplayNames,
                                  id,
                                ),
                              });
                              setMealAvailable.mutate({ id, is_available: false });
                            }}
                            onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                            onUpdateProtein={(id, prot) => updateProtein.mutate({ id, protein: prot })}
                            onUpdateFiber={(id, fiber) => updateFiber.mutate({ id, fiber })}
                            onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                            onUpdateIngredients={(id, ing) => {
                              if (ing) {
                                const { sourceIngredients, updates } = propagateIngredientMacros(id, ing, meals);
                                updateIngredients.mutate({ id, ingredients: sourceIngredients });
                                for (const u of updates) {
                                  updateIngredients.mutate({ id: u.id, ingredients: u.ingredients });
                                }
                              } else {
                                updateIngredients.mutate({ id, ingredients: ing });
                              }
                            }}
                            onToggleFavorite={(id) => {
                              const meal = meals.find((m) => m.id === id);
                              if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                            }}
                            onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                            onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                            onUpdateDescription={(id, description) =>
                              updateDescription.mutate({ id, description })
                            }
                            testedOverviewNotes={
                              typeof ninjaCreamiTestedOverviewNotes === "string"
                                ? ninjaCreamiTestedOverviewNotes
                                : ""
                            }
                            onTestedOverviewNotesChange={(notes) =>
                              setPreference.mutate({
                                key: NINJA_CREAMI_TESTED_OVERVIEW_NOTES_KEY,
                                value: notes,
                              })
                            }
                            createBusy={addMealToPossibleDirectly.isPending}
                            onCreateFromTests={({ name, ingredients, calories, protein, fiber }) => {
                              addMealToPossibleDirectly.mutate(
                                {
                                  name,
                                  category: "dessert",
                                  ingredients,
                                  calories,
                                  protein,
                                  fiber,
                                },
                                {
                                  onSuccess: (data) => {
                                    if (data?.id) {
                                      freezePossibleBadgeCounter(data.id, null, null, null, undefined, foodItems);
                                      setPreference.mutate({
                                        key: NINJA_CREAMI_TEST_PM_IDS_KEY,
                                        value: addNinjaCreamiTestPmId(ninjaCreamiTestPmIds, data.id),
                                      });
                                      // Tests → Possible : pas de lien stock (comme Tous).
                                      setMasterSourcePmIds((prev) => addMasterSourcePmIds(prev, [data.id]));
                                    }
                                    toast({ title: "Carte Possible créée depuis Tests 🎉" });
                                  },
                                },
                              );
                            }}
                          />
                        )}

                        <LazyAvailableList
                          category={cat}
                          meals={applyNinjaCreamiAuChoixDisplayNames(
                            getMealsByCategory(cat.value),
                            ninjaCreamiMealIds,
                            ninjaCreamiMealDisplayNames,
                          )}
                          foodItems={foodItems}
                          ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                          allMeals={meals}
                          ninjaCreamiExcludeMealIds={ninjaCreamiExcludeMealIds}
                          stockMap={stockMap}
                          sortMode={availableSortModes[cat.value] || "manual"}
                          sortAsc={sortDirections[`available-${cat.value}`] !== false}
                          onToggleSort={() => toggleAvailableSort(cat.value)}
                          onToggleSortDirection={() => toggleSortDirection(`available-${cat.value}`)}
                          collapsed={collapsedSections[`available-${cat.value}`] ?? false}
                          onToggleCollapse={() => toggleSectionCollapse(`available-${cat.value}`)}
                          onMoveToPossible={(mealId) =>
                            handleMoveToPossibleGeneral(
                              mealId,
                              // Recettes testées dans Au choix = équivalent Tous (pas de déduction stock).
                              ninjaCreamiMealIds.includes(mealId) ? "master" : "available",
                            )
                          }
                          onMovePartialToPossible={(meal, ratio) => handleMovePartialToPossible(meal, ratio, cat.value)}
                          onMoveNameMatchToPossible={(meal, fi, ratio) =>
                            onMoveNameMatchToPossible(cat.value, meal, fi, ratio)
                          }
                          onMoveFoodItemToPossible={(fi) => onMoveFoodItemToPossible(cat.value, fi)}
                          onDeleteFoodItem={(id) => { deleteFoodItem(id); }}
                          onRename={(id, name) => {
                            // Recettes Ninja : nom d’affichage local (Possible garde meals.name).
                            if (ninjaCreamiMealIds.includes(id)) {
                              let cleaned = name.trim();
                              if (cleaned.startsWith(NINJA_CREAMI_AU_CHOIX_NAME_PREFIX)) {
                                cleaned = cleaned
                                  .slice(NINJA_CREAMI_AU_CHOIX_NAME_PREFIX.length)
                                  .trim();
                              }
                              setPreference.mutate({
                                key: NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY,
                                value: setNinjaCreamiMealDisplayName(
                                  ninjaCreamiMealDisplayNames,
                                  id,
                                  cleaned,
                                ),
                              });
                              return;
                            }
                            renameMeal.mutate({ id, name });
                          }}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                          onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                          onToggleFavorite={(id) => {
                            const meal = meals.find((m) => m.id === id);
                            if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                          onUpdateDescription={(id, description) => updateDescription.mutate({ id, description })}
                          onAfterMoveToPossible={() => {
                            if (typeof window === "undefined") return;
                            if (!window.matchMedia("(max-width: 767px)").matches) return;
                            setCollapsedSections(prev => ({ ...prev, [`available-${cat.value}`]: true }));
                          }} />

                      </div>
                      <div className="order-3 md:order-2">
                        <LazyPossibleList
                          category={cat}
                          items={getSortedPossible(cat.value)}
                          allPossibleMeals={possibleMeals}
                          mealsCatalog={meals}
                          possibleOnlyMealIds={getPreference<string[]>(POSSIBLE_ONLY_MEAL_IDS_PREF_KEY, [])}
                          ninjaCreamiTestPmIds={ninjaCreamiTestPmIds}
                          ninjaCreamiMealIds={ninjaCreamiMealIds}
                          ninjaCreamiBaseGroups={
                            cat.value === "dessert" ? ninjaCreamiBaseGroups : undefined
                          }
                          ninjaCreamiExtrasLines={
                            cat.value === "dessert" ? ninjaCreamiExtrasLines : undefined
                          }
                          ninjaCreamiTestsGroupOrder={
                            cat.value === "dessert" ? ninjaCreamiTestsGroupOrder : undefined
                          }
                          onSaveToNinjaTested={(pmId) => {
                            const pm = possibleMeals.find((p) => p.id === pmId);
                            if (!pm?.meal_id) return;

                            /** Finalise l’ajout dans Recettes testées (après sync des ingrédients). */
                            const finishSaveToTested = () => {
                              setMealAvailable.mutate(
                                { id: pm.meal_id, is_available: true },
                                {
                                  onSuccess: () => {
                                    setPreference.mutate({
                                      key: NINJA_CREAMI_MEAL_IDS_KEY,
                                      value: addNinjaCreamiMealId(ninjaCreamiMealIds, pm.meal_id),
                                    });
                                    // Recettes testées = pas de lien stock (comme Tous).
                                    setMasterSourcePmIds((prev) => addMasterSourcePmIds(prev, [pmId]));
                                    toast({ title: "Enregistrée dans Recettes testées 🎉" });
                                  },
                                },
                              );
                            };

                            // Copie les ingrédients Possible (override inclus) vers le meal catalogue.
                            const ingredients = resolveIngredientsForNinjaCreamiTestedSave(pm);
                            const mealIngredients = pm.meals?.ingredients ?? null;
                            const ingredientsChanged =
                              ingredients !== mealIngredients &&
                              String(ingredients ?? "").trim() !== String(mealIngredients ?? "").trim();

                            const cal = getDisplayedPMCalories(pm);
                            const pro = getDisplayedPMProtein(pm, undefined, undefined, foodItems, foodItemIndex);
                            const fiber = getDisplayedPMFiber(pm, undefined, undefined, foodItems, foodItemIndex);

                            const syncMacrosThenFinish = () => {
                              if (cal != null) {
                                updateCalories.mutate({
                                  id: pm.meal_id,
                                  calories: String(Math.round(cal)),
                                });
                              }
                              if (pro != null) {
                                updateProtein.mutate({
                                  id: pm.meal_id,
                                  protein: String(Math.round(pro * 10) / 10),
                                });
                              }
                              if (fiber != null) {
                                updateFiber.mutate({
                                  id: pm.meal_id,
                                  fiber: String(Math.round(fiber * 10) / 10),
                                });
                              }
                              finishSaveToTested();
                            };

                            if (ingredientsChanged) {
                              updateIngredients.mutate(
                                { id: pm.meal_id, ingredients },
                                { onSuccess: syncMacrosThenFinish },
                              );
                            } else {
                              syncMacrosThenFinish();
                            }
                          }}
                          deductionSnapshots={effectiveDeductionSnapshots}
                          frozenCounterDaysByPmId={frozenCounterDaysByPmId}
                          sortMode={sortModes[cat.value] || "manual"}
                          stockMap={stockMap}
                          onToggleSort={() => toggleSort(cat.value)}
                          onRandomPick={() => handleRandomPick(cat.value)}
                          onRemove={(id) => {
                            clearFrozenPossibleBadgeCounter(id);
                            removeFromPossible.mutate(id);
                          }}
                          onReturnWithoutDeduction={async (id) => {
                            const pm = getPossibleByCategory(cat.value).find(p => p.id === id);
                            // Ninja Creami (Tests / Recettes testées) : jamais de restauration stock.
                            if (
                              pm &&
                              isNinjaCreamiStockExemptPossibleMeal(
                                id,
                                pm.meal_id,
                                ninjaCreamiTestPmIds,
                                ninjaCreamiMealIds,
                              )
                            ) {
                              clearFrozenPossibleBadgeCounter(id);
                              removeFromPossible.mutate(id);
                              setMasterSourcePmIds((prev) => {
                                const next = new Set(prev);
                                next.delete(id);
                                return next;
                              });
                              return;
                            }
                            const snapshots = effectiveDeductionSnapshots[id];
                            let restoredFoodItems: FoodItem[] = [];
                            if (snapshots && snapshots.length > 0) {
                              restoredFoodItems = await restoreIngredientsToStock({} as Meal, snapshots);
                              syncMorningMealPrefsAfterRestore(snapshots, restoredFoodItems);
                              syncDessertFoodPrefsAfterRestore(snapshots, restoredFoodItems);
                            } else if (pm?.meals) {
                              const mealForRestore = pm.ingredients_override
                                ? { ...pm.meals, ingredients: pm.ingredients_override }
                                : pm.meals;
                              restoredFoodItems = await restoreIngredientsToStock(mealForRestore, undefined, {
                                fallbackCounterDate: pm.counter_start_date ?? null,
                                fallbackExpirationDate: pm.expiration_date ?? null,
                              });
                            }
                            updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                            clearFrozenPossibleBadgeCounter(id);
                            removeFromPossible.mutate(id);
                            setUnParUnSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });

                            if (pm) {
                              const remainingMeals = filterStockAffectingPossibleMeals(
                                possibleMeals.filter(p => p.id !== id),
                                masterSourcePmIds,
                                ninjaStockExemptIds,
                              );
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              const fallbackCounter =
                                snapshots?.[0]?.counter_start_date ?? pm.counter_start_date ?? null;
                              updateFoodItemCountersForPlanning(
                                null, ing, null, null, fallbackCounter, null, remainingMeals,
                              );
                            }
                          }}
                          onReturnToMaster={(id) => {
                            clearFrozenPossibleBadgeCounter(id);
                            removeFromPossible.mutate(id);
                            setMasterSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });
                            // Retour Tous : pas de synchro Prog. (jamais déduit).
                          }}
                          onSplitQuantity={(id, ratio, baseIng) => {
                            const fromMaster = isStockExemptPossibleCard(id, possibleMeals.find((p) => p.id === id)?.meal_id);
                            splitPossibleMealQuantity.mutate(
                              { id, ratio, baseIngredients: baseIng },
                              {
                                onSuccess: (result) => {
                                  if (fromMaster && result?.newIds?.length) {
                                    setMasterSourcePmIds((prev) =>
                                      addMasterSourcePmIds(prev, result.newIds),
                                    );
                                  }
                                  if (result?.newIds?.length) {
                                    for (const newId of result.newIds) {
                                      copyFrozenPossibleBadgeCounter(id, newId);
                                    }
                                  }
                                },
                              },
                            );
                            updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                          }}
                          onDelete={(id) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            clearFrozenPossibleBadgeCounter(id);
                            deletePossibleMeal.mutate(id);

                            if (pm && !isStockExemptPossibleCard(id, pm.meal_id)) {
                              const remainingMeals = filterStockAffectingPossibleMeals(
                                possibleMeals.filter(p => p.id !== id),
                                masterSourcePmIds,
                                ninjaStockExemptIds,
                              );
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onDuplicate={async (id) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            if (pm?.meals) {
                              const fromMaster = isStockExemptPossibleCard(id, possibleMeals.find((p) => p.id === id)?.meal_id);
                              let snapshots: FoodItem[] = [];
                              if (!fromMaster) {
                                const ingredientsToDeduce = pm.ingredients_override ?? pm.meals.ingredients;
                                const mealForDeduction = { ...pm.meals, ingredients: ingredientsToDeduce };
                                const deductionResult = await deductIngredientsFromStock(mealForDeduction);
                                snapshots = deductionResult.snapshots;
                              }

                              const newId = await duplicatePossibleMeal.mutateAsync(id);
                              if (newId) {
                                if (snapshots.length > 0) {
                                  updateSnapshots(prev => ({ ...prev, [newId]: snapshots }));
                                }
                                copyFrozenPossibleBadgeCounter(id, newId);

                                // 1. Copier les overrides de macros (calories/protéines)
                                const currentCals = getPreference<Record<string, string>>('planning_cal_overrides', {});
                                const currentPros = getPreference<Record<string, string>>('planning_pro_overrides', {});
                                let prefsToUpdate: { key: string; value: any }[] = [];
                                
                                if (currentCals[id]) {
                                  setPreference.mutate({ key: 'planning_cal_overrides', value: { ...currentCals, [newId]: currentCals[id] } });
                                }
                                if (currentPros[id]) {
                                  setPreference.mutate({ key: 'planning_pro_overrides', value: { ...currentPros, [newId]: currentPros[id] } });
                                }

                                // 2. Copier le statut de source (pour le comportement du compteur automatique)
                                if (fromMaster) {
                                  setMasterSourcePmIds(prev => new Set([...prev, newId]));
                                }
                                if (unParUnSourcePmIds.has(id)) {
                                  setUnParUnSourcePmIds(prev => new Set([...prev, newId]));
                                }
                              }
                            } else {
                              duplicatePossibleMeal.mutate(id);
                            }
                          }}
                          onUpdatePlanning={(id, day, time, counter) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            if (pm) {
                              const currentSlotOverrides = getPreference<Record<string, { day: string; time: string }>>('planning_slot_overrides', {});
                              if (currentSlotOverrides[id]) {
                                const { [id]: _removedSlotOverride, ...nextSlotOverrides } = currentSlotOverrides;
                                setPreference.mutate({ key: 'planning_slot_overrides', value: nextSlotOverrides });
                              }
                              const isOccupied = unParUnSourcePmIds.has(id) || isStockExemptPossibleCard(id, pm.meal_id);
                              const effectiveCounter = isOccupied ? null : counter;
                              const fallbackUnParUnIngredients =
                                unParUnSourcePmIds.has(id) && pm.meals
                                  ? (parseQty(pm.meals.grams) > 0 ? `${pm.meals.grams} ${pm.meals.name}` : `${pm.quantity || 1} ${pm.meals.name}`)
                                  : null;
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients ?? fallbackUnParUnIngredients;
                              const nextPossibleMeals = possibleMeals.map((candidate) =>
                                candidate.id === id ? { ...candidate, day_of_week: day, meal_time: time } : candidate
                              );
                              const nextAnalysis =
                                pm.meals && ing
                                  ? analyzeMealIngredients({ ...pm.meals, ingredients: ing }, foodItems, foodItemIndex)
                                  : null;
                              const activeStockFallback = ing
                                ? findEarliestActiveCounterDate(ing, foodItems, foodItemIndex)
                                : undefined;
                              // Pas de repli sur `pm.counter_start_date` : une date carte orpheline
                              // (créneau ven. après replanif dim.) fabriquait un Xj fantôme sans aliment compteur.
                              // resolveCounterStartForPossibleBadge renvoie déjà le fallback carte si stock vidé.
                              const nextResolvedCounter =
                                !isOccupied && pm.meals
                                  ? resolveCounterStartForPossibleBadge(
                                      { ...pm, day_of_week: day, meal_time: time },
                                      nextPossibleMeals,
                                      nextAnalysis?.earliestCounterDate,
                                      pm.counter_start_date ?? undefined,
                                      foodItems,
                                      foodItemIndex,
                                      undefined,
                                      nextAnalysis?.earliestActiveCounterDate,
                                    ) ?? activeStockFallback ?? nextAnalysis?.earliestActiveCounterDate ?? nextAnalysis?.earliestCounterDate ?? null
                                  : null;
                              // Créneau réellement complet : les deux champs doivent être choisis explicitement
                              // (ne pas inférer « midi » dès le jour seul — cela effaçait le compteur trop tôt).
                              const hasFullPlanningSlot = Boolean(day?.trim() && time?.trim());

                              // Le compteur d'une carte Possible est FIGÉ : on le fixe au moment de la planification
                              // et il ne doit plus changer parce qu'une AUTRE recette ouvre le même lot ensuite.
                              const plannedSlotIso =
                                hasFullPlanningSlot && day ? computePlannedCounterDate(day, time) : null;
                              const plannedSlotIsFuture =
                                plannedSlotIso ? new Date(plannedSlotIso).getTime() > Date.now() : false;
                              // Une ouverture « active » sur le stock est-elle un simple artefact de déduction
                              // (compteur posé ≈ création d'une carte) plutôt qu'une vraie ouverture manuelle ?
                              const activeIsArtifact = activeStockFallback
                                ? possibleMeals.some(
                                    (p) =>
                                      p.created_at &&
                                      Math.abs(
                                        new Date(activeStockFallback).getTime() -
                                          new Date(p.created_at).getTime(),
                                      ) < 60_000,
                                  )
                                : true;
                              // Ouverture déjà PROGRAMMÉE du lot par une autre carte planifiée plus tôt.
                              // Deux sources : un compteur futur sur le stock (lotFutureOpening) OU la date résolue
                              // par resolveCounterStartForPossibleBadge (héritée d'une carte planifiée antérieure
                              // partageant le lot — robuste même si le food_item n'a plus de compteur).
                              // Ex. Tenders ouverts lundi soir (par « Riz + Tenders »), cette carte planifiée
                              // mercredi soir doit figer sur lundi pour afficher 2j (mercredi − lundi).
                              const lotFutureOpening = ing
                                ? findEarliestFutureCounterDate(ing, foodItems, foodItemIndex)
                                : undefined;
                              // Ouverture déduite du planning (robuste sans counter_start_date en base,
                              // ex. Blanc de poulet unitaire entamé par « Sandwich » jeu. 19h).
                              const inheritedOpening = resolveInheritedFutureLotOpening(
                                pm, nextPossibleMeals, foodItems, foodItemIndex, day, time,
                                undefined,
                                Object.values(effectiveDeductionSnapshots).flat(),
                              );
                              const slotMsForFreeze = plannedSlotIso ? new Date(plannedSlotIso).getTime() : NaN;
                              const earlierOpeningForFreeze = [lotFutureOpening, nextResolvedCounter, inheritedOpening]
                                .filter((iso): iso is string => {
                                  if (!iso) return false;
                                  const ms = new Date(iso).getTime();
                                  return !Number.isNaN(ms) && ms > Date.now() && (!Number.isNaN(slotMsForFreeze) ? ms < slotMsForFreeze : true);
                                })
                                .reduce<string | undefined>(
                                  (best, iso) => (!best || new Date(iso).getTime() < new Date(best).getTime() ? iso : best),
                                  undefined,
                                );
                              // Ne pas écraser une ouverture RÉELLE (snapshot de déduction ou stock actif)
                              // par le créneau planifié « prog. ». On n’utilise plus la seule
                              // `counter_start_date` carte (souvent périmée) sans corroboration stock.
                              const snapshotPastOpening = ing
                                ? findEarliestActiveCounterDate(ing, effectiveDeductionSnapshots[id] ?? [], foodItemIndex)
                                : undefined;
                              const realPastOpening = [
                                snapshotPastOpening,
                                activeStockFallback,
                                nextAnalysis?.earliestActiveCounterDate ?? undefined,
                              ]
                                .filter((iso): iso is string => {
                                  if (!iso?.trim()) return false;
                                  const ms = new Date(iso).getTime();
                                  return Number.isFinite(ms) && ms <= Date.now();
                                })
                                .reduce<string | undefined>(
                                  (best, iso) =>
                                    !best || new Date(iso).getTime() < new Date(best).getTime() ? iso : best,
                                  undefined,
                                );
                              // Créneau futur + pas de vraie ouverture manuelle → « prog. ».
                              //  - si le lot s'ouvre plus tôt via une autre carte → figer sur CETTE ouverture (Xj),
                              //  - sinon cette carte ouvre le lot → figer sur son propre créneau (0j masqué).
                              // Hors créneau futur : résolution standard (préserve une ouverture réelle passée).
                              const noFoodCounterEvidence = hasNoFoodCounterEvidenceWhileStockRemains(
                                ing, foodItems, foodItemIndex,
                              );
                              const frozenCounter =
                                plannedSlotIsFuture && activeIsArtifact && !realPastOpening
                                  ? (earlierOpeningForFreeze ?? plannedSlotIso)
                                  : (realPastOpening ?? nextResolvedCounter);
                              const preservedCounter =
                                effectiveCounter ??
                                activeStockFallback ??
                                nextResolvedCounter ??
                                pm.counter_start_date ??
                                undefined;
                              // Recette sans compteur aliment NI ouverture héritée d’une carte plus tôt
                              // → ne pas persister une date carte (sinon Cookie ven.→dim. fantôme).
                              const counterForMutate =
                                hasFullPlanningSlot && !isOccupied
                                  ? (noFoodCounterEvidence && !earlierOpeningForFreeze ? null : frozenCounter)
                                  : preservedCounter;
                              updatePlanning.mutate({
                                id,
                                day_of_week: day,
                                meal_time: time,
                                counter_start_date: counterForMutate,
                              });
                              if (hasFullPlanningSlot) {
                                // Priorité à l’ouverture héritée (Sandwich jeu. → Pâtes ven. = 1j),
                                // même si le lot unitaire n’a pas encore de counter_start_date en base.
                                // Sans héritage ni compteur aliment : ne pas réinjecter pm.counter_start_date.
                                const fallbackDate = earlierOpeningForFreeze
                                  ?? (noFoodCounterEvidence
                                    ? (activeStockFallback ?? counter ?? null)
                                    : (frozenCounter ?? activeStockFallback ?? counter ?? pm.counter_start_date ?? null));
                                // Re-gel AVANT de passer les aliments en Prog. : sinon hasActiveFoodItemCounter
                                // devient false et le calcul renvoie null (badge écrasé / disparu).
                                // `fallbackDate` = vraie ouverture (ex. ven. 19h) pour retrouver 1j même si
                                // le stock est déjà Prog. sur sam. soir (re-sélection Soir après bug).
                                // Cartes « Tous » : pas de déduction stock → pas de badge compteur à figer.
                                if (!isOccupied) {
                                  freezePossibleBadgeCounter(id, ing, day, time, pm.created_at, foodItems, fallbackDate);
                                } else {
                                  clearFrozenPossibleBadgeCounter(id);
                                }
                                // Cartes « Tous » : pas de déduction stock → ne pas basculer les aliments en Prog.
                                if (!isStockExemptPossibleCard(id, pm.meal_id)) {
                                  updateFoodItemCountersForPlanning(
                                    id,
                                    ing,
                                    day,
                                    time,
                                    fallbackDate,
                                    pm.created_at,
                                    filterStockAffectingPossibleMeals(
                                      nextPossibleMeals,
                                      masterSourcePmIds,
                                      ninjaStockExemptIds,
                                    ),
                                  );
                                }
                              }
                            }
                          }}
                          onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                          onUpdateCalories={(id, cal, pmId) => {
                            updateCalories.mutate({ id, calories: cal });
                            if (pmId) {
                              const currentCals = getPreference<Record<string, string>>('planning_cal_overrides', {});
                              setPreference.mutate({ key: 'planning_cal_overrides', value: { ...currentCals, [pmId]: cal || "0" } });
                            }
                          }}
                          onUpdateProtein={(id, pro, pmId) => {
                            updateProtein.mutate({ id, protein: pro });
                            if (pmId) {
                              const currentPros = getPreference<Record<string, string>>('planning_pro_overrides', {});
                              setPreference.mutate({ key: 'planning_pro_overrides', value: { ...currentPros, [pmId]: pro || "0" } });
                            }
                          }}
                          onUpdateFiber={(id, fiber) => {
                            updateFiber.mutate({ id, fiber });
                          }}
                          onUpdateGrams={async (id, g, pmId) => {
                            const pm = pmId ? possibleMeals.find(p => p.id === pmId) : possibleMeals.find(p => p.meal_id === id);
                            if (pm && unParUnSourcePmIds.has(pm.id)) {
                              if (pm.meals) {
                                const oldGrams = parseQty(pm.meals.grams);
                                const newGrams = parseQty(g);
                                const delta = oldGrams - newGrams;
                                if (delta !== 0) {
                                  const snapshots = effectiveDeductionSnapshots[pm.id];
                                  let matchingFi =
                                    (snapshots?.[0]
                                      ? foodItems.find((fi) => fi.id === snapshots[0]!.id)
                                      : undefined) ??
                                    foodItems.find(
                                      (fi) =>
                                        strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite,
                                    );
                                  if (matchingFi) {
                                    const perUnit = parseQty(matchingFi.grams);
                                    if (delta > 0) {
                                      if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                                        const currentTotal = getFoodItemTotalGrams(matchingFi);
                                        const newTotal = currentTotal + delta;
                                        const fullUnits = Math.floor(newTotal / perUnit);
                                        const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
                                        await supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", matchingFi.id);
                                        if (rem <= 0 && matchingFi.counter_start_date) await supabase.from("food_items").update({ counter_start_date: null } as any).eq("id", matchingFi.id);
                                      } else {
                                        const current = parseQty(matchingFi.grams);
                                        await supabase.from("food_items").update({ grams: formatNumeric(current + delta) } as any).eq("id", matchingFi.id);
                                      }
                                    } else {
                                      const toDeduct = -delta;
                                      const totalAvail = getFoodItemTotalGrams(matchingFi);
                                      const remaining = totalAvail - toDeduct;
                                      if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", matchingFi.id); }
                                      else if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                                        const fullUnits = Math.floor(remaining / perUnit);
                                        const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                                        await supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", matchingFi.id);
                                      } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", matchingFi.id); }
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  } else if (delta > 0 && snapshots?.[0]) {
                                    // Item was deleted entirely. Recreate it with returned delta
                                    const sn = snapshots[0];
                                    const perUnit = parseQty(sn.grams);
                                    if (sn.quantity !== null && sn.quantity >= 1 && perUnit > 0) {
                                      const fullUnits = Math.floor(delta / perUnit);
                                      const rem = Math.round((delta - fullUnits * perUnit) * 10) / 10;
                                      await supabase.from("food_items").insert(
                                        toFoodItemInsertPayload(sn, {
                                          quantity: rem > 0 ? fullUnits + 1 : fullUnits,
                                          grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                                        }) as any,
                                      );
                                    } else {
                                      await supabase.from("food_items").insert(
                                        toFoodItemInsertPayload(sn, {
                                          grams: formatNumeric(delta),
                                        }) as any,
                                      );
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                    await syncFoodItemRolePrefsAfterRecreate([sn]);
                                  }
                                }
                              }
                            }
                            updateGrams.mutate({ id, grams: g });
                          }}
                          onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                          onUpdatePossibleIngredients={async (pmId, newIngredients) => {
                            const pm = possibleMeals.find(p => p.id === pmId);
                            if (!pm) return;
                            const oldIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
                            // Contour jaune (Tous / Ninja) : pas de déduction initiale → extras / scale non plus.
                            if (!isStockExemptPossibleCard(pmId, pm.meal_id) && (oldIngredients || newIngredients)) {
                              const newSnaps = await adjustStockForIngredientChange(oldIngredients, newIngredients, effectiveDeductionSnapshots[pmId]);
                              if (newSnaps.length > 0) {
                                updateSnapshots(prev => ({
                                  ...prev,
                                  [pmId]: [...(prev[pmId] ?? []), ...newSnaps],
                                }));
                              }
                            }
                            let finalIngredients = newIngredients;
                            if (newIngredients) {
                              const { sourceIngredients } = propagateIngredientMacros('__pm__', newIngredients, meals);
                              finalIngredients = sourceIngredients;
                            }
                            updatePossibleIngredients.mutate({ id: pmId, ingredients_override: finalIngredients });
                            
                            // Réinitialiser les surcharges manuelles pour que le planning recalcule les macros automatiquement
                            const currentCals = getPreference<Record<string, string>>('planning_cal_overrides', {});
                            const { [pmId]: _, ...newCals } = currentCals;
                            setPreference.mutate({ key: 'planning_cal_overrides', value: newCals });
                            const currentPros = getPreference<Record<string, string>>('planning_pro_overrides', {});
                            const { [pmId]: __, ...newPros } = currentPros;
                            setPreference.mutate({ key: 'planning_pro_overrides', value: newPros });
                          }}
                          onUpdateQuantity={async (id, qty) => {
                            if (unParUnSourcePmIds.has(id)) {
                              const pm = possibleMeals.find(p => p.id === id);
                              if (pm?.meals) {
                                const oldQty = pm.quantity;
                                const delta = oldQty - qty;
                                if (delta !== 0) {
                                  const snapshots = effectiveDeductionSnapshots[pm.id];
                                  let matchingFi =
                                    (snapshots?.[0]
                                      ? foodItems.find((fi) => fi.id === snapshots[0]!.id)
                                      : undefined) ??
                                    foodItems.find(
                                      (fi) =>
                                        strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite,
                                    );
                                  if (matchingFi) {
                                    if (delta > 0) {
                                      const newStockQty = (matchingFi.quantity ?? 0) + delta;
                                      const perUnit = parseQty(matchingFi.grams);
                                      const partial = parsePartialQty(matchingFi.grams);
                                      const hasPartial = partial > 0 && partial < perUnit;
                                      const updateData: any = { quantity: newStockQty };
                                      if (!hasPartial && matchingFi.counter_start_date) updateData.counter_start_date = null;
                                      await supabase.from("food_items").update(updateData).eq("id", matchingFi.id);
                                    } else {
                                      const toDeduct = -delta;
                                      const currentQty = matchingFi.quantity ?? 1;
                                      if (currentQty <= toDeduct) { await supabase.from("food_items").delete().eq("id", matchingFi.id); }
                                      else { await supabase.from("food_items").update({ quantity: currentQty - toDeduct } as any).eq("id", matchingFi.id); }
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  } else if (delta > 0 && snapshots?.[0]) {
                                    // Recreate deleted item
                                    const sn = snapshots[0];
                                    await supabase.from("food_items").insert(
                                      toFoodItemInsertPayload(sn, { quantity: delta }) as any,
                                    );
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                    await syncFoodItemRolePrefsAfterRecreate([sn]);
                                  } else if (delta < 0) {
                                    toast({ title: "⚠️ Stock insuffisant", description: `Plus de "${pm.meals.name}" en stock.` });
                                  }
                                }
                              }
                            }
                            updatePossibleQuantity.mutate({ id, quantity: qty });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                          onUpdateDescription={(id, description) => updateDescription.mutate({ id, description })}
                          onRename={(id, name) => renameMeal.mutate({ id, name })}
                          onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                          onExternalDrop={(mealId, source, pmId) => handleMoveToPossibleGeneral(mealId, source, pmId)}
                          highlightedId={highlightedId}
                          foodItems={foodItems}
                          ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                          onAddDirectly={() => openDialog("possible")}
                          masterSourcePmIds={masterSourcePmIds}
                          unParUnSourcePmIds={unParUnSourcePmIds} />
                      </div>

                      {cat.value === "plat" && (
                        <div className="order-2 md:order-3 md:col-span-2">
                          <LazyUnParUnSection
                            category={cat}
                            foodItems={foodItems}
                            allMeals={meals}
                            ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                            collapsed={collapsedSections[`unparun-${cat.value}`] ?? true}
                            onToggleCollapse={() => toggleSectionCollapse(`unparun-${cat.value}`)}
                            sortMode={unParUnSortModes[cat.value] || "expiration"}
                            onToggleSort={() => {
                              const current = unParUnSortModes[cat.value] || "expiration";
                              const next: UnParUnSortMode = current === "manual" ? "expiration" : "manual";
                              setUnParUnSort(cat.value, next);
                            }}
                            onMoveToPossible={async (fi, consumeQty, consumeGrams) => {
                              const shouldStartCounter = fi.storage_type !== 'surgele' && !fi.no_counter;
                              const movedCounterDate = fi.counter_start_date || (shouldStartCounter ? new Date().toISOString() : null);
                              if (!fi.is_infinite) {
                                const perUnit = parseQty(fi.grams);
                                if (perUnit > 0) {
                                  const totalDeduct = (consumeQty || 0) * perUnit + (consumeGrams || 0);
                                  if (totalDeduct <= 0 && (consumeQty !== undefined || consumeGrams !== undefined)) return; // Explicitly 0
                                  const actualDeduct = totalDeduct > 0 ? totalDeduct : perUnit;
                                  const totalAvail = getFoodItemTotalGrams(fi);
                                  const remaining = totalAvail - actualDeduct;
                                  if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  else if (fi.quantity && fi.quantity >= 1) {
                                    const fullUnits = Math.floor(remaining / perUnit);
                                    const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                                    if (rem > 0) { await supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, rem), ...(movedCounterDate ? { counter_start_date: movedCounterDate } : {}) } as any).eq("id", fi.id); }
                                    else if (fullUnits > 0) { await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit), counter_start_date: null } as any).eq("id", fi.id); }
                                    else { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining), ...(movedCounterDate ? { counter_start_date: movedCounterDate } : {}) } as any).eq("id", fi.id); }
                                } else {
                                  if (consumeQty === 0) return; // Explicitly 0
                                  const deductQty = consumeQty || 1;
                                  const currentQty = fi.quantity ?? 1;
                                  if (currentQty <= deductQty) { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  // Prélever des unités « ouvre » le paquet : on démarre le compteur d'ouverture
                                  // sur le reste du stock (cohérent avec la branche grammes ci-dessus) si l'aliment
                                  // a « Compteur auto » activé et n'est ni surgelé ni déjà compté.
                                  else { await supabase.from("food_items").update({ quantity: currentQty - deductQty, ...(movedCounterDate ? { counter_start_date: movedCounterDate } : {}) } as any).eq("id", fi.id); }
                                }
                                qc.invalidateQueries({ queryKey: ["food_items"] });
                              }
                              const unitG = parseQty(fi.grams);
                              const totalMovedG = unitG > 0 ? ((consumeQty || 0) * unitG + (consumeGrams || 0)) : 0;
                              // Guard : ne bloquer que si l'aliment A des grammes et qu'on ne déplace rien.
                              // Pour les aliments en quantité seule (unitG = 0), on ne doit PAS bloquer ici.
                              if (unitG > 0 && totalMovedG <= 0 && (consumeQty !== undefined || consumeGrams !== undefined)) return;
                              const actualMovedG = totalMovedG > 0 ? totalMovedG : (unitG > 0 ? unitG : 0);
                              const deductQty =
                                unitG > 0
                                  ? 0
                                  : consumeQty !== undefined
                                    ? consumeQty || 1
                                    : 1;
                              const snapshot = [
                                attachFoodDeductionSnapshot(fi, {
                                  grams: actualMovedG,
                                  quantity: deductQty,
                                }),
                              ];

                              const displayGrams = actualMovedG > 0 ? String(actualMovedG) : (fi.grams ? String(parseQty(fi.grams)) : null);
                              const displayQty = consumeQty || (consumeGrams ? Math.ceil(consumeGrams / (unitG || 1)) : 1);

                              let ratio = 1;
                              if (unitG > 0) {
                                ratio = actualMovedG / unitG;
                              } else if (consumeQty !== undefined) {
                                ratio = consumeQty || 1;
                              }


                              const fiKey = normalizeKey(fi.name);
                              const fiMacro = macroLookup.get(fiKey);
                              const calFromFi = !!fi.calories;
                              const proFromFi = !!fi.protein;
                              const baseCalStr = fi.calories || fiMacro?.cal || "0";
                              const baseProStr = fi.protein || fiMacro?.pro || "0";

                              const baseCal = parseFloat(String(baseCalStr).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
                              const basePro = parseFloat(String(baseProStr).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;

                              // Si fi.grams est présent, les macros de l'aliment sont au 100 g ; sinon elles sont à l'unité.
                              let finalCal: number | null = null;
                              let finalPro: number | null = null;
                              let finalFiber: number | null = null;
                              const fiberFromFi = !!fi.fiber;
                              const baseFiberStr = fi.fiber || fiMacro?.fiber || "0";
                              const baseFiber = parseFloat(String(baseFiberStr).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
                              if (baseCal > 0) {
                                if (fi.grams || !calFromFi) {
                                  finalCal = (baseCal / 100) * actualMovedG;
                                } else {
                                  finalCal = baseCal * ratio;
                                }
                              }
                              if (basePro > 0) {
                                if (fi.grams || !proFromFi) {
                                  finalPro = (basePro / 100) * actualMovedG;
                                } else {
                                  finalPro = basePro * ratio;
                                }
                              }
                              if (baseFiber > 0) {
                                if (fi.grams || !fiberFromFi) {
                                  finalFiber = (baseFiber / 100) * actualMovedG;
                                } else {
                                  finalFiber = baseFiber * ratio;
                                }
                              }

                              const calories = finalCal !== null ? formatNumeric(Math.round(finalCal)) : null;
                              const protein = finalPro !== null ? formatNumeric(Math.round(finalPro)) : null;
                              const fiber = finalFiber !== null ? formatNumeric(Math.round(finalFiber)) : null;
                              const ingredients = actualMovedG > 0 ? `${displayGrams}g ${fi.name}` : `${displayQty} ${fi.name}`;
                              const pmResult = await addMealToPossibleDirectly.mutateAsync({
                                name: fi.name, category: cat.value, calories, protein, fiber, grams: displayGrams,
                                ingredients,
                                expiration_date: fi.expiration_date, possible_quantity: displayQty,
                                counter_start_date: movedCounterDate,
                              });
                              if (pmResult?.id) {
                                updateSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
                                setUnParUnSourcePmIds(prev => new Set([...prev, pmResult.id]));
                                freezePossibleBadgeCounter(
                                  pmResult.id,
                                  ingredients,
                                  null,
                                  null,
                                  undefined,
                                  [{ ...fi, counter_start_date: movedCounterDate }],
                                );
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </ErrorBoundary>
                </TabsContent>
              )}
            </Tabs>
          }
        </Suspense>
      </main>
    </div>);
};

export default Index;
