import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Loader2, ChevronDown, ChevronRight, Download, Upload, ShieldAlert, Apple, Sparkles, Infinity as InfinityIcon, Star, List, Flame, Search, Drumstick, Wheat, Timer } from "lucide-react";
import { Chronometer } from "@/components/Chronometer";
import { PinLock } from "@/components/PinLock";

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
import { toast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  getMealMultiple, getMealFractionalRatio,
  getEarliestIngredientExpiration, getExpiringIngredientName, getExpiredIngredientNames,
  getMaxIngredientCounter, getMaxIngredientCounterName, getCounterIngredientNames,
  getMissingIngredients, isFoodUsedInMeals,
  formatExpirationLabel, compareExpirationWithCounter,
  sortStockDeductionPriority, buildScaledMealForRatio, scaleIngredientStringExact,
} from "@/lib/stockUtils";

const LazyShoppingList = lazy(() => import("@/components/ShoppingList").then((m) => ({ default: m.ShoppingList })));
const LazyMealPlanGenerator = lazy(() => import("@/components/MealPlanGenerator").then((m) => ({ default: m.MealPlanGenerator })));
const LazyFoodItems = lazy(() => import("@/components/FoodItems").then((m) => ({ default: m.FoodItems })));
const LazyFoodItemsSuggestions = lazy(() => import("@/components/FoodItemsSuggestions").then((m) => ({ default: m.FoodItemsSuggestions })));
const LazyWeeklyPlanning = lazy(() => import("@/components/WeeklyPlanning").then((m) => ({ default: m.WeeklyPlanning })));

const LazyMasterList = lazy(() => import("@/components/MasterList").then((m) => ({ default: m.MasterList })));
const LazyPossibleList = lazy(() => import("@/components/PossibleList").then((m) => ({ default: m.PossibleList })));
const LazyAvailableList = lazy(() => import("@/components/AvailableList").then((m) => ({ default: m.AvailableList })));
const LazyUnParUnSection = lazy(() => import("@/components/UnParUnSection").then((m) => ({ default: m.UnParUnSection })));

const CATEGORIES: {value: MealCategory;label: string;emoji: string;}[] = [
{ value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
{ value: "entree", label: "Entrées", emoji: "🥗" },
{ value: "plat", label: "Plats", emoji: "🍽️" },
{ value: "dessert", label: "Desserts", emoji: "🍰" },
{ value: "bonus", label: "Bonus", emoji: "⭐" }];

function validateMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Le nom est requis";
  if (trimmed.length > 100) return "Nom trop long (100 car. max)";
  return null;
}

type SortMode = "manual" | "expiration" | "planning";
type MasterSortMode = "manual" | "calories" | "protein" | "favorites" | "ingredients";
type AvailableSortMode = "manual" | "calories" | "protein" | "expiration";
type UnParUnSortMode = "manual" | "expiration";
type MainPage = "aliments" | "repas" | "planning" | "courses";


const ROUTE_TO_PAGE: Record<string, MainPage> = {
  "/aliments": "aliments",
  "/repas": "repas",
  "/planning": "planning",
  "/courses": "courses"
};

const PAGE_TO_ROUTE: Record<MainPage, string> = {
  aliments: "/aliments",
  repas: "/repas",
  planning: "/planning",
  courses: "/courses"
};

const Index = () => {
  const qc = useQueryClient();
  const [session, setSession] = useState<import("@supabase/supabase-js").Session | null | undefined>(undefined);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const mainPage: MainPage = ROUTE_TO_PAGE[location.pathname] ?? "repas";
  const setMainPage = (page: MainPage) => navigate(PAGE_TO_ROUTE[page]);

  const unlocked = !!session;
  const pageNeedsMealsData = unlocked && mainPage !== "courses";
  const pageNeedsIndexFoodData = unlocked && mainPage !== "courses";
  const pageNeedsIndexShoppingData = unlocked && mainPage !== "courses";
  const pageNeedsIndexPreferences = unlocked && mainPage !== "courses";

  const { items: foodItems, deleteItem: deleteFoodItemMutation } = useFoodItems({ enabled: pageNeedsIndexFoodData });
  const deleteFoodItem = (id: string) => deleteFoodItemMutation.mutate(id);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleUnload = () => { supabase.auth.signOut(); };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // unlocked computed above to gate data hooks before PIN unlock

  useEffect(() => {
    if (!unlocked) return;
    const fetchBlockedCount = async () => {
      try {
        const { data } = await supabase.functions.invoke("verify-pin", { body: { admin_stats: true } });
        if (data?.blocked_count !== undefined) setBlockedCount(data.blocked_count);
      } catch {/* ignore */}
    };
    fetchBlockedCount();
    const interval = setInterval(fetchBlockedCount, 60_000);
    return () => clearInterval(interval);
  }, [unlocked]);

  // Realtime sync
  useEffect(() => {
    if (!unlocked) return;
    const channel = supabase
      .channel('global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items' }, () => { qc.invalidateQueries({ queryKey: ["food_items"] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => { qc.invalidateQueries({ queryKey: ["meals"] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'possible_meals' }, () => { qc.invalidateQueries({ queryKey: ["possible_meals"] }); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [unlocked, qc]);

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateProtein, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals({ enabled: pageNeedsMealsData });

  // One-time color refresh
  const colorRefreshDone = useRef(false);
  useEffect(() => {
    if (!unlocked || colorRefreshDone.current || meals.length === 0) return;
    colorRefreshDone.current = true;
    const updates = meals.filter(m => m.color !== colorFromName(m.id));
    if (updates.length === 0) return;
    Promise.all(updates.map(m =>
      supabase.from("meals").update({ color: colorFromName(m.id) }).eq("id", m.id)
    )).then(() => qc.invalidateQueries({ queryKey: ["meals"] }));
  }, [unlocked, meals]);

  const { groups: shoppingGroups, items: shoppingItems } = useShoppingList({ enabled: pageNeedsIndexShoppingData });
  const { getPreference, setPreference } = usePreferences({ enabled: pageNeedsIndexPreferences });

  // Sunday auto-clear
  const lastWeeklyReset = getPreference<string>('last_weekly_reset', '');
  const sundayClearDone = useRef(false);
  useEffect(() => {
    if (!unlocked || sundayClearDone.current) return;
    const now = new Date();
    const day = now.getDay();
    if (day !== 0 || now.getHours() < 23 || (now.getHours() === 23 && now.getMinutes() < 59)) {
      sundayClearDone.current = true;
      return;
    }
    const todaySunday = new Date(now);
    todaySunday.setHours(23, 59, 0, 0);
    if (lastWeeklyReset && new Date(lastWeeklyReset) >= todaySunday) {
      sundayClearDone.current = true;
      return;
    }
    if (possibleMeals.length === 0) {
      sundayClearDone.current = true;
      setPreference.mutate({ key: 'last_weekly_reset', value: now.toISOString() });
      return;
    }
    sundayClearDone.current = true;
    const clearAll = async () => {
      const keepPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_keep_on_reset').maybeSingle();
      const keepOnReset: Record<string, boolean> = (keepPrefResult.data?.value as Record<string, boolean>) ?? {};
      await Promise.all(possibleMeals.map(pm =>
        (supabase as any).from("possible_meals").delete().eq("id", pm.id)
      ));
      const manualPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_manual_calories').maybeSingle();
      const currentManual: Record<string, number> = (manualPrefResult.data?.value as Record<string, number>) ?? {};
      const keptManual: Record<string, number> = {};
      for (const [key, val] of Object.entries(currentManual)) {
        if (keepOnReset[`manual-${key}`]) keptManual[key] = val;
      }
      setPreference.mutate({ key: 'planning_manual_calories', value: keptManual });
      const extraPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_extra_calories').maybeSingle();
      const currentExtra: Record<string, number> = (extraPrefResult.data?.value as Record<string, number>) ?? {};
      const keptExtra: Record<string, number> = {};
      for (const [key, val] of Object.entries(currentExtra)) {
        if (keepOnReset[`extra-${key}`]) keptExtra[key] = val;
      }
      setPreference.mutate({ key: 'planning_extra_calories', value: keptExtra });
      const breakfastPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_breakfast').maybeSingle();
      const currentBreakfast: Record<string, string> = (breakfastPrefResult.data?.value as Record<string, string>) ?? {};
      const keptBreakfast: Record<string, string> = {};
      for (const [key, val] of Object.entries(currentBreakfast)) {
        if (keepOnReset[`breakfast-${key}`]) keptBreakfast[key] = val;
      }
      setPreference.mutate({ key: 'planning_breakfast', value: keptBreakfast });
      setPreference.mutate({ key: 'last_weekly_reset', value: now.toISOString() });
      qc.invalidateQueries({ queryKey: ["possible_meals"] });
      toast({ title: "🔄 Reset hebdomadaire effectué", description: "Les cartes possibles et calories manuelles ont été effacées." });
    };
    clearAll();
  }, [unlocked, possibleMeals, lastWeeklyReset]);

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
  const persistedSnapshots = getPreference<Record<string, FoodItem[]>>(SNAPSHOT_PREF_KEY, {});
  const [deductionSnapshots, setDeductionSnapshots] = useState<Record<string, FoodItem[]>>({});
  const snapshotsSynced = useRef(false);
  useEffect(() => {
    if (snapshotsSynced.current) return;
    if (persistedSnapshots && Object.keys(persistedSnapshots).length > 0) {
      setDeductionSnapshots(persistedSnapshots);
      snapshotsSynced.current = true;
    }
  }, [JSON.stringify(persistedSnapshots)]);
  const updateSnapshots = (updater: (prev: Record<string, FoodItem[]>) => Record<string, FoodItem[]>) => {
    setDeductionSnapshots(prev => {
      const next = updater(prev);
      setPreference.mutate({ key: SNAPSHOT_PREF_KEY, value: next });
      return next;
    });
  };
  const [masterSourcePmIds, setMasterSourcePmIds] = useState<Set<string>>(new Set());
  const [unParUnSourcePmIds, setUnParUnSourcePmIds] = useState<Set<string>>(new Set());

  // Sort modes
  const dbSortModes = getPreference<Record<string, SortMode>>('meal_sort_modes', {});
  const dbMasterSortModes = getPreference<Record<string, MasterSortMode>>('meal_master_sort_modes', {});
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>(() => {
    const saved = localStorage.getItem('meal_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const [masterSortModes, setMasterSortModes] = useState<Record<string, MasterSortMode>>(() => {
    const saved = localStorage.getItem('meal_master_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const dbAvailableSortModes = getPreference<Record<string, AvailableSortMode>>('meal_available_sort_modes', {});
  const [availableSortModes, setAvailableSortModes] = useState<Record<string, AvailableSortMode>>({});
  const dbUnParUnSortModes = getPreference<Record<string, UnParUnSortMode>>('meal_unparun_sort_modes', {});
  const [unParUnSortModes, setUnParUnSortModes] = useState<Record<string, UnParUnSortMode>>({});

  // Sort direction state (asc=true / desc=false for numeric sorts)
  const dbSortDirections = getPreference<Record<string, boolean>>('meal_sort_directions', {});
  const [sortDirections, setSortDirections] = useState<Record<string, boolean>>({});

  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current) return;
    if (Object.keys(dbSortModes).length > 0) { setSortModes(dbSortModes); dbSyncedRef.current = true; }
  }, [dbSortModes]);
  useEffect(() => { if (Object.keys(dbMasterSortModes).length > 0) setMasterSortModes(dbMasterSortModes); }, [dbMasterSortModes]);
  useEffect(() => { if (Object.keys(dbAvailableSortModes).length > 0) setAvailableSortModes(dbAvailableSortModes); }, [dbAvailableSortModes]);
  useEffect(() => { if (Object.keys(dbUnParUnSortModes).length > 0) setUnParUnSortModes(dbUnParUnSortModes); }, [dbUnParUnSortModes]);
  useEffect(() => { if (Object.keys(dbSortDirections).length > 0) setSortDirections(dbSortDirections); }, [dbSortDirections]);

  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);
  const [chronoOpen, setChronoOpen] = useState(false);
  const [coursesTab, setCoursesTab] = useState<"liste" | "menu">("liste");

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

  if (!unlocked) return <PinLock onUnlock={() => {}} />;

  const openDialog = (target: "all" | "possible" = "all") => {
    setNewCategory(activeCategory);
    setAddTarget(target);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    const validationError = validateMealName(newName);
    if (validationError) {
      toast({ title: "Données invalides", description: validationError, variant: "destructive" });
      return;
    }
    const trimmedName = newName.trim();
    if (addTarget === "possible") {
      addMealToPossibleDirectly.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" }); }
      });
    } else {
      addMeal.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté 🎉" }); }
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

  const toggleSort = (cat: string) => {
    setSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next: SortMode = current === "manual" ? "expiration" : current === "expiration" ? "planning" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_sort_modes', JSON.stringify(updated));
      setPreference.mutate({ key: 'meal_sort_modes', value: updated });
      return updated;
    });
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
    setMasterSortModes((prev) => {
      const updated = { ...prev, [cat]: "manual" as MasterSortMode };
      setPreference.mutate({ key: 'meal_master_sort_modes', value: updated });
      return updated;
    });
  };

  const toggleMasterSort = (cat: string) => {
    setMasterSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next: MasterSortMode = current === "manual" ? "calories" : current === "calories" ? "protein" : current === "protein" ? "favorites" : current === "favorites" ? "ingredients" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_master_sort_modes', JSON.stringify(updated));
      setPreference.mutate({ key: 'meal_master_sort_modes', value: updated });
      return updated;
    });
  };


  const toggleSortDirection = (key: string) => {
    setSortDirections(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      setPreference.mutate({ key: 'meal_sort_directions', value: updated });
      return updated;
    });
  };

  const getSortedMaster = (cat: string): Meal[] => {
    const items = getMealsByCategory(cat);
    const mode = masterSortModes[cat] || "manual";
    const asc = sortDirections[`master-${cat}`] !== false; // default asc
    if (mode === "calories") {
      return [...items].sort((a, b) => {
        const ca = parseFloat((a.calories || "0").replace(/[^0-9.]/g, "")) || 0;
        const cb = parseFloat((b.calories || "0").replace(/[^0-9.]/g, "")) || 0;
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
    setSortModes((prev) => {
      const updated = { ...prev, [cat]: "manual" as SortMode };
      setPreference.mutate({ key: 'meal_sort_modes', value: updated });
      return updated;
    });
  };

  const toggleAvailableSort = (cat: string) => {
    setAvailableSortModes(prev => {
      const current = prev[cat] || "manual";
      const next: AvailableSortMode = current === "manual" ? "calories" : current === "calories" ? "protein" : current === "protein" ? "expiration" : "manual";
      const updated = { ...prev, [cat]: next };
      setPreference.mutate({ key: 'meal_available_sort_modes', value: updated });
      return updated;
    });
  };

  /** Deduct ingredients from stock */
  const deductIngredientsFromStock = async (meal: Meal): Promise<FoodItem[]> => {
    if (!meal.ingredients?.trim()) return [];
    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);
    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };

    for (const group of groups) {
      const alt = pickBestAlternative(group, stockMap);
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const key = findStockKey(stockMap, name);
      if (!key) continue;
      const stockInfo = stockMap.get(key);
      if (!stockInfo || stockInfo.infinite) continue;

      const matchingItems = foodItems
        .filter((fi) => strictNameMatch(fi.name, key) && !fi.is_infinite)
        .sort(sortStockDeductionPriority);

      if (neededCount > 0) {
        let toDeduct = neededCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          const remaining = fiCount - deduct;
          toDeduct -= deduct;
          rememberSnapshot(fi);
          if (remaining <= 0) { updatesById.set(fi.id, { id: fi.id, delete: true }); }
          else { updatesById.set(fi.id, { id: fi.id, quantity: Math.ceil(remaining) }); }
        }
      } else if (neededGrams > 0) {
        let toDeduct = neededGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const perUnit = parseQty(fi.grams);
          if (perUnit <= 0) continue;
          const totalAvailable = getFoodItemTotalGrams(fi);
          const deduct = Math.min(totalAvailable, toDeduct);
          const remaining = totalAvailable - deduct;
          toDeduct -= deduct;
          rememberSnapshot(fi);
          if (remaining <= 0) { updatesById.set(fi.id, { id: fi.id, delete: true }); continue; }
          if (fi.quantity && fi.quantity >= 1) {
            const fullUnits = Math.floor(remaining / perUnit);
            const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
            if (remainder > 0) {
              const shouldStartCounter = !fi.counter_start_date;
              updatesById.set(fi.id, { id: fi.id, quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, remainder), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}) });
            } else if (fullUnits > 0) {
              updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
            } else { updatesById.set(fi.id, { id: fi.id, delete: true }); }
          } else {
            const shouldStartCounter = !fi.counter_start_date;
            updatesById.set(fi.id, { id: fi.id, grams: formatNumeric(remaining), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}) });
          }
        }
      }
    }

    await Promise.all(Array.from(updatesById.values()).map((u) =>
      u.delete
        ? supabase.from("food_items").delete().eq("id", u.id)
        : supabase.from("food_items").update({
            ...(u.grams !== undefined ? { grams: u.grams } : {}),
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
          } as any).eq("id", u.id)
    ));
    qc.invalidateQueries({ queryKey: ["food_items"] });
    return Array.from(snapshotsById.values());
  };

  /** Restore ingredients to stock */
  const restoreIngredientsToStock = async (meal: Meal, snapshots?: FoodItem[]) => {
    if (snapshots && snapshots.length > 0) {
      await Promise.all(snapshots.map((fi) =>
        (supabase as any).from("food_items").upsert({
          id: fi.id, name: fi.name, grams: fi.grams, calories: fi.calories,
          protein: fi.protein, is_indivisible: fi.is_indivisible,
          expiration_date: fi.expiration_date, counter_start_date: fi.counter_start_date,
          sort_order: fi.sort_order, created_at: fi.created_at, is_meal: fi.is_meal,
          is_infinite: fi.is_infinite, is_dry: fi.is_dry, storage_type: fi.storage_type,
          quantity: fi.quantity, food_type: fi.food_type,
        })
      ));
      qc.invalidateQueries({ queryKey: ["food_items"] });
      return;
    }

    if (!meal.ingredients?.trim()) return;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      const liveStockMap = buildStockMap(foodItems);
      const alt = pickBestAlternative(group, liveStockMap) || group[0];
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const matchingItems = foodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite).sort(sortStockDeductionPriority);
      if (matchingItems.length === 0) continue;
      const fi = matchingItems[0];
      if (neededCount > 0) {
        const newQty = (fi.quantity ?? 1) + neededCount;
        await supabase.from("food_items").update({ quantity: Math.ceil(newQty) } as any).eq("id", fi.id);
      } else if (neededGrams > 0) {
        const fiGrams = parseQty(fi.grams);
        if (fi.quantity && fi.quantity >= 1 && fiGrams > 0) {
          const currentTotal = getFoodItemTotalGrams(fi);
          const newTotal = currentTotal + neededGrams;
          const fullUnits = Math.floor(newTotal / fiGrams);
          const remainder = Math.round((newTotal - fullUnits * fiGrams) * 10) / 10;
          await supabase.from("food_items").update({ quantity: remainder > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null) } as any).eq("id", fi.id);
        } else {
          const currentTotal = fiGrams;
          await supabase.from("food_items").update({ grams: formatNumeric(currentTotal + neededGrams) } as any).eq("id", fi.id);
        }
      }
    }
    const mealGrams = parseQty(meal.grams);
    if (mealGrams > 0) {
      const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch) {
        const unit = parseQty(nameMatch.grams);
        if (nameMatch.quantity && nameMatch.quantity >= 1 && unit > 0) {
          const currentTotal = getFoodItemTotalGrams(nameMatch);
          const newTotal = currentTotal + mealGrams;
          const fullUnits = Math.floor(newTotal / unit);
          const remainder = Math.round((newTotal - fullUnits * unit) * 10) / 10;
          await supabase.from("food_items").update({ quantity: remainder > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(unit, remainder > 0 ? remainder : null) } as any).eq("id", nameMatch.id);
        } else {
          await supabase.from("food_items").update({ grams: formatNumeric(unit + mealGrams) } as any).eq("id", nameMatch.id);
        }
      }
    }
    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  /** Adjust stock when possible meal ingredients are edited */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null) => {
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];
    const buildUsageMap = (groups: Array<Array<{qty: number; count: number; name: string}>>) => {
      const map = new Map<string, {grams: number; count: number}>();
      for (const group of groups) {
        if (group.length > 0) {
          const alt = group[0];
          const prev = map.get(alt.name) ?? { grams: 0, count: 0 };
          map.set(alt.name, { grams: prev.grams + alt.qty, count: prev.count + alt.count });
        }
      }
      return map;
    };
    const oldUsage = buildUsageMap(oldGroups);
    const newUsage = buildUsageMap(newGroups);
    const allKeys = new Set([...oldUsage.keys(), ...newUsage.keys()]);

    for (const ingName of allKeys) {
      const oldU = oldUsage.get(ingName) ?? { grams: 0, count: 0 };
      const newU = newUsage.get(ingName) ?? { grams: 0, count: 0 };
      const deltaGrams = newU.grams - oldU.grams;
      const deltaCount = newU.count - oldU.count;
      if (deltaGrams === 0 && deltaCount === 0) continue;

      const matchingItems = foodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite).sort(sortStockDeductionPriority);
      if (matchingItems.length === 0) continue;

      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
          if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", fi.id); }
          else {
            const perUnit = parseQty(fi.grams);
            if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              await supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", fi.id);
            } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id); }
          }
        }
      } else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        const fi = matchingItems[0];
        const perUnit = parseQty(fi.grams);
        if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
          const currentTotal = getFoodItemTotalGrams(fi);
          const newTotal = currentTotal + toAdd;
          const fullUnits = Math.floor(newTotal / perUnit);
          const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
          await supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", fi.id);
        } else {
          const current = parseQty(fi.grams);
          await supabase.from("food_items").update({ grams: formatNumeric(current + toAdd) } as any).eq("id", fi.id);
        }
      }

      if (deltaCount > 0) {
        let toDeduct = deltaCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          toDeduct -= deduct;
          const remaining = fiCount - deduct;
          if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", fi.id); }
          else { await supabase.from("food_items").update({ quantity: remaining } as any).eq("id", fi.id); }
        }
      } else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const fi = matchingItems[0];
        await supabase.from("food_items").update({ quantity: (fi.quantity ?? 1) + toAdd } as any).eq("id", fi.id);
      }
    }
    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  /** Deduct name-match stock */
  const deductNameMatchStock = async (meal: Meal) => {
    const mealGrams = parseQty(meal.grams);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;
    if (mealGrams <= 0) {
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) { await supabase.from("food_items").delete().eq("id", nameMatch.id); }
      else { await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", nameMatch.id); }
      qc.invalidateQueries({ queryKey: ["food_items"] });
      return;
    }
    const perUnit = parseQty(nameMatch.grams);
    if (nameMatch.quantity && nameMatch.quantity >= 1 && perUnit > 0) {
      const totalAvailable = getFoodItemTotalGrams(nameMatch);
      const remaining = totalAvailable - mealGrams;
      if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", nameMatch.id); }
      else {
        const fullUnits = Math.floor(remaining / perUnit);
        const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
        if (remainder > 0) { await supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, remainder) } as any).eq("id", nameMatch.id); }
        else if (fullUnits > 0) { await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit) } as any).eq("id", nameMatch.id); }
        else { await supabase.from("food_items").delete().eq("id", nameMatch.id); }
      }
    } else {
      const current = parseQty(nameMatch.grams);
      const remaining = Math.max(0, current - mealGrams);
      if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", nameMatch.id); }
      else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", nameMatch.id); }
    }
    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  // Export/Import handlers
  const handleExportMeals = () => {
    const allCats: MealCategory[] = ["plat", "entree", "dessert", "bonus", "petit_dejeuner"];
    const lines = allCats.flatMap((cat) => getMealsByCategory(cat)).map((m) => {
      const parts: string[] = [`cat=${m.category}`];
      if (m.calories) parts.push(`cal=${m.calories}`);
      if (m.protein) parts.push(`prot=${m.protein}`);
      if (m.grams) parts.push(`grams=${m.grams}`);
      if (m.ingredients) parts.push(`ing=${m.ingredients.replace(/\n/g, ', ')}`);
      if (m.oven_temp) parts.push(`oven_temp=${m.oven_temp}`);
      if (m.oven_minutes) parts.push(`oven_minutes=${m.oven_minutes}`);
      if (m.is_favorite) parts.push(`fav=1`);
      return `${m.name} (${parts.join('; ')})`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'repas.txt'; a.click();
    toast({ title: `✅ ${lines.length} repas exportés` });
    setShowDevMenu(false);
  };

  const handleImportMeals = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.type !== 'text/plain' && !file.name.toLowerCase().endsWith('.txt')) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      const text = await file.text();
      const lineParts = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let count = 0, skipped = 0;
      for (const line of lineParts) {
        const match = line.match(/^(.+?)\s*\((.+)\)$/);
        const name = match ? match[1].trim() : line;
        const paramsStr = match ? match[2] : '';
        const params: Record<string, string> = {};
        paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
        const validationErr = validateMealName(name);
        if (validationErr) { skipped++; continue; }
        const cat = (params.cat as MealCategory) || 'plat';
        const { data: inserted, error: insertErr } = await supabase.from("meals").insert({
          name: name.trim(), category: cat, color: colorFromName(name.trim()), sort_order: count, is_available: true,
          calories: params.cal || null, protein: params.prot || null, grams: params.grams || null, ingredients: params.ing || null,
          oven_temp: params.oven_temp || null, oven_minutes: params.oven_minutes || null, is_favorite: params.fav === '1',
        } as any).select().single();
        if (insertErr) { skipped++; continue; }
        if (inserted) await supabase.from("meals").update({ color: colorFromName(inserted.id) }).eq("id", inserted.id);
        count++;
      }
      toast({ title: skipped > 0 ? `✅ ${count} repas importés (${skipped} ignorés)` : `✅ ${count} repas importés` });
      setShowDevMenu(false);
    };
    input.click();
  };

  const handleExportShopping = () => {
    const lines: string[] = [];
    for (const group of shoppingGroups) {
      lines.push(`[${group.name}]`);
      const groupItems = shoppingItems.filter((i) => i.group_id === group.id).sort((a, b) => a.sort_order - b.sort_order);
      for (const item of groupItems) {
        const parts: string[] = [];
        if (item.quantity) parts.push(`qte=${item.quantity}`);
        if (item.brand) parts.push(`marque=${item.brand}`);
        if (item.checked) parts.push(`coche=1`);
        lines.push(parts.length > 0 ? `${item.name} (${parts.join('; ')})` : item.name);
      }
    }
    const ungrouped = shoppingItems.filter((i) => !i.group_id).sort((a, b) => a.sort_order - b.sort_order);
    if (ungrouped.length > 0) {
      lines.push(`[Sans groupe]`);
      for (const item of ungrouped) {
        const parts: string[] = [];
        if (item.quantity) parts.push(`qte=${item.quantity}`);
        if (item.brand) parts.push(`marque=${item.brand}`);
        if (item.checked) parts.push(`coche=1`);
        lines.push(parts.length > 0 ? `${item.name} (${parts.join('; ')})` : item.name);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'courses.txt'; a.click();
    toast({ title: `✅ Liste de courses exportée` });
    setShowDevMenu(false);
  };

  const handleImportShopping = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.type !== 'text/plain' && !file.name.toLowerCase().endsWith('.txt')) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const { supabase: sb } = await import('@/integrations/supabase/client');
      let currentGroupId: string | null = null;
      let groupOrder = shoppingGroups.length;
      let itemOrder = 0;
      let count = 0;
      for (const line of lines) {
        if (line.startsWith('[') && line.endsWith(']')) {
          const groupName = line.slice(1, -1);
          if (groupName !== 'Sans groupe') {
            const existing = shoppingGroups.find((g) => g.name === groupName);
            if (existing) { currentGroupId = existing.id; }
            else {
              const { data } = await (sb as any).from('shopping_groups').insert({ name: groupName, sort_order: groupOrder++ }).select().single();
              currentGroupId = data?.id ?? null;
            }
          } else { currentGroupId = null; }
          itemOrder = 0;
        } else {
          const match = line.match(/^(.+?)\s*\((.+)\)$/);
          const rawName = match ? match[1].trim() : line;
          if (!rawName || rawName.length > 100) continue;
          const paramsStr = match ? match[2] : '';
          const params: Record<string, string> = {};
          paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
          await (sb as any).from('shopping_items').insert({
            name: rawName, group_id: currentGroupId, quantity: params.qte || null, brand: params.marque || null, checked: params.coche === '1', sort_order: itemOrder++
          });
          count++;
        }
      }
      toast({ title: `✅ ${count} articles importés` });
      setShowDevMenu(false);
    };
    input.click();
  };

  return (
    <div className="min-h-screen bg-background">
      {showDevMenu &&
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowDevMenu(false)}>
          <div className="bg-card rounded-2xl p-6 space-y-3 w-72 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground">🛠 Outils cachés</h3>
            <p className="text-xs text-muted-foreground">Ces outils permettent d'exporter/importer vos données.</p>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Catalogue repas</p>
              <button onClick={handleExportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Download className="h-4 w-4" /> Exporter repas (.txt)</button>
              <button onClick={handleImportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Upload className="h-4 w-4" /> Importer repas (.txt)</button>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Liste de courses</p>
              <button onClick={handleExportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Download className="h-4 w-4" /> Exporter courses (.txt)</button>
              <button onClick={handleImportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Upload className="h-4 w-4" /> Importer courses (.txt)</button>
            </div>
            <p className="text-[10px] text-muted-foreground/50">Format repas: NOM (cat=plat; cal=350kcal; ing=riz, légumes)</p>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Sécurité</p>
              <button onClick={async () => {
                try {
                  const { data } = await supabase.functions.invoke("verify-pin", { body: { reset_blocked: true } });
                  if (data?.success) { setBlockedCount(0); toast({ title: "✅ Score PIN réinitialisé" }); }
                  else toast({ title: "❌ Erreur", variant: "destructive" });
                } catch { toast({ title: "❌ Erreur", variant: "destructive" }); }
                setShowDevMenu(false);
              }} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive">
                <ShieldAlert className="h-4 w-4" /> Réinitialiser score PIN ({blockedCount ?? 0})
              </button>
            </div>
            <button onClick={() => setShowDevMenu(false)} className="text-xs text-muted-foreground w-full text-center hover:text-foreground">Fermer</button>
          </div>
        </div>
      }

      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-2 py-2 sm:px-4 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 shrink-0">
            <h1 className="text-base sm:text-xl font-extrabold text-foreground cursor-pointer select-none" onClick={handleLogoClick} title="">🍽️</h1>
            {blockedCount !== null &&
            <span title={`${blockedCount} tentative${blockedCount > 1 ? 's' : ''} d'accès non autorisée${blockedCount > 1 ? 's' : ''} depuis la création`}
              className="flex items-center gap-0.5 text-[9px] font-bold text-destructive/80 bg-destructive/10 rounded-full px-1 py-0.5 cursor-default shrink-0">
                <ShieldAlert className="h-2 w-2" />{blockedCount}
              </span>
            }
          </div>

          <div className="flex items-center flex-1 min-w-0 justify-center">
            <div className="bg-muted rounded-full p-0.5 w-full max-w-xs md:max-w-md py-[6px] my-0 px-0 flex items-center justify-center gap-[2px]">
              {([
                { page: "aliments" as MainPage, icon: <Apple className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Aliments", activeColor: "text-lime-600 dark:text-lime-400" },
                { page: "repas" as MainPage, icon: <UtensilsCrossed className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Repas", activeColor: "text-orange-500" },
                { page: "planning" as MainPage, icon: <CalendarRange className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Planning", activeColor: "text-blue-500" },
                { page: "courses" as MainPage, icon: <ShoppingCart className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Courses", activeColor: "text-green-500" },
              ] as const).map(({ page, icon, label, activeColor }) => (
                <button key={page} onClick={() => setMainPage(page)}
                  className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 md:gap-1 min-w-0 px-1 md:px-3 ${mainPage === page ? "bg-background shadow-sm" : ""}`}>
                  {icon}
                  <span className={`text-[9px] md:text-sm truncate leading-tight ${mainPage === page ? `${activeColor} font-bold` : "text-muted-foreground"}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setChronoOpen(true)}
            className="text-[10px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0 bg-muted/60 hover:bg-muted rounded-full px-2.5 py-1">
            <span className="capitalize">{format(new Date(), 'EEE', { locale: fr })}</span>
            <span className="font-black text-foreground">{format(new Date(), 'd')}</span>
          </button>
        </div>
      </header>
      <Chronometer open={chronoOpen} onOpenChange={setChronoOpen} />

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        <Suspense fallback={<div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
          {mainPage === "aliments" && (
            <div>
              <LazyFoodItems />
              <LazyFoodItemsSuggestions foodItems={foodItems} existingMealNames={meals.filter(m => m.is_available).map(m => m.name)} />
            </div>
          )}
          {mainPage === "courses" && (
            <div>
              <div className="sticky top-[44px] sm:top-[52px] z-10 bg-background/95 backdrop-blur-sm pb-2 pt-1">
                <div className="flex items-center gap-1 bg-muted rounded-full p-0.5 max-w-xs mx-auto">
                  <button onClick={() => setCoursesTab("liste")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "liste" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🛒 Liste</button>
                  <button onClick={() => setCoursesTab("menu")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "menu" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🎲 Menu</button>
                </div>
              </div>
              {coursesTab === "liste" ? <LazyShoppingList /> : <LazyMealPlanGenerator />}
            </div>
          )}
          {mainPage === "planning" && <LazyWeeklyPlanning />}
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
                      <Button onClick={() => { setAddTarget("all"); handleAdd(); }} disabled={!newName.trim()} className="flex-1 text-xs rounded-xl">Tous les repas</Button>
                      <Button onClick={() => { setAddTarget("possible"); handleAdd(); }} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs rounded-xl">Possibles uniquement</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {CATEGORIES.map((cat) =>
          <TabsContent key={cat.value} value={cat.value}>
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
                  onMoveToPossible={async (id) => {
                    const result = await moveToPossible.mutateAsync({ mealId: id });
                    if (result?.id) setMasterSourcePmIds(prev => new Set([...prev, result.id]));
                  }}
                  onRename={(id, name) => renameMeal.mutate({ id, name })}
                  onDelete={(id) => deleteMeal.mutate(id)}
                  onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                  onUpdateProtein={(id, prot) => updateProtein.mutate({ id, protein: prot })}
                  onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                  onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                  onToggleFavorite={(id) => {
                    const meal = meals.find((m) => m.id === id);
                    if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                  }}
                  onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                  onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                  onReorder={(from, to) => handleReorderMeals(cat.value, from, to)} />

                    <LazyAvailableList
                  category={cat}
                  meals={getMealsByCategory(cat.value)}
                  foodItems={foodItems}
                  allMeals={meals}
                  sortMode={availableSortModes[cat.value] || "manual"}
                  sortAsc={sortDirections[`available-${cat.value}`] !== false}
                  onToggleSort={() => toggleAvailableSort(cat.value)}
                  onToggleSortDirection={() => toggleSortDirection(`available-${cat.value}`)}
                  collapsed={collapsedSections[`available-${cat.value}`] ?? false}
                  onToggleCollapse={() => toggleSectionCollapse(`available-${cat.value}`)}
                  onMoveToPossible={async (mealId) => {
                    const meal = meals.find(m => m.id === mealId);
                    if (meal) {
                      const snapshots = await deductIngredientsFromStock(meal);
                      const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
                      if (nameMatch && !snapshots.find(s => s.id === nameMatch.id)) snapshots.push({ ...nameMatch });
                      const expDate = getEarliestIngredientExpiration(meal, foodItems);
                      const result = await moveToPossible.mutateAsync({ mealId, expiration_date: expDate });
                      if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                    }
                  }}
                  onMovePartialToPossible={async (meal, ratio) => {
                    const partialMeal = buildScaledMealForRatio(meal, ratio);
                    const snapshots = await deductIngredientsFromStock(partialMeal);
                    const expDate = getEarliestIngredientExpiration(meal, foodItems);
                    const result = await addMealToPossibleDirectly.mutateAsync({
                      name: meal.name, category: cat.value, colorSeed: meal.id,
                      calories: partialMeal.calories, grams: partialMeal.grams, ingredients: partialMeal.ingredients, expiration_date: expDate,
                    });
                    if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                  }}
                  onMoveNameMatchToPossible={async (meal, fi) => {
                    const snapshot = [{ ...fi }];
                    await deductNameMatchStock(meal);
                    const result = await moveToPossible.mutateAsync({ mealId: meal.id, expiration_date: fi.expiration_date });
                    if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
                  }}
                  onMoveFoodItemToPossible={async (fi) => {
                    const snapshot = [{ ...fi }];
                    if (!fi.is_infinite) {
                      const currentQty = fi.quantity ?? 1;
                      if (currentQty <= 1) { await supabase.from("food_items").delete().eq("id", fi.id); }
                      else { await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", fi.id); }
                      qc.invalidateQueries({ queryKey: ["food_items"] });
                    }
                    const pmResult = await addMealToPossibleDirectly.mutateAsync({ name: fi.name, category: cat.value, colorSeed: fi.id });
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
                  onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })} />

                  </div>
                  <div className="order-3 md:order-2">
                <LazyPossibleList
                category={cat}
                items={getSortedPossible(cat.value)}
                sortMode={sortModes[cat.value] || "manual"}
                onToggleSort={() => toggleSort(cat.value)}
                onRandomPick={() => handleRandomPick(cat.value)}
                onRemove={(id) => { removeFromPossible.mutate(id); }}
                onReturnWithoutDeduction={async (id) => {
                  const snapshots = deductionSnapshots[id];
                  if (snapshots && snapshots.length > 0) {
                    await restoreIngredientsToStock({} as Meal, snapshots);
                    updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                  } else {
                    const allPossible = getPossibleByCategory(cat.value);
                    const pm = allPossible.find(p => p.id === id);
                    if (pm?.meals) await restoreIngredientsToStock(pm.meals);
                  }
                  removeFromPossible.mutate(id);
                  setUnParUnSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });
                }}
                onReturnToMaster={(id) => {
                  removeFromPossible.mutate(id);
                  setMasterSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });
                }}
                onDelete={(id) => { deletePossibleMeal.mutate(id); }}
                onDuplicate={(id) => duplicatePossibleMeal.mutate(id)}
                onUpdateExpiration={(id, d) => updateExpiration.mutate({ id, expiration_date: d })}
                onUpdatePlanning={(id, day, time) => updatePlanning.mutate({ id, day_of_week: day, meal_time: time })}
                onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                onUpdateGrams={async (id, g) => {
                  const pm = possibleMeals.find(p => p.meal_id === id);
                  if (pm && unParUnSourcePmIds.has(pm.id)) {
                    if (pm.meals) {
                      const oldGrams = parseQty(pm.meals.grams);
                      const newGrams = parseQty(g);
                      const delta = oldGrams - newGrams;
                      if (delta !== 0) {
                        const matchingFi = foodItems.find(fi => strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
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
                  if (oldIngredients || newIngredients) await adjustStockForIngredientChange(oldIngredients, newIngredients);
                  updatePossibleIngredients.mutate({ id: pmId, ingredients_override: newIngredients });
                }}
                onUpdateQuantity={async (id, qty) => {
                  if (unParUnSourcePmIds.has(id)) {
                    const pm = possibleMeals.find(p => p.id === id);
                    if (pm?.meals) {
                      const oldQty = pm.quantity;
                      const delta = oldQty - qty;
                      if (delta !== 0) {
                        const matchingFi = foodItems.find(fi => strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
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
                        } else if (delta < 0) {
                          toast({ title: "⚠️ Stock insuffisant", description: `Plus de "${pm.meals.name}" en stock.` });
                        }
                      }
                    }
                  }
                  updatePossibleQuantity.mutate({ id, quantity: qty });
                }}
                onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                onExternalDrop={async (mealId, source) => {
                  const result = await moveToPossible.mutateAsync({ mealId });
                  if (result?.id && source === "master") setMasterSourcePmIds(prev => new Set([...prev, result.id]));
                }}
                highlightedId={highlightedId}
                foodItems={foodItems}
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
                        setUnParUnSortModes(prev => {
                          const current = prev[cat.value] || "expiration";
                          const next: UnParUnSortMode = current === "manual" ? "expiration" : "manual";
                          const updated = { ...prev, [cat.value]: next };
                          setPreference.mutate({ key: 'meal_unparun_sort_modes', value: updated });
                          return updated;
                        });
                      }}
                      onMoveToPossible={async (fi, consumeQty, consumeGrams) => {
                        const snapshot = [{ ...fi }];
                        if (!fi.is_infinite) {
                          if (consumeGrams && consumeGrams > 0) {
                            const perUnit = parseQty(fi.grams);
                            const totalAvail = getFoodItemTotalGrams(fi);
                            const remaining = totalAvail - consumeGrams;
                            if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", fi.id); }
                            else if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
                              const fullUnits = Math.floor(remaining / perUnit);
                              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                              if (rem > 0) { await supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, rem) } as any).eq("id", fi.id); }
                              else if (fullUnits > 0) { await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit), counter_start_date: null } as any).eq("id", fi.id); }
                              else { await supabase.from("food_items").delete().eq("id", fi.id); }
                            } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id); }
                          } else {
                            const deductQty = consumeQty ?? 1;
                            const currentQty = fi.quantity ?? 1;
                            if (currentQty <= deductQty) { await supabase.from("food_items").delete().eq("id", fi.id); }
                            else { await supabase.from("food_items").update({ quantity: currentQty - deductQty } as any).eq("id", fi.id); }
                          }
                          qc.invalidateQueries({ queryKey: ["food_items"] });
                        }
                        const displayGrams = consumeGrams ? String(consumeGrams) : (fi.grams ? String(parseQty(fi.grams)) : null);
                        const displayQty = consumeQty ?? 1;
                        const pmResult = await addMealToPossibleDirectly.mutateAsync({
                          name: fi.name, category: cat.value, colorSeed: fi.id, calories: fi.calories, grams: displayGrams,
                          expiration_date: fi.expiration_date, possible_quantity: displayQty,
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
              </TabsContent>
          )}
          </Tabs>
        }
        </Suspense>
      </main>
    </div>);
};

export default Index;
