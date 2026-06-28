import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Loader2, ChevronDown, ChevronRight, ShieldAlert, Apple, Infinity as InfinityIcon, Star, List, Flame, Search, Drumstick, Wheat, Timer } from "lucide-react";
import { DevMenu } from "@/components/DevMenu";
import { Chronometer } from "@/components/Chronometer";
import { PinLock } from "@/components/PinLock";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  buildStockMap, buildFoodItemIndex, findStockKey, pickBestAlternative,
  getMealMultiple, getMealFractionalRatio,
  analyzeMealIngredients,
  getMissingIngredients, isFoodUsedInMeals,
  formatExpirationLabel, compareExpirationWithCounter,
  sortStockDeductionPriority, buildScaledMealForRatio, scaleIngredientStringExact,
  getDisplayedCalories, getDisplayedProtein, propagateIngredientMacros, resolveCounterStartForPossibleBadge,
  findEarliestActiveCounterDate,
  recipeHasFiniteCounterableIngredients,
  type FoodItemIndex,
} from "@/lib/stockUtils";
import { useMealTransfers, computePlannedCounterDate } from "@/hooks/useMealTransfers";
import {
  attachPortionDeduction,
  remapMorningMealPreferenceIds,
  wasMorningMealSnapshot,
} from "@/lib/stockDeductionSnapshot";
import { fetchSnapshotsAndPrefsParallel } from "@/data/planning/planningResetRepository";
import { buildFullBackupPayload } from "@/domain/planning/buildBackupPayload";
import { filterPossibleMealsToDeleteForWeeklyClear } from "@/domain/planning/mealsToClear";
import { applyNextWeekPromotionOnTop } from "@/domain/planning/applyNextWeekPromotion";
import { mergeSnapshotsIntoLivePrefMap } from "@/domain/planning/mergePlanningSnapshots";
import { resolvePostResetGoals } from "@/domain/planning/postResetGoals";
import { upsertPossibleMealsFullBackup, deletePossibleMealsByIds } from "@/services/planning/weeklyResetPersistence";
import { pushWeeklyResetClientPreferences } from "@/services/planning/pushWeeklyResetClientPreferences";
import { buildWeekDates } from "@/lib/planningWeekUtils";
import { pruneStaleIsoSnapshotsForTargetWeek } from "@/domain/planning/weekdaySnapshotUtils";
import type { IngredientMacroAutofillSources, IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";

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

/** Récupère les calories affichées pour un repas (via le helper partagé) */
function getDisplayedMealCalories(meal: Meal): number {
  return getDisplayedCalories(meal) ?? 0;
}

/** Valide le nom d'un repas avant création */
function validateMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Le nom est requis";
  if (trimmed.length > 100) return "Nom trop long (100 car. max)";
  return null;
}

import type { SortMode, MasterSortMode, AvailableSortMode, UnParUnSortMode } from "@/hooks/useSortModes";
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
  const setMainPage = (page: MainPage) => navigate(PAGE_TO_ROUTE[page]);

  const unlocked = !!session;

  // ─── Hooks de données (activés seulement après authentification) ──────────
  const { items: foodItems, deleteItem: deleteFoodItemMutation, updateItem: updateFoodItemMutation } = useFoodItems({ enabled: unlocked });
  const deleteFoodItem = (id: string) => deleteFoodItemMutation.mutate(id);

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateProtein, updateFiber, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity, splitPossibleMealQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals({ enabled: unlocked });

  const { groups: shoppingGroups, items: shoppingItems, toggleSecondaryCheck: toggleShoppingSecondaryCheck, updateItemQuantity: updateShoppingItemQuantity } = useShoppingList({ enabled: unlocked });
  const { getPreference, setPreference, isLoading: isPreferencesLoading } = usePreferences({ enabled: unlocked });
  const macroLibrary = getPreference<IngredientMacroLibraryItem[]>("ingredient_macro_library", EMPTY_MACRO_LIBRARY);
  const saveMacroLibrary = useCallback(
    (library: IngredientMacroLibraryItem[]) => {
      setPreference.mutate({ key: "ingredient_macro_library", value: library });
    },
    [setPreference],
  );

  // ─── Données dérivées (memoized) ────────────────────────────────────────
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  const { deductIngredientsFromStock, restoreIngredientsToStock, adjustStockForIngredientChange, deductNameMatchStock, updateFoodItemCountersForPlanning } = useMealTransfers(foodItems);

  // Précharger TOUS les fragments lazy + pré-récupérer TOUTES les données une fois déverrouillé (idle callback)
  const preloadDone = useRef(false);
  useEffect(() => {
    if (!unlocked || preloadDone.current) return;
    preloadDone.current = true;
    const preload = () => {
      // Précharger les fragments JS en parallèle
      importShoppingList();
      importMealPlanGenerator();
      importFoodItems();
      importWeeklyPlanning();
      importMasterList();
      importPossibleList();
      importAvailableList();
      importUnParUnSection();
      importMacroIngredients();
      importEnergyDrinksList();
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(preload);
    } else {
      setTimeout(preload, 200);
    }
  }, [unlocked]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
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

  // ─── Rafraîchissement automatique des données au retour sur l'app ────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && unlocked) {
        // Force React Query à rafraîchir toutes les requêtes actives en arrière-plan
        qc.invalidateQueries();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [qc, unlocked]);

  useEffect(() => {
    const TAB_KEY = 'mealcards_open_tabs';
    const count = parseInt(localStorage.getItem(TAB_KEY) || '0');
    localStorage.setItem(TAB_KEY, String(count + 1));
    const handleUnload = () => {
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
    const fetchBlockedCount = async () => {
      try {
        const { data } = await supabase.functions.invoke("verify-pin", { body: { admin_stats: true } });
        if (data?.blocked_count !== undefined) setBlockedCount(data.blocked_count);
      } catch {/* ignore */ }
    };
    fetchBlockedCount();
    const interval = setInterval(fetchBlockedCount, 60_000);
    return () => clearInterval(interval);
  }, [unlocked]);

  // Forcer le filtre "calories restantes" à ON à chaque session pour la plupart des catégories (sauf petit déjeuner comme demandé)
  const calorieFilterForced = useRef(false);
  useEffect(() => {
    if (!unlocked || isPreferencesLoading || calorieFilterForced.current) return;
    calorieFilterForced.current = true;

    for (const cat of CATEGORIES) {
      const key = `available_use_remaining_calories_${cat.value}`;
      if (cat.value === "petit_dejeuner") {
        if (getPreference<boolean>(key, false)) {
          setPreference.mutate({ key, value: false });
        }
      } else {
        if (!getPreference<boolean>(key, true)) {
          setPreference.mutate({ key, value: true });
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
      setPreference.mutate({ key: 'meal_available_sort_modes', value: updatedSortModes });
    }
  }, [unlocked, isPreferencesLoading]);

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

  const ingredientMacroAutofillSources = useMemo<IngredientMacroAutofillSources>(
    () => ({
      foodItems,
      macroLibrary,
      mealMacros: macroLookup,
    }),
    [foodItems, macroLibrary, macroLookup],
  );

  useEffect(() => {
    if (!unlocked) return;
    const channel = supabase
      .channel('global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items' }, () => {
        // Les updates locaux (déduction, édition, restauration...) appliquent déjà un
        // optimistic update précis sur le cache via setQueryData. Un invalidateQueries
        // automatique en provenance du realtime déclenche un refetch qui peut renvoyer
        // une version répliquée en retard et écraser notre cache, laissant l'UI (ex: badge
        // xN "Au choix") coincée sur l'ancien stock. On laisse donc la réconciliation
        // naturelle se faire au prochain refetch "actif" (remontage/focus).
        const suppressUntil = (window as any).__suppressStockRealtimeUntil as number | undefined;
        if (typeof suppressUntil === "number" && Date.now() < suppressUntil) return;
        qc.invalidateQueries({ queryKey: ["food_items"] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => { qc.invalidateQueries({ queryKey: ["meals"] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'possible_meals' }, () => { qc.invalidateQueries({ queryKey: ["possible_meals"] }); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('Sync temps réel : La connexion a échoué. Assurez-vous que le Realtime est activé dans votre tableau de bord Supabase.');
        }
      });
    return () => {
      // Supprimer le canal en toute sécurité pour éviter les avertissements "closed before established" pendant le HMR
      if (channel) {
        supabase.removeChannel(channel).catch(() => { /* silent */ });
      }
    };
  }, [unlocked, qc]);

  // Nettoyage automatique du dimanche — s'exécute UNE FOIS par semaine le dimanche à 23h59 ou lors de la première connexion de la nouvelle semaine
  const lastWeeklyReset = getPreference<string>('last_weekly_reset', '');
  const sundayClearDone = useRef(false);
  const autoSundayResetInFlightRef = useRef(false);
  useEffect(() => {
    if (!unlocked || sundayClearDone.current || isPreferencesLoading || isLoading) return;
    sundayClearDone.current = true;

    const now = new Date();
    // Trouver le dimanche 23h59 le plus récent
    const mostRecentSunday = new Date(now);
    const day = mostRecentSunday.getDay(); // 0=Dimanche
    // Revenir au dimanche dernier (ou aujourd'hui si on est dimanche)
    mostRecentSunday.setDate(mostRecentSunday.getDate() - day);
    mostRecentSunday.setHours(23, 59, 0, 0);

    // Si nous n'avons pas encore atteint dimanche 23h59 cette semaine, utiliser le dimanche de la semaine DERNIÈRE
    if (now.getTime() < mostRecentSunday.getTime()) {
      mostRecentSunday.setDate(mostRecentSunday.getDate() - 7);
    }

    if (!lastWeeklyReset) {
      // Initialisation de la première fois, on définit juste la valeur sans nettoyer
      setPreference.mutate({ key: 'last_weekly_reset', value: mostRecentSunday.toISOString() });
      return;
    }

    const lastResetDate = new Date(lastWeeklyReset);
    if (lastResetDate.getTime() >= mostRecentSunday.getTime()) {
      // Déjà réinitialisé pour cette semaine
      return;
    }

    const clearAll = async () => {
      if (autoSundayResetInFlightRef.current) return;
      autoSundayResetInFlightRef.current = true;
      try {
        const userId = (await supabase.auth.getUser()).data.user?.id;
        if (!userId) return;

        const { data: freshResetPref } = await supabase
          .from("user_preferences")
          .select("value")
          .eq("key", "last_weekly_reset")
          .eq("user_id", userId)
          .maybeSingle();
        if (freshResetPref?.value) {
          const freshResetDate = new Date(String(freshResetPref.value));
          if (freshResetDate.getTime() >= mostRecentSunday.getTime()) return;
        }

        const { snapshots, prefMap } = await fetchSnapshotsAndPrefsParallel(userId);

        await qc.refetchQueries({ queryKey: ["possible_meals"] });
        const freshPossible =
          (qc.getQueryData<PossibleMeal[]>(["possible_meals"]) as PossibleMeal[] | undefined) ?? possibleMeals;

        const fullBackup = buildFullBackupPayload(freshPossible, prefMap);
        await upsertPossibleMealsFullBackup(userId, fullBackup);

        const previousWeekStart = new Date(mostRecentSunday);
        previousWeekStart.setDate(previousWeekStart.getDate() - 6);
        const preservedPreviousWeek = {
          startISO: previousWeekStart.toISOString().split("T")[0],
          endISO: mostRecentSunday.toISOString().split("T")[0],
        };
        const cutoffISO = mostRecentSunday.toISOString().split("T")[0];
        const mealsToDelete = filterPossibleMealsToDeleteForWeeklyClear(freshPossible, cutoffISO, preservedPreviousWeek);
        await deletePossibleMealsByIds(mealsToDelete.map(pm => pm.id));

        const targetWeek = buildWeekDates(0, now);
        const prunedSnapshots = pruneStaleIsoSnapshotsForTargetWeek(snapshots, targetWeek);
        const merged = mergeSnapshotsIntoLivePrefMap(prefMap, prunedSnapshots, targetWeek);
        const promoted = applyNextWeekPromotionOnTop(merged, prefMap, snapshots, targetWeek);
        const goals = resolvePostResetGoals(prefMap);
        pushWeeklyResetClientPreferences(setPreference, promoted, goals, now.toISOString(), "auto_sunday");
        setPreference.mutate({ key: "planning_saved_snapshots", value: prunedSnapshots });

        await qc.invalidateQueries({ queryKey: ["possible_meals"] });
        await qc.invalidateQueries({ queryKey: ["user_preferences"] });
        toast({
          title: "🔄 Reset hebdomadaire effectué",
          description: "Utilisez ↩ Restaurer dans le planning pour récupérer les cartes.",
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          title: "Reset hebdomadaire interrompu",
          description: msg,
          variant: "destructive",
        });
      } finally {
        autoSundayResetInFlightRef.current = false;
      }
    };
    clearAll();
  }, [unlocked, possibleMeals, lastWeeklyReset, isPreferencesLoading, isLoading]);

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
      const next = updater(prev);
      setPreference.mutate({ key: SNAPSHOT_PREF_KEY, value: next });
      return next;
    });
  };
  const [masterSourcePmIds, setMasterSourcePmIds] = useState<Set<string>>(new Set());
  const [unParUnSourcePmIds, setUnParUnSourcePmIds] = useState<Set<string>>(new Set());

  const wasMorningMealFoodItem = useCallback(
    (fi: FoodItem) => getPreference<string[]>(MORNING_MEAL_PREF_KEY, []).includes(fi.id),
    [getPreference],
  );

  const attachFoodDeductionSnapshot = useCallback(
    (fi: FoodItem, portion: { grams: number; quantity: number }) =>
      attachPortionDeduction(fi, portion, { wasMorningMeal: wasMorningMealFoodItem(fi) }),
    [wasMorningMealFoodItem],
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Transfert d'un repas vers la liste "Possible" (avec déduction de stock)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleMoveToPossibleGeneral = async (mealId: string, source?: string, pmId?: string | null) => {
    if (pmId) {
      updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
      return;
    }

    const meal = meals.find(m => m.id === mealId);
    if (!meal) return;

    // 1. Analyser le stock avant déduction pour l'expiration (sans déduire)
    const anBefore = analyzeMealIngredients(meal, foodItems, foodItemIndex);

    let snapshots: FoodItem[] = [];
    let nameMatch: FoodItem | undefined;
    let oldestCounterFromDeduction: string | null = null;
    let consumedIngredientsFromDeduction: string | null = null;

    // 2. Déduire les ingrédients du stock UNIQUEMENT si ça ne vient pas de "Tous" (master)
    if (source !== "master") {
      const deductionResult = await deductIngredientsFromStock(meal, undefined);
      snapshots = deductionResult.snapshots;
      oldestCounterFromDeduction = deductionResult.oldestCounter || null;
      consumedIngredientsFromDeduction = deductionResult.consumedIngredients || null;
      nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch && !snapshots.find(s => s.id === nameMatch.id)) {
        if (!meal.ingredients?.trim()) {
          const portion = await deductNameMatchStock(meal);
          snapshots.push(attachFoodDeductionSnapshot(nameMatch, {
            grams: portion.gramsDeducted,
            quantity: portion.quantityDeducted,
          }));
        } else {
          snapshots.push({ ...nameMatch });
        }
      }
    }

    // 3. Calculer les calories/protéines AVANT déduction pour les « figer » sur la nouvelle carte
    const isAvailBefore = (name: string) => {
      const fi = foodItems.find(f => strictNameMatch(f.name, name));
      return !!fi && (fi.is_infinite || (fi.quantity ?? 0) > 0 || parseQty(fi.grams) > 0);
    };
    const preCal = getDisplayedCalories(meal, undefined, undefined, isAvailBefore);
    const prePro = getDisplayedProtein(meal, undefined, undefined, isAvailBefore, foodItems, foodItemIndex);

    // 4. Carte « Possible » = copie logique avant déduction stock
    const finalCounterDate =
      source === "master" || !recipeHasFiniteCounterableIngredients(meal.ingredients, foodItems, foodItemIndex)
        ? null
        : oldestCounterFromDeduction || anBefore.earliestCounterDate || null;

    const result = await moveToPossible.mutateAsync({
      mealId,
      expiration_date: anBefore.earliestExpiration,
      counter_start_date: finalCounterDate
    });

    if (result?.id) {
      if (snapshots.length > 0) updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
      if (consumedIngredientsFromDeduction && consumedIngredientsFromDeduction !== meal.ingredients) {
        updatePossibleIngredients.mutate({ id: result.id, ingredients_override: consumedIngredientsFromDeduction });
      }
      if (source === "master") setMasterSourcePmIds(prev => new Set([...prev, result.id]));
      if (source === "available" && typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        setCollapsedSections(prev => ({ ...prev, [`available-${meal.category}`]: true }));
      }

      // 5. Sauvegarder les macros "figées" dans les préférences pour cette carte
      if (preCal !== null) {
        const currentCals = getPreference<Record<string, string>>('planning_cal_overrides', {});
        setPreference.mutate({ key: 'planning_cal_overrides', value: { ...currentCals, [result.id]: String(preCal) } });
      }
      if (prePro !== null) {
        const currentPros = getPreference<Record<string, string>>('planning_pro_overrides', {});
        setPreference.mutate({ key: 'planning_pro_overrides', value: { ...currentPros, [result.id]: String(prePro) } });
      }
    }
  };

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

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const cat of CATEGORIES) {
      defaults[`master-${cat.value}`] = true;
      defaults[`unparun-${cat.value}`] = true;
    }
    return defaults;
  });
  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" }); }
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
    if (mode === "expiration") return sortByExpiration(items);
    if (mode === "planning") return sortByPlanning(items);
    return items;
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
    const items = getMealsByCategory(cat);
    const mode = masterSortModes[cat] || "manual";
    const asc = sortDirections[`master-${cat}`] !== false;
    if (mode === "calories") {
      return [...items].sort((a, b) => {
        const ca = getDisplayedMealCalories(a);
        const cb = getDisplayedMealCalories(b);
        return asc ? ca - cb : cb - ca;
      });
    }
    if (mode === "protein") {
      return [...items].sort((a, b) => {
        const pa = parseFloat((a.protein || "0").replace(/[^0-9.]/g, "")) || 0;
        const pb = parseFloat((b.protein || "0").replace(/[^0-9.]/g, "")) || 0;
        return asc ? pa - pb : pb - pa;
      });
    }
    if (mode === "favorites") return [...items].sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
    if (mode === "ingredients") {
      return [...items].sort((a, b) => {
        const aCount = a.ingredients ? a.ingredients.split(/[,\n]+/).filter(Boolean).length : 0;
        const bCount = b.ingredients ? b.ingredients.split(/[,\n]+/).filter(Boolean).length : 0;
        return aCount - bCount;
      });
    }
    return items;
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

      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-2 py-2 sm:px-4 sm:py-3">
        <div className="relative max-w-6xl mx-auto flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 shrink-0">
            <h1 className="text-base sm:text-xl font-extrabold text-foreground cursor-pointer select-none" onClick={handleLogoClick} title="">🍽️</h1>
            {blockedCount !== null &&
              <span title={`${blockedCount} tentative${blockedCount > 1 ? 's' : ''} d'accès non autorisée${blockedCount > 1 ? 's' : ''} depuis la création`}
                className="flex items-center gap-0.5 text-[9px] font-bold text-destructive/80 bg-destructive/10 rounded-full px-1 py-0.5 cursor-default shrink-0">
                <ShieldAlert className="h-2 w-2" />{blockedCount}
              </span>
            }
          </div>

          <div className="absolute left-1/2 -translate-x-[calc(100%+140px)] md:-translate-x-[calc(100%+262px)]">
            <button
              onClick={() => setMainPage("macros")}
              className={`shrink-0 py-0.5 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 px-2 md:px-2 bg-muted ${mainPage === "macros" ? "bg-background shadow-sm" : ""}`}
              title="Macro ingrédients"
            >
              <span className="text-[11px] leading-tight md:hidden">🌾</span>
              <Wheat className="hidden h-2.5 w-2.5 shrink-0 md:block md:h-3 md:w-3" />
              <span className={`hidden md:inline text-[8px] md:text-xs truncate leading-tight ${mainPage === "macros" ? "text-amber-500 font-bold" : "text-muted-foreground"}`}>Macro ingrédients</span>
            </button>
          </div>

          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            <div className="bg-muted rounded-full p-0.5 w-full max-w-[16.75rem] md:max-w-md py-1 md:py-[6px] my-0 px-0 flex items-center justify-center gap-px md:gap-[2px]">
              {([
                { page: "aliments" as MainPage, icon: <Apple className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Aliments", activeColor: "text-lime-600 dark:text-lime-400" },
                { page: "repas" as MainPage, icon: <UtensilsCrossed className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Repas", activeColor: "text-orange-500" },
                { page: "planning" as MainPage, icon: <CalendarRange className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Planning", activeColor: "text-blue-500" },
                { page: "courses" as MainPage, icon: <ShoppingCart className="h-2.5 w-2.5 md:h-3.5 md:w-3.5 shrink-0" />, label: "Courses", activeColor: "text-green-500" },
              ] as const).map(({ page, icon, label, activeColor }) => (
                <button key={page} onClick={() => setMainPage(page)}
                  className={`pointer-events-auto flex-1 py-0.5 md:py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 md:gap-1 min-w-0 px-0.5 md:px-3 ${mainPage === page ? "bg-background shadow-sm" : ""}`}>
                  {icon}
                  <span className={`text-[8px] md:text-sm truncate leading-tight ${mainPage === page ? `${activeColor} font-bold` : "text-muted-foreground"}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setChronoOpen(true)}
            className="ml-auto text-[10px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0 bg-muted/60 hover:bg-muted rounded-full px-2.5 py-1">
            <span className="capitalize">{format(new Date(), 'EEE', { locale: fr })}</span>
            <span className="font-black text-foreground">{format(new Date(), 'd')}</span>
          </button>
        </div>
      </header>
      <Chronometer open={chronoOpen} onOpenChange={setChronoOpen} />

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
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
              <div className="sticky top-[44px] sm:top-[52px] z-10 bg-background/95 backdrop-blur-sm pb-2 pt-1">
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
              />
            </ErrorBoundary>
          )}
          {mainPage === "repas" &&
            <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MealCategory)}>
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <TabsList className="flex-1 overflow-x-auto rounded-2xl">
                  {CATEGORIES.map((c) =>
                    <TabsTrigger key={c.value} value={c.value} className="text-[9px] sm:text-xs px-1.5 sm:px-3 py-1 rounded-xl">
                      <span className="mr-0.5">{c.emoji}</span>
                      <span className="text-[9px] sm:text-xs leading-tight">{c.label}</span>
                    </TabsTrigger>
                  )}
                </TabsList>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="rounded-full gap-1 text-xs shrink-0" onClick={() => openDialog("all")}>
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

              {CATEGORIES.map((cat) =>
                <TabsContent key={cat.value} value={cat.value}>
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
                          onReorder={(from, to) => handleReorderMeals(cat.value, from, to)}
                          ingredientMacroAutofillSources={ingredientMacroAutofillSources} />

                        <LazyAvailableList
                          category={cat}
                          meals={getMealsByCategory(cat.value)}
                          foodItems={foodItems}
                          ingredientMacroAutofillSources={ingredientMacroAutofillSources}
                          allMeals={meals}
                          stockMap={stockMap}
                          sortMode={availableSortModes[cat.value] || "manual"}
                          sortAsc={sortDirections[`available-${cat.value}`] !== false}
                          onToggleSort={() => toggleAvailableSort(cat.value)}
                          onToggleSortDirection={() => toggleSortDirection(`available-${cat.value}`)}
                          collapsed={collapsedSections[`available-${cat.value}`] ?? false}
                          onToggleCollapse={() => toggleSectionCollapse(`available-${cat.value}`)}
                          onMoveToPossible={(mealId) => handleMoveToPossibleGeneral(mealId, "available")}
                          onMovePartialToPossible={async (meal, ratio) => {
                            const partialMeal = buildScaledMealForRatio(meal, ratio, stockMap);
                            const anBefore = analyzeMealIngredients(meal, foodItems, foodItemIndex);

                            // 1. Deduct FIRST
                            const { snapshots, oldestCounter, consumedIngredients } = await deductIngredientsFromStock(partialMeal);

                            let finalCounterDate: string | null = null;
                            if (recipeHasFiniteCounterableIngredients(meal.ingredients, foodItems, foodItemIndex)) {
                              if (oldestCounter) finalCounterDate = oldestCounter;
                              else if (anBefore.earliestCounterDate) finalCounterDate = anBefore.earliestCounterDate;
                            }

                            const result = await addMealToPossibleDirectly.mutateAsync({
                              name: meal.name, category: cat.value,
                              calories: meal.calories, protein: meal.protein, grams: meal.grams, ingredients: meal.ingredients,
                              expiration_date: anBefore.earliestExpiration,
                              counter_start_date: finalCounterDate,
                              oven_temp: meal.oven_temp,
                              oven_minutes: meal.oven_minutes,
                            });

                            if (result?.id) {
                              updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                              const finalOverride = consumedIngredients || (partialMeal.ingredients && partialMeal.ingredients !== meal.ingredients ? partialMeal.ingredients : null);
                              if (finalOverride && finalOverride !== meal.ingredients) {
                                updatePossibleIngredients.mutate({ id: result.id, ingredients_override: finalOverride });
                              }
                            }
                          }}
                          onMoveNameMatchToPossible={async (meal, fi, ratio) => {
                            const r = ratio ?? 1;
                            
                            // Calcul des macros de base (soit depuis le repas, soit depuis l'aliment)
                            const hasCal = meal.calories && meal.calories !== "0";
                            const hasPro = meal.protein && meal.protein !== "0" && meal.protein !== "0%";
                            let baseCal = hasCal ? parseFloat(meal.calories!.replace(",", ".")) : 0;
                            let basePro = hasPro ? parseFloat(meal.protein!.replace(",", ".")) : 0;

                            if (!hasCal || !hasPro) {
                              if (!hasCal && fi.calories) {
                                const fiCal = parseFloat(fi.calories.replace(",", "."));
                                if (fi.grams) {
                                  const totalG = getFoodItemTotalGrams(fi);
                                  baseCal = (fiCal * totalG) / 100;
                                } else {
                                  baseCal = fiCal * (fi.quantity ?? 1);
                                }
                              }
                              if (!hasPro && fi.protein) {
                                const fiPro = parseFloat(fi.protein.replace(",", "."));
                                if (fi.grams) {
                                  const totalG = getFoodItemTotalGrams(fi);
                                  basePro = (fiPro * totalG) / 100;
                                } else {
                                  basePro = fiPro * (fi.quantity ?? 1);
                                }
                              }
                            }

                            // Valeurs finales à envoyer en DB
                            const baseGStr = fi.quantity && fi.quantity > 1 && fi.grams
                              ? `${parseQty(fi.grams) * fi.quantity}g`
                              : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
                            const finalGrams = baseGStr ? (r !== 1 && baseGStr !== "∞" ? `${Math.round(parseQty(baseGStr) * r)}g` : baseGStr) : null;
                            const finalCal = baseCal > 0 ? String(Math.round(baseCal * r)) : meal.calories;
                            const finalPro = basePro > 0 ? String(Math.round(basePro * r)) : meal.protein;

                            if (fi.is_infinite) {
                              const baseIng = meal.ingredients ? meal.ingredients : (parseQty(meal.grams) > 0 ? `${meal.grams} ${meal.name}` : null);
                              const scaledIng = baseIng && r !== 1 ? scaleIngredientStringExact(baseIng, r) : null;
                              
                              const result = await addMealToPossibleDirectly.mutateAsync({
                                name: meal.name, category: cat.value,
                                calories: finalCal, protein: finalPro, grams: finalGrams,
                                ingredients: baseIng,
                                expiration_date: fi.expiration_date,
                                counter_start_date: null,
                              });
                              if (result?.id && scaledIng) {
                                updatePossibleIngredients.mutate({ id: result.id, ingredients_override: scaledIng });
                              }
                            } else {
                              const portion = await deductNameMatchStock(meal, undefined, r);
                              const shouldStartOnMove = fi.storage_type !== 'surgele' && !fi.no_counter;
                              const finalCd = fi.counter_start_date || (shouldStartOnMove ? new Date().toISOString() : null);
                              const liveAfterDeduct = qc.getQueryData<FoodItem[]>(["food_items"])?.find((x) => x.id === fi.id);
                              const snapshot = [
                                attachFoodDeductionSnapshot(
                                  {
                                    ...fi,
                                    counter_start_date:
                                      liveAfterDeduct?.counter_start_date ?? finalCd ?? fi.counter_start_date,
                                  },
                                  {
                                    grams: portion.gramsDeducted,
                                    quantity: portion.quantityDeducted,
                                  },
                                ),
                              ];

                              // Si ratio != 1 ou macros calculées, on crée un repas "indépendant" au lieu de juste lier au master
                              if (r !== 1 || !hasCal || !hasPro) {
                                const result = await addMealToPossibleDirectly.mutateAsync({
                                  name: meal.name, category: cat.value,
                                  calories: finalCal, protein: finalPro, grams: finalGrams,
                                  ingredients: meal.ingredients || (parseQty(finalGrams) > 0 ? `${finalGrams} ${meal.name}` : null),
                                  expiration_date: fi.expiration_date,
                                  counter_start_date: finalCd,
                                  oven_temp: meal.oven_temp,
                                  oven_minutes: meal.oven_minutes,
                                });
                                if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
                              } else {
                                const result = await moveToPossible.mutateAsync({ mealId: meal.id, expiration_date: fi.expiration_date, counter_start_date: finalCd });
                                if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
                              }
                            }
                          }}
                          onMoveFoodItemToPossible={async (fi) => {
                            const perUnit = parseQty(fi.grams);
                            let portionGrams = 0;
                            let portionQty = 0;
                            if (!fi.is_infinite) {
                              if (perUnit > 0) {
                                portionGrams =
                                  fi.quantity && fi.quantity > 1
                                    ? perUnit
                                    : getFoodItemTotalGrams(fi);
                              } else {
                                portionQty = 1;
                              }
                            }
                            const snapshot = [
                              attachFoodDeductionSnapshot(fi, { grams: portionGrams, quantity: portionQty }),
                            ];
                            if (!fi.is_infinite) {
                              const currentQty = fi.quantity ?? 1;
                              if (currentQty <= 1) { await supabase.from("food_items").delete().eq("id", fi.id); }
                              else { await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", fi.id); }
                              qc.invalidateQueries({ queryKey: ["food_items"] });
                            }
                            const fiKey = normalizeKey(fi.name);
                            const fiMacro = macroLookup.get(fiKey);
                            let calories = fi.calories || fiMacro?.cal || null;
                            let protein = fi.protein || fiMacro?.pro || null;
                            let fiber = fi.fiber || fiMacro?.fiber || null;

                            if (fi.grams) {
                              // Un déplacement depuis "Au choix" consomme une seule portion, pas tout le stock disponible.
                              const movedGrams = portionGrams > 0 ? portionGrams : perUnit;
                              if (movedGrams > 0) {
                                if (calories) calories = String(Math.round(parseFloat(calories.replace(',', '.')) * movedGrams / 100));
                                if (protein) protein = String(Math.round(parseFloat(protein.replace(',', '.')) * movedGrams / 100));
                                if (fiber) fiber = String(Math.round(parseFloat(fiber.replace(',', '.')) * movedGrams / 100));
                              }
                            }

                            const shouldStart = fi.storage_type !== 'surgele' && !fi.no_counter;
                            const finalCd = fi.counter_start_date || (shouldStart ? new Date().toISOString() : null);
                            const pmResult = await addMealToPossibleDirectly.mutateAsync({
                              name: fi.name, category: cat.value,
                              calories, protein, fiber, grams: fi.grams,
                              expiration_date: fi.expiration_date,
                              counter_start_date: finalCd
                            });
                            if (pmResult?.id) updateSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
                          }}
                          onDeleteFoodItem={(id) => { deleteFoodItem(id); }}
                          onRename={(id, name) => renameMeal.mutate({ id, name })}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                          onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                          onToggleFavorite={(id) => {
                            const meal = meals.find((m) => m.id === id);
                            if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
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
                          sortMode={sortModes[cat.value] || "manual"}
                          stockMap={stockMap}
                          onToggleSort={() => toggleSort(cat.value)}
                          onRandomPick={() => handleRandomPick(cat.value)}
                          onRemove={(id) => { removeFromPossible.mutate(id); }}
                          onReturnWithoutDeduction={async (id) => {
                            const pm = getPossibleByCategory(cat.value).find(p => p.id === id);
                            const snapshots = deductionSnapshots[id];
                            let restoredFoodItems: FoodItem[] = [];
                            if (snapshots && snapshots.length > 0) {
                              restoredFoodItems = await restoreIngredientsToStock({} as Meal, snapshots);
                              syncMorningMealPrefsAfterRestore(snapshots, restoredFoodItems);
                            } else if (pm?.meals) {
                              const mealForRestore = pm.ingredients_override
                                ? { ...pm.meals, ingredients: pm.ingredients_override }
                                : pm.meals;
                              restoredFoodItems = await restoreIngredientsToStock(mealForRestore);
                            }
                            updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                            removeFromPossible.mutate(id);
                            setUnParUnSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              const fallbackCounter =
                                snapshots?.[0]?.counter_start_date ?? pm.counter_start_date ?? null;
                              updateFoodItemCountersForPlanning(
                                null, ing, null, null, fallbackCounter, null, remainingMeals,
                              );
                            }
                          }}
                          onReturnToMaster={(id) => {
                            const pm = getPossibleByCategory(cat.value).find(p => p.id === id);
                            removeFromPossible.mutate(id);
                            setMasterSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onSplitQuantity={(id, ratio, baseIng) => {
                            splitPossibleMealQuantity.mutate({ id, ratio, baseIngredients: baseIng });
                            updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                          }}
                          onDelete={(id) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            deletePossibleMeal.mutate(id);

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onDuplicate={async (id) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            if (pm?.meals) {
                              const ingredientsToDeduce = pm.ingredients_override ?? pm.meals.ingredients;
                              const mealForDeduction = { ...pm.meals, ingredients: ingredientsToDeduce };
                              const { snapshots } = await deductIngredientsFromStock(mealForDeduction);
                              
                              const newId = await duplicatePossibleMeal.mutateAsync(id);
                              if (newId) {
                                if (snapshots.length > 0) {
                                  updateSnapshots(prev => ({ ...prev, [newId]: snapshots }));
                                }

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
                                if (masterSourcePmIds.has(id)) {
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
                              const isOccupied = unParUnSourcePmIds.has(id) || masterSourcePmIds.has(id);
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
                                    ) ?? activeStockFallback ?? nextAnalysis?.earliestActiveCounterDate ?? nextAnalysis?.earliestCounterDate ?? pm.counter_start_date ?? null
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
                              // Créneau futur + pas de vraie ouverture manuelle → « prog. » (date du créneau).
                              // Sinon on garde la résolution standard (préserve une ouverture réelle passée).
                              const frozenCounter =
                                plannedSlotIsFuture && activeIsArtifact
                                  ? plannedSlotIso
                                  : nextResolvedCounter;
                              const preservedCounter =
                                effectiveCounter ??
                                activeStockFallback ??
                                nextResolvedCounter ??
                                pm.counter_start_date ??
                                undefined;
                              const counterForMutate =
                                hasFullPlanningSlot && !isOccupied
                                  ? frozenCounter
                                  : preservedCounter;
                              updatePlanning.mutate({
                                id,
                                day_of_week: day,
                                meal_time: time,
                                counter_start_date: counterForMutate,
                              });
                              if (hasFullPlanningSlot) {
                                const fallbackDate =
                                  frozenCounter ?? activeStockFallback ?? counter ?? pm.counter_start_date ?? null;
                                updateFoodItemCountersForPlanning(id, ing, day, time, fallbackDate, pm.created_at, nextPossibleMeals);
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
                                  const snapshots = deductionSnapshots[pm.id];
                                  let matchingFi = foodItems.find(fi => snapshots?.[0] ? fi.id === snapshots[0].id : strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
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
                                    const { id: _id, created_at, quantity, grams, ...rest } = sn as Record<string, any>;
                                    const perUnit = parseQty(sn.grams);
                                    if (sn.quantity !== null && sn.quantity >= 1 && perUnit > 0) {
                                      const fullUnits = Math.floor(delta / perUnit);
                                      const rem = Math.round((delta - fullUnits * perUnit) * 10) / 10;
                                      await supabase.from("food_items").insert({
                                        ...rest,
                                        quantity: rem > 0 ? fullUnits + 1 : fullUnits,
                                        grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null)
                                      } as any);
                                    } else {
                                      await supabase.from("food_items").insert({
                                        ...rest,
                                        grams: formatNumeric(delta)
                                      } as any);
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
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
                            if (oldIngredients || newIngredients) {
                              const newSnaps = await adjustStockForIngredientChange(oldIngredients, newIngredients, deductionSnapshots[pmId]);
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
                                  const snapshots = deductionSnapshots[pm.id];
                                  let matchingFi = foodItems.find(fi => snapshots?.[0] ? fi.id === snapshots[0].id : strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
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
                                    const { id: _id, created_at, quantity, ...rest } = sn as Record<string, any>;
                                    await supabase.from("food_items").insert({
                                      ...rest,
                                      quantity: delta
                                    } as any);
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
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
