import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Lock, Loader2, ChevronDown, ChevronRight, Download, Upload, ShieldAlert, Apple, Sparkles, Infinity as InfinityIcon, Star, List, Flame, Search, Drumstick, Wheat, Timer } from "lucide-react";
import { Chronometer } from "@/components/Chronometer";
import { MealPlanGenerator } from "@/components/MealPlanGenerator";
import { FoodItemsSuggestions } from "@/components/FoodItemsSuggestions";

import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MealList } from "@/components/MealList";
import { MealCard } from "@/components/MealCard";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import { ShoppingList } from "@/components/ShoppingList";
import { WeeklyPlanning } from "@/components/WeeklyPlanning";
import { FoodItems, useFoodItems, colorFromName, type FoodItem } from "@/components/FoodItems";

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

const CATEGORIES: {value: MealCategory;label: string;emoji: string;}[] = [
{ value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
{ value: "entree", label: "Entrées", emoji: "🥗" },
{ value: "plat", label: "Plats", emoji: "🍽️" },
{ value: "dessert", label: "Desserts", emoji: "🍰" },
{ value: "bonus", label: "Bonus", emoji: "⭐" }];

const mealSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)")
});

type SortMode = "manual" | "expiration" | "planning";
type MasterSortMode = "manual" | "calories" | "favorites" | "ingredients";
type AvailableSortMode = "manual" | "calories" | "expiration";
type UnParUnSortMode = "manual" | "expiration";
type MainPage = "aliments" | "repas" | "planning" | "courses";

function PinLock({ onUnlock }: {onUnlock: () => void;}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("Code incorrect");
  const [loading, setLoading] = useState(false);

  const showError = (msg = "Code incorrect") => {
    setErrorMsg(msg);
    setError(true);
    setPin("");
    setTimeout(() => setError(false), 2000);
  };

  const handleSubmit = async () => {
    if (pin.length !== 4 || loading) return;
    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/verify-pin`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${anonKey}` },
          body: JSON.stringify({ pin }),
        }
      );
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* ignore */ }

      if (data.success && data.access_token && data.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.access_token as string,
          refresh_token: data.refresh_token as string,
        });
        onUnlock();
      } else if (res.status === 401 && data.error?.toString().includes("Accès refusé")) {
        showError((data.error as string) || "Accès refusé");
      } else {
        showError((data.error as string) || "Code incorrect");
      }
    } catch {
      showError("Service indisponible, réessaie");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 p-8">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold text-foreground">Code d'accès</h2>
        <Input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="••••"
          className={`w-32 text-center text-2xl tracking-[0.5em] font-mono rounded-xl ${error ? 'border-destructive animate-shake' : ''}`}
          autoFocus
          disabled={loading} />

        <Button onClick={handleSubmit} disabled={pin.length !== 4 || loading} className="w-32 rounded-xl">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrer"}
        </Button>
        {/* Error message hidden intentionally */}
      </div>
    </div>);
}

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
  const { items: foodItems, deleteItem: deleteFoodItemMutation } = useFoodItems();
  const deleteFoodItem = (id: string) => deleteFoodItemMutation.mutate(id);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const mainPage: MainPage = ROUTE_TO_PAGE[location.pathname] ?? "repas";
  const setMainPage = (page: MainPage) => navigate(PAGE_TO_ROUTE[page]);

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

  const unlocked = !!session;

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

  // Realtime: sync food_items, meals, possible_meals across sessions
  useEffect(() => {
    if (!unlocked) return;
    const channel = supabase
      .channel('global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items' }, () => {
        qc.invalidateQueries({ queryKey: ["food_items"] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => {
        qc.invalidateQueries({ queryKey: ["meals"] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'possible_meals' }, () => {
        qc.invalidateQueries({ queryKey: ["possible_meals"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [unlocked, qc]);

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals();

  // One-time color refresh: update all meal colors to match current palette
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

  const { groups: shoppingGroups, items: shoppingItems } = useShoppingList();
  const { getPreference, setPreference } = usePreferences();

  // Sunday auto-clear: remove all possible meals and planning manual calories ONLY on Sunday at 23:59+
  const lastWeeklyReset = getPreference<string>('last_weekly_reset', '');
  const sundayClearDone = useRef(false);
  useEffect(() => {
    if (!unlocked || sundayClearDone.current) return;

    const now = new Date();
    const day = now.getDay(); // 0=Sunday

    // Only trigger on Sunday after 23:59
    if (day !== 0 || now.getHours() < 23 || (now.getHours() === 23 && now.getMinutes() < 59)) {
      sundayClearDone.current = true;
      return;
    }

    // It's Sunday >= 23:59 — check if already reset today
    const todaySunday = new Date(now);
    todaySunday.setHours(23, 59, 0, 0);

    if (lastWeeklyReset && new Date(lastWeeklyReset) >= todaySunday) {
      sundayClearDone.current = true;
      return;
    }

    // Nothing to clear — just mark as done
    if (possibleMeals.length === 0) {
      sundayClearDone.current = true;
      setPreference.mutate({ key: 'last_weekly_reset', value: now.toISOString() });
      return;
    }

    sundayClearDone.current = true;
    const clearAll = async () => {
      // Get keepOnReset preferences
      const keepPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_keep_on_reset').maybeSingle();
      const keepOnReset: Record<string, boolean> = (keepPrefResult.data?.value as Record<string, boolean>) ?? {};

      await Promise.all(possibleMeals.map(pm =>
        (supabase as any).from("possible_meals").delete().eq("id", pm.id)
      ));

      // Filter manual calories: keep entries marked with keepOnReset
      const manualPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_manual_calories').maybeSingle();
      const currentManual: Record<string, number> = (manualPrefResult.data?.value as Record<string, number>) ?? {};
      const keptManual: Record<string, number> = {};
      for (const [key, val] of Object.entries(currentManual)) {
        if (keepOnReset[`manual-${key}`]) keptManual[key] = val;
      }
      setPreference.mutate({ key: 'planning_manual_calories', value: keptManual });

      // Filter extra calories: keep entries marked with keepOnReset
      const extraPrefResult = await supabase.from('user_preferences').select('value').eq('key', 'planning_extra_calories').maybeSingle();
      const currentExtra: Record<string, number> = (extraPrefResult.data?.value as Record<string, number>) ?? {};
      const keptExtra: Record<string, number> = {};
      for (const [key, val] of Object.entries(currentExtra)) {
        if (keepOnReset[`extra-${key}`]) keptExtra[key] = val;
      }
      setPreference.mutate({ key: 'planning_extra_calories', value: keptExtra });

      // Filter breakfast selections: keep entries marked with keepOnReset
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
  // Persist deduction snapshots in user_preferences for exact rollback across sessions
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

  // Sort modes: load from DB preferences, fallback to localStorage, then defaults
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

  // Available sort modes — persist to DB
  const dbAvailableSortModes = getPreference<Record<string, AvailableSortMode>>('meal_available_sort_modes', {});
  const [availableSortModes, setAvailableSortModes] = useState<Record<string, AvailableSortMode>>({});
  const dbUnParUnSortModes = getPreference<Record<string, UnParUnSortMode>>('meal_unparun_sort_modes', {});
  const [unParUnSortModes, setUnParUnSortModes] = useState<Record<string, UnParUnSortMode>>({});

  // Sync from DB on load (DB takes priority)
  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current) return;
    if (Object.keys(dbSortModes).length > 0) {
      setSortModes(dbSortModes);
      dbSyncedRef.current = true;
    }
  }, [dbSortModes]);
  useEffect(() => {
    if (Object.keys(dbMasterSortModes).length > 0) {
      setMasterSortModes(dbMasterSortModes);
    }
  }, [dbMasterSortModes]);
  useEffect(() => {
    if (Object.keys(dbAvailableSortModes).length > 0) {
      setAvailableSortModes(dbAvailableSortModes);
    }
  }, [dbAvailableSortModes]);
  useEffect(() => {
    if (Object.keys(dbUnParUnSortModes).length > 0) {
      setUnParUnSortModes(dbUnParUnSortModes);
    }
  }, [dbUnParUnSortModes]);

  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);
  const [chronoOpen, setChronoOpen] = useState(false);
  const [coursesTab, setCoursesTab] = useState<"liste" | "menu">("liste");

  // Session-only collapse state for categories (reset on reconnect)
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
    const result = mealSchema.safeParse({ name: newName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }
    if (addTarget === "possible") {
      addMealToPossibleDirectly.mutate({ name: result.data.name, category: newCategory }, {
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" }); }
      });
    } else {
      addMeal.mutate({ name: result.data.name, category: newCategory }, {
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
      const next: MasterSortMode = current === "manual" ? "calories" : current === "calories" ? "favorites" : current === "favorites" ? "ingredients" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_master_sort_modes', JSON.stringify(updated));
      setPreference.mutate({ key: 'meal_master_sort_modes', value: updated });
      return updated;
    });
  };

  const getSortedMaster = (cat: string): Meal[] => {
    const items = getMealsByCategory(cat);
    const mode = masterSortModes[cat] || "manual";
    if (mode === "calories") {
      return [...items].sort((a, b) => {
        const ca = parseFloat((a.calories || "0").replace(/[^0-9.]/g, "")) || 0;
        const cb = parseFloat((b.calories || "0").replace(/[^0-9.]/g, "")) || 0;
        return ca - cb;
      });
    }
    if (mode === "favorites") {
      return [...items].sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
    }
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
      const next: AvailableSortMode = current === "manual" ? "calories" : current === "calories" ? "expiration" : "manual";
      const updated = { ...prev, [cat]: next };
      setPreference.mutate({ key: 'meal_available_sort_modes', value: updated });
      return updated;
    });
  };

  // sortStockDeductionPriority imported from @/lib/stockUtils

  /** Deduct ingredients from stock and return pre-deduction snapshots for exact rollback */
  const deductIngredientsFromStock = async (meal: Meal): Promise<FoodItem[]> => {
    if (!meal.ingredients?.trim()) return [];

    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);

    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();

    const rememberSnapshot = (fi: FoodItem) => {
      if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi });
    };

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
          if (remaining <= 0) {
            updatesById.set(fi.id, { id: fi.id, delete: true });
          } else {
            // quantity is an integer column, keep persistence safe for fractional recipes
            updatesById.set(fi.id, { id: fi.id, quantity: Math.ceil(remaining) });
          }
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

          if (remaining <= 0) {
            updatesById.set(fi.id, { id: fi.id, delete: true });
            continue;
          }

          if (fi.quantity && fi.quantity >= 1) {
            const fullUnits = Math.floor(remaining / perUnit);
            const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;

            if (remainder > 0) {
              // Auto-start counter when creating a partial remainder
              const shouldStartCounter = !fi.counter_start_date;
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: Math.max(1, fullUnits + 1),
                grams: encodeStoredGrams(perUnit, remainder),
                ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}),
              });
            } else if (fullUnits > 0) {
              // Full units remaining, no partial — clear counter if was set
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: fullUnits,
                grams: formatNumeric(perUnit),
                ...(fi.counter_start_date ? { counter_start_date: null } : {}),
              });
            } else {
              updatesById.set(fi.id, { id: fi.id, delete: true });
            }
          } else {
            // Non-quantity item: partial grams remaining — auto-start counter
            const shouldStartCounter = !fi.counter_start_date;
            updatesById.set(fi.id, {
              id: fi.id,
              grams: formatNumeric(remaining),
              ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}),
            });
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

  /** Restore ingredients to stock (reverse of deductIngredientsFromStock) */
  const restoreIngredientsToStock = async (meal: Meal, snapshots?: FoodItem[]) => {
    if (snapshots && snapshots.length > 0) {
      await Promise.all(snapshots.map((fi) =>
        (supabase as any).from("food_items").upsert({
          id: fi.id,
          name: fi.name,
          grams: fi.grams,
          calories: fi.calories,
          expiration_date: fi.expiration_date,
          counter_start_date: fi.counter_start_date,
          sort_order: fi.sort_order,
          created_at: fi.created_at,
          is_meal: fi.is_meal,
          is_infinite: fi.is_infinite,
          is_dry: fi.is_dry,
          storage_type: fi.storage_type,
          quantity: fi.quantity,
          food_type: fi.food_type,
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
      const matchingItems = foodItems
        .filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite)
        .sort(sortStockDeductionPriority);
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
          await supabase.from("food_items").update({
            quantity: remainder > 0 ? fullUnits + 1 : fullUnits,
            grams: encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null),
          } as any).eq("id", fi.id);
        } else {
          const currentTotal = fiGrams;
          const newTotal = currentTotal + neededGrams;
          await supabase.from("food_items").update({ grams: formatNumeric(newTotal) } as any).eq("id", fi.id);
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
          await supabase.from("food_items").update({
            quantity: remainder > 0 ? fullUnits + 1 : fullUnits,
            grams: encodeStoredGrams(unit, remainder > 0 ? remainder : null),
          } as any).eq("id", nameMatch.id);
        } else {
          const newTotal = unit + mealGrams;
          await supabase.from("food_items").update({ grams: formatNumeric(newTotal) } as any).eq("id", nameMatch.id);
        }
      }
    }

    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  /** Adjust stock when possible meal ingredients are edited.
   * Compares old vs new ingredient lists and deducts/adds the difference per ingredient.
   */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null) => {
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];

    // Build maps: ingredient name -> {grams, count}
    const buildUsageMap = (groups: Array<Array<{qty: number; count: number; name: string}>>) => {
      const map = new Map<string, {grams: number; count: number}>();
      for (const group of groups) {
        // For OR groups, take first alt
        if (group.length > 0) {
          const alt = group[0];
          const key = alt.name;
          const prev = map.get(key) ?? { grams: 0, count: 0 };
          map.set(key, { grams: prev.grams + alt.qty, count: prev.count + alt.count });
        }
      }
      return map;
    };

    const oldUsage = buildUsageMap(oldGroups);
    const newUsage = buildUsageMap(newGroups);

    // For each ingredient, compute delta
    const allKeys = new Set([...oldUsage.keys(), ...newUsage.keys()]);
    for (const ingName of allKeys) {
      const oldU = oldUsage.get(ingName) ?? { grams: 0, count: 0 };
      const newU = newUsage.get(ingName) ?? { grams: 0, count: 0 };
      const deltaGrams = newU.grams - oldU.grams; // positive = need to deduct more
      const deltaCount = newU.count - oldU.count;

      if (deltaGrams === 0 && deltaCount === 0) continue;

      const matchingItems = foodItems
        .filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite)
        .sort(sortStockDeductionPriority);
      if (matchingItems.length === 0) continue;

      if (deltaGrams > 0) {
        // Need to deduct more grams from stock
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;

          if (remaining <= 0) {
            await supabase.from("food_items").delete().eq("id", fi.id);
          } else {
            const perUnit = parseQty(fi.grams);
            if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              await supabase.from("food_items").update({
                quantity: remainder > 0 ? Math.max(1, fullUnits + 1) : fullUnits,
                grams: encodeStoredGrams(perUnit, remainder > 0 ? remainder : null),
              } as any).eq("id", fi.id);
            } else {
              await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id);
            }
          }
        }
      } else if (deltaGrams < 0) {
        // Need to add grams back to stock
        const toAdd = -deltaGrams;
        const fi = matchingItems[0];
        const perUnit = parseQty(fi.grams);
        if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
          const currentTotal = getFoodItemTotalGrams(fi);
          const newTotal = currentTotal + toAdd;
          const fullUnits = Math.floor(newTotal / perUnit);
          const remainder = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
          await supabase.from("food_items").update({
            quantity: remainder > 0 ? fullUnits + 1 : fullUnits,
            grams: encodeStoredGrams(perUnit, remainder > 0 ? remainder : null),
          } as any).eq("id", fi.id);
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
          if (remaining <= 0) {
            await supabase.from("food_items").delete().eq("id", fi.id);
          } else {
            await supabase.from("food_items").update({ quantity: remaining } as any).eq("id", fi.id);
          }
        }
      } else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const fi = matchingItems[0];
        await supabase.from("food_items").update({ quantity: (fi.quantity ?? 1) + toAdd } as any).eq("id", fi.id);
      }
    }

    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  /** Deduct name-match stock (for is_meal food items or name-matched recipes) */
  const deductNameMatchStock = async (meal: Meal) => {
    const mealGrams = parseQty(meal.grams);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;

    if (mealGrams <= 0) {
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await supabase.from("food_items").delete().eq("id", nameMatch.id);
      } else {
        await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", nameMatch.id);
      }
      qc.invalidateQueries({ queryKey: ["food_items"] });
      return;
    }

    const perUnit = parseQty(nameMatch.grams);
    if (nameMatch.quantity && nameMatch.quantity >= 1 && perUnit > 0) {
      const totalAvailable = getFoodItemTotalGrams(nameMatch);
      const remaining = totalAvailable - mealGrams;
      if (remaining <= 0) {
        await supabase.from("food_items").delete().eq("id", nameMatch.id);
      } else {
        const fullUnits = Math.floor(remaining / perUnit);
        const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
        if (remainder > 0) {
          await supabase.from("food_items").update({
            quantity: Math.max(1, fullUnits + 1),
            grams: encodeStoredGrams(perUnit, remainder),
          } as any).eq("id", nameMatch.id);
        } else if (fullUnits > 0) {
          await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit) } as any).eq("id", nameMatch.id);
        } else {
          await supabase.from("food_items").delete().eq("id", nameMatch.id);
        }
      }
    } else {
      const current = parseQty(nameMatch.grams);
      const remaining = Math.max(0, current - mealGrams);
      if (remaining <= 0) {
        await supabase.from("food_items").delete().eq("id", nameMatch.id);
      } else {
        await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", nameMatch.id);
      }
    }

    qc.invalidateQueries({ queryKey: ["food_items"] });
  };

  const handleExportMeals = () => {
    const allCats: MealCategory[] = ["plat", "entree", "dessert", "bonus", "petit_dejeuner"];
    const lines = allCats.flatMap((cat) => getMealsByCategory(cat)).map((m) => {
      const parts: string[] = [`cat=${m.category}`];
      if (m.calories) parts.push(`cal=${m.calories}`);
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
      const isPlainText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
      if (!isPlainText) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      const text = await file.text();
      const lineParts = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let count = 0;
      let skipped = 0;
      for (const line of lineParts) {
        const match = line.match(/^(.+?)\s*\((.+)\)$/);
        const name = match ? match[1].trim() : line;
        const paramsStr = match ? match[2] : '';
        const params: Record<string, string> = {};
        paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
        const result = mealSchema.safeParse({ name });
        if (!result.success) { skipped++; continue; }
        // Insert meal with all exported fields
        const cat = (params.cat as MealCategory) || 'plat';
        const { data: inserted, error: insertErr } = await supabase
          .from("meals")
          .insert({
            name: result.data.name,
            category: cat,
            color: colorFromName(result.data.name),
            sort_order: count,
            is_available: true,
            calories: params.cal || null,
            grams: params.grams || null,
            ingredients: params.ing || null,
            oven_temp: params.oven_temp || null,
            oven_minutes: params.oven_minutes || null,
            is_favorite: params.fav === '1',
          } as any)
          .select()
          .single();
        if (insertErr) { skipped++; continue; }
        if (inserted) {
          await supabase.from("meals").update({ color: colorFromName(inserted.id) }).eq("id", inserted.id);
        }
        count++;
      }
      const msg = skipped > 0 ? `✅ ${count} repas importés (${skipped} ignorés)` : `✅ ${count} repas importés`;
      toast({ title: msg });
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
      const isPlainText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
      if (!isPlainText) {
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
            if (existing) {
              currentGroupId = existing.id;
            } else {
              const { data } = await (sb as any).from('shopping_groups').insert({ name: groupName, sort_order: groupOrder++ }).select().single();
              currentGroupId = data?.id ?? null;
            }
          } else {
            currentGroupId = null;
          }
          itemOrder = 0;
        } else {
          const match = line.match(/^(.+?)\s*\((.+)\)$/);
          const rawName = match ? match[1].trim() : line;
          if (!rawName || rawName.length > 100) continue;
          const paramsStr = match ? match[2] : '';
          const params: Record<string, string> = {};
          paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
          await (sb as any).from('shopping_items').insert({
            name: rawName,
            group_id: currentGroupId,
            quantity: params.qte || null,
            brand: params.marque || null,
            checked: params.coche === '1',
            sort_order: itemOrder++
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
              <button onClick={handleExportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground">
                <Download className="h-4 w-4" /> Exporter repas (.txt)
              </button>
              <button onClick={handleImportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground">
                <Upload className="h-4 w-4" /> Importer repas (.txt)
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Liste de courses</p>
              <button onClick={handleExportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground">
                <Download className="h-4 w-4" /> Exporter courses (.txt)
              </button>
              <button onClick={handleImportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground">
                <Upload className="h-4 w-4" /> Importer courses (.txt)
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/50">Format repas: NOM (cat=plat; cal=350kcal; ing=riz, légumes)</p>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Sécurité</p>
              <button onClick={async () => {
                try {
                  const { data } = await supabase.functions.invoke("verify-pin", { body: { reset_blocked: true } });
                  if (data?.success) { setBlockedCount(0); toast({ title: "✅ Score PIN réinitialisé" }); } else
                  toast({ title: "❌ Erreur", variant: "destructive" });
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
            <span
              title={`${blockedCount} tentative${blockedCount > 1 ? 's' : ''} d'accès non autorisée${blockedCount > 1 ? 's' : ''} depuis la création`}
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
                <button
                  key={page}
                  onClick={() => setMainPage(page)}
                  className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 md:gap-1 min-w-0 px-1 md:px-3 ${mainPage === page ? "bg-background shadow-sm" : ""}`}
                >
                  {icon}
                  <span className={`text-[9px] md:text-sm truncate leading-tight ${mainPage === page ? `${activeColor} font-bold` : "text-muted-foreground"}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setChronoOpen(true)}
            className="text-[10px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0 bg-muted/60 hover:bg-muted rounded-full px-2.5 py-1"
          >
            <span className="capitalize">{format(new Date(), 'EEE', { locale: fr })}</span>
            <span className="font-black text-foreground">{format(new Date(), 'd')}</span>
          </button>
        </div>
      </header>
      <Chronometer open={chronoOpen} onOpenChange={setChronoOpen} />

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        <div className={mainPage === "aliments" ? "" : "hidden"}>
          <FoodItems />
          <FoodItemsSuggestions foodItems={foodItems} existingMealNames={meals.filter(m => m.is_available).map(m => m.name)} />
        </div>
        {mainPage === "courses" && (
          <div>
            <div className="flex items-center gap-1 mb-3 bg-muted rounded-full p-0.5 max-w-xs mx-auto">
              <button onClick={() => setCoursesTab("liste")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "liste" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>
                🛒 Liste
              </button>
              <button onClick={() => setCoursesTab("menu")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "menu" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>
                🎲 Menu
              </button>
            </div>
            <div className={coursesTab === "liste" ? "" : "hidden"}><ShoppingList /></div>
            <div className={coursesTab === "menu" ? "" : "hidden"}><MealPlanGenerator /></div>
          </div>
        )}
        {mainPage === "planning" && <WeeklyPlanning />}
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
                  <DialogHeader>
                    <DialogTitle>Nouveau repas</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <Input autoFocus placeholder="Ex: Pâtes carbonara" value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  className="rounded-xl" />
                    <Select value={newCategory} onValueChange={(v) => setNewCategory(v as MealCategory)}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) =>
                      <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button onClick={() => { setAddTarget("all"); handleAdd(); }} disabled={!newName.trim()} className="flex-1 text-xs rounded-xl">
                        Tous les repas
                      </Button>
                      <Button onClick={() => { setAddTarget("possible"); handleAdd(); }} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs rounded-xl">
                        Possibles uniquement
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {CATEGORIES.map((cat) =>
          <TabsContent key={cat.value} value={cat.value}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div className="flex flex-col gap-3 sm:gap-4 order-1">
                    <MasterList
                  category={cat}
                  meals={getSortedMaster(cat.value)}
                  foodItems={foodItems}
                  sortMode={masterSortModes[cat.value] || "manual"}
                  onToggleSort={() => toggleMasterSort(cat.value)}
                  collapsed={collapsedSections[`master-${cat.value}`] ?? false}
                  onToggleCollapse={() => toggleSectionCollapse(`master-${cat.value}`)}
                  onMoveToPossible={async (id) => {
                    const result = await moveToPossible.mutateAsync({ mealId: id });
                    if (result?.id) {
                      setMasterSourcePmIds(prev => new Set([...prev, result.id]));
                    }
                  }}
                  onRename={(id, name) => renameMeal.mutate({ id, name })}
                  onDelete={(id) => deleteMeal.mutate(id)}
                  onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                  onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                  onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                  onToggleFavorite={(id) => {
                    const meal = meals.find((m) => m.id === id);
                    if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                  }}
                  onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                  onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                  onReorder={(from, to) => handleReorderMeals(cat.value, from, to)} />

                    <AvailableList
                  category={cat}
                  meals={getMealsByCategory(cat.value)}
                  foodItems={foodItems}
                  allMeals={meals}
                  sortMode={availableSortModes[cat.value] || "manual"}
                  onToggleSort={() => toggleAvailableSort(cat.value)}
                  collapsed={collapsedSections[`available-${cat.value}`] ?? false}
                  onToggleCollapse={() => toggleSectionCollapse(`available-${cat.value}`)}
                  onMoveToPossible={async (mealId) => {
                    const meal = meals.find(m => m.id === mealId);
                    if (meal) {
                      const snapshots = await deductIngredientsFromStock(meal);
                      // Also snapshot name-match deduction
                      const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
                      if (nameMatch && !snapshots.find(s => s.id === nameMatch.id)) {
                        snapshots.push({ ...nameMatch });
                      }
                      const expDate = getEarliestIngredientExpiration(meal, foodItems);
                      const result = await moveToPossible.mutateAsync({ mealId, expiration_date: expDate });
                      if (result?.id) {
                      updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                    }
                    }
                  }}
                  onMovePartialToPossible={async (meal, ratio) => {
                    const partialMeal = buildScaledMealForRatio(meal, ratio);
                    const snapshots = await deductIngredientsFromStock(partialMeal);
                    const expDate = getEarliestIngredientExpiration(meal, foodItems);
                    const result = await addMealToPossibleDirectly.mutateAsync({
                      name: meal.name,
                      category: cat.value,
                      colorSeed: meal.id,
                      calories: partialMeal.calories,
                      grams: partialMeal.grams,
                      ingredients: partialMeal.ingredients,
                      expiration_date: expDate,
                    });
                    if (result?.id) {
                      updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                    }
                  }}
                  onMoveNameMatchToPossible={async (meal, fi) => {
                    const snapshot = [{ ...fi }];
                    await deductNameMatchStock(meal);
                    const result = await moveToPossible.mutateAsync({ mealId: meal.id, expiration_date: fi.expiration_date });
                    if (result?.id) {
                      updateSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
                    }
                  }}
                  onMoveFoodItemToPossible={async (fi) => {
                    const snapshot = [{ ...fi }];
                    if (!fi.is_infinite) {
                      const currentQty = fi.quantity ?? 1;
                      if (currentQty <= 1) {
                        await supabase.from("food_items").delete().eq("id", fi.id);
                      } else {
                        await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", fi.id);
                      }
                      qc.invalidateQueries({ queryKey: ["food_items"] });
                    }
                    const pmResult = await addMealToPossibleDirectly.mutateAsync({ name: fi.name, category: cat.value, colorSeed: fi.id });
                    if (pmResult?.id) {
                      updateSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
                    }
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
                <PossibleList
                category={cat}
                items={getSortedPossible(cat.value)}
                sortMode={sortModes[cat.value] || "manual"}
                onToggleSort={() => toggleSort(cat.value)}
                onRandomPick={() => handleRandomPick(cat.value)}
                onRemove={(id) => {
                  removeFromPossible.mutate(id);
                }}
                onReturnWithoutDeduction={async (id) => {
                  const snapshots = deductionSnapshots[id];
                  if (snapshots && snapshots.length > 0) {
                    await restoreIngredientsToStock({} as Meal, snapshots);
                    updateSnapshots(prev => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    });
                  } else {
                    const allPossible = getPossibleByCategory(cat.value);
                    const pm = allPossible.find(p => p.id === id);
                    if (pm?.meals) {
                      await restoreIngredientsToStock(pm.meals);
                    }
                  }
                  removeFromPossible.mutate(id);
                  setUnParUnSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });
                }}
                onReturnToMaster={(id) => {
                  removeFromPossible.mutate(id);
                  setMasterSourcePmIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }}
                onDelete={(id) => {
                  deletePossibleMeal.mutate(id);
                }}
                onDuplicate={(id) => duplicatePossibleMeal.mutate(id)}
                onUpdateExpiration={(id, d) => updateExpiration.mutate({ id, expiration_date: d })}
                onUpdatePlanning={(id, day, time) => updatePlanning.mutate({ id, day_of_week: day, meal_time: time })}
                onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                onUpdateGrams={async (id, g) => {
                  // id here is meal_id (from PossibleList wiring)
                  // Find the PM by meal_id to check if it's from un-par-un
                  const pm = possibleMeals.find(p => p.meal_id === id);
                  if (pm && unParUnSourcePmIds.has(pm.id)) {
                    if (pm.meals) {
                      const oldGrams = parseQty(pm.meals.grams);
                      const newGrams = parseQty(g);
                      const delta = oldGrams - newGrams; // positive = returning stock
                      if (delta !== 0) {
                        const matchingFi = foodItems.find(fi => strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
                        if (matchingFi) {
                          const perUnit = parseQty(matchingFi.grams);
                          if (delta > 0) {
                            // Add back to stock
                            if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                              const currentTotal = getFoodItemTotalGrams(matchingFi);
                              const newTotal = currentTotal + delta;
                              const fullUnits = Math.floor(newTotal / perUnit);
                              const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
                              await supabase.from("food_items").update({
                                quantity: rem > 0 ? fullUnits + 1 : fullUnits,
                                grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                              } as any).eq("id", matchingFi.id);
                              // If we now have full sealed units (no partial), remove counter
                              if (rem <= 0 && matchingFi.counter_start_date) {
                                await supabase.from("food_items").update({ counter_start_date: null } as any).eq("id", matchingFi.id);
                              }
                            } else {
                              const current = parseQty(matchingFi.grams);
                              await supabase.from("food_items").update({ grams: formatNumeric(current + delta) } as any).eq("id", matchingFi.id);
                            }
                          } else {
                            // Deduct more from stock
                            const toDeduct = -delta;
                            const totalAvail = getFoodItemTotalGrams(matchingFi);
                            const remaining = totalAvail - toDeduct;
                            if (remaining <= 0) {
                              await supabase.from("food_items").delete().eq("id", matchingFi.id);
                            } else if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                              const fullUnits = Math.floor(remaining / perUnit);
                              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                              await supabase.from("food_items").update({
                                quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits,
                                grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                              } as any).eq("id", matchingFi.id);
                            } else {
                              await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", matchingFi.id);
                            }
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
                    await adjustStockForIngredientChange(oldIngredients, newIngredients);
                  }
                  updatePossibleIngredients.mutate({ id: pmId, ingredients_override: newIngredients });
                }}
                onUpdateQuantity={async (id, qty) => {
                  // If from un-par-un, also adjust food_items stock
                  if (unParUnSourcePmIds.has(id)) {
                    const pm = possibleMeals.find(p => p.id === id);
                    if (pm?.meals) {
                      const oldQty = pm.quantity;
                      const delta = oldQty - qty; // positive = returning stock
                      if (delta !== 0) {
                        const matchingFi = foodItems.find(fi => strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
                        if (matchingFi) {
                          if (delta > 0) {
                            // Add back to stock
                            const newStockQty = (matchingFi.quantity ?? 0) + delta;
                            const perUnit = parseQty(matchingFi.grams);
                            const partial = parsePartialQty(matchingFi.grams);
                            // If returning stock makes all units full (no partial), remove counter
                            const hasPartial = partial > 0 && partial < perUnit;
                            const updateData: any = { quantity: newStockQty };
                            if (!hasPartial && matchingFi.counter_start_date) {
                              updateData.counter_start_date = null;
                            }
                            await supabase.from("food_items").update(updateData).eq("id", matchingFi.id);
                          } else {
                            // Deduct more from stock
                            const toDeduct = -delta;
                            const currentQty = matchingFi.quantity ?? 1;
                            if (currentQty <= toDeduct) {
                              await supabase.from("food_items").delete().eq("id", matchingFi.id);
                            } else {
                              await supabase.from("food_items").update({ quantity: currentQty - toDeduct } as any).eq("id", matchingFi.id);
                            }
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
                  if (result?.id && source === "master") {
                    setMasterSourcePmIds(prev => new Set([...prev, result.id]));
                  }
                }}
                highlightedId={highlightedId}
                foodItems={foodItems}
                onAddDirectly={() => openDialog("possible")}
                masterSourcePmIds={masterSourcePmIds}
                unParUnSourcePmIds={unParUnSourcePmIds} />
                </div>

                {cat.value === "plat" && (
                  <div className="order-2 md:order-3 md:col-span-2">
                    <UnParUnSection
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
                            if (remaining <= 0) {
                              await supabase.from("food_items").delete().eq("id", fi.id);
                            } else if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
                              const fullUnits = Math.floor(remaining / perUnit);
                              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                              if (rem > 0) {
                                await supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, rem) } as any).eq("id", fi.id);
                              } else if (fullUnits > 0) {
                                // All remaining units are full/sealed — remove counter
                                await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit), counter_start_date: null } as any).eq("id", fi.id);
                              } else {
                                await supabase.from("food_items").delete().eq("id", fi.id);
                              }
                            } else {
                              await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id);
                            }
                          } else {
                            const deductQty = consumeQty ?? 1;
                            const currentQty = fi.quantity ?? 1;
                            if (currentQty <= deductQty) {
                              await supabase.from("food_items").delete().eq("id", fi.id);
                            } else {
                              await supabase.from("food_items").update({ quantity: currentQty - deductQty } as any).eq("id", fi.id);
                            }
                          }
                          qc.invalidateQueries({ queryKey: ["food_items"] });
                        }
                        const displayGrams = consumeGrams ? String(consumeGrams) : (fi.grams ? String(parseQty(fi.grams)) : null);
                        const displayQty = consumeQty ?? 1;
                        const pmResult = await addMealToPossibleDirectly.mutateAsync({
                          name: fi.name,
                          category: cat.value,
                          colorSeed: fi.id,
                          calories: fi.calories,
                          grams: displayGrams,
                          expiration_date: fi.expiration_date,
                          possible_quantity: displayQty,
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
      </main>
    </div>);
};

// --- Sub-components ---
// Utility functions imported from @/lib/ingredientUtils and @/lib/stockUtils

// ─── UnParUnSection ──────────────────────────────────────────────────────────
function UnParUnSection({ category, foodItems, allMeals, collapsed, onToggleCollapse, onMoveToPossible, sortMode, onToggleSort }: {
  category: { value: string; label: string; emoji: string };
  foodItems: FoodItem[];
  allMeals: Meal[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (fi: FoodItem, consumeQty?: number, consumeGrams?: number) => void;
  sortMode: UnParUnSortMode;
  onToggleSort: () => void;
}) {
  const stockMap = buildStockMap(foodItems);
  const { getPreference, setPreference } = usePreferences();
  const [consumeDialogItem, setConsumeDialogItem] = useState<FoodItem | null>(null);
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeGrams, setConsumeGrams] = useState("");

  const viandeItems = foodItems.filter(fi => fi.food_type === 'viande');
  const feculentItems = foodItems.filter(fi => fi.food_type === 'feculent');

  const globalAvailableMeals = allMeals.filter(meal => {
    if (!meal.ingredients?.trim()) return false;
    const m = getMealMultiple(meal, stockMap);
    return m !== null && m > 0;
  });

  const usedIngredientKeys = new Set<string>();
  for (const meal of globalAvailableMeals) {
    const groups = parseIngredientGroups(meal.ingredients!);
    for (const group of groups) {
      for (const alt of group) {
        const key = findStockKey(stockMap, alt.name);
        if (key) usedIngredientKeys.add(key);
      }
    }
  }
  for (const meal of allMeals) {
    if (meal.ingredients?.trim()) continue;
    if (!meal.is_available) continue; // Skip hidden meals (created from un-par-un transfers)
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        usedIngredientKeys.add(normalizeForMatch(fi.name));
        break;
      }
    }
  }

  const isUnused = (fi: FoodItem) => {
    const fiKey = normalizeForMatch(fi.name);
    for (const usedKey of usedIngredientKeys) {
      if (strictNameMatch(fiKey, usedKey)) return false;
    }
    return true;
  };

  const storedViandeOrder = getPreference<string[]>('unparun_viande_order', []);
  const storedFeculentOrder = getPreference<string[]>('unparun_feculent_order', []);

  const sortItems = (items: FoodItem[], storedOrder: string[]) => {
    if (sortMode === "manual" && storedOrder.length > 0) {
      const orderMap = new Map(storedOrder.map((id, i) => [id, i]));
      return [...items].sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));
    }
    return [...items].sort((a, b) => {
      const aUnused = isUnused(a) ? 0 : 1;
      const bUnused = isUnused(b) ? 0 : 1;
      if (aUnused !== bUnused) return aUnused - bUnused;
      if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
      if (a.expiration_date) return -1;
      if (b.expiration_date) return 1;
      return 0;
    });
  };

  const sortedViande = sortItems(viandeItems, storedViandeOrder);
  const sortedFeculent = sortItems(feculentItems, storedFeculentOrder);
  const totalCount = sortedViande.length + sortedFeculent.length;

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<'viande' | 'feculent' | null>(null);

  const handleReorder = (col: 'viande' | 'feculent', fromIdx: number, toIdx: number) => {
    const items = col === 'viande' ? [...sortedViande] : [...sortedFeculent];
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    const key = col === 'viande' ? 'unparun_viande_order' : 'unparun_feculent_order';
    setPreference.mutate({ key, value: items.map(i => i.id) });
  };

  // Touch DnD for mobile
  const touchDragRef = useRef<{ col: 'viande' | 'feculent'; idx: number; ghost: HTMLElement; startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchActive, setTouchActive] = useState(false);

  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      if (!touchDragRef.current) {
        if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
        return;
      }
      e.preventDefault();
      const t = e.touches[0];
      const s = touchDragRef.current;
      s.ghost.style.top = `${s.origTop + (t.clientY - s.startY)}px`;
      s.ghost.style.left = `${s.origLeft + (t.clientX - s.startX)}px`;
    };
    const onEnd = (e: TouchEvent) => {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      if (!touchDragRef.current) return;
      const t = e.changedTouches[0];
      const s = touchDragRef.current;
      s.ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(t.clientX, t.clientY);
      s.ghost.remove();
      const sCol = s.col;
      const sIdx = s.idx;
      touchDragRef.current = null;
      setTouchActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      const cardEl = el?.closest("[data-upu-idx]");
      if (cardEl) {
        const toIdx = parseInt(cardEl.getAttribute("data-upu-idx") || "-1");
        const toCol = cardEl.getAttribute("data-upu-col") as 'viande' | 'feculent';
        if (toIdx >= 0 && toCol === sCol && toIdx !== sIdx) handleReorder(sCol, sIdx, toIdx);
      }
    };
    const onCancel = () => {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      if (touchDragRef.current) { touchDragRef.current.ghost.remove(); touchDragRef.current = null; }
      setTouchActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: false });
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [sortedViande, sortedFeculent]);

  const handleTouchStart = (e: React.TouchEvent, col: 'viande' | 'feculent', idx: number) => {
    if (sortMode !== "manual") return;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;z-index:9999;pointer-events:none;opacity:0.85;transform:scale(1.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);transition:none;`;
      document.body.appendChild(ghost);
      touchDragRef.current = { col, idx, ghost, startX: touch.clientX, startY: touch.clientY, origTop: rect.top, origLeft: rect.left };
      setTouchActive(true);
    }, 500);
  };

  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  const handleConsumeConfirm = () => {
    if (!consumeDialogItem) return;
    const qtyVal = consumeQty ? parseInt(consumeQty) || undefined : undefined;
    const gramsVal = consumeGrams ? parseFloat(consumeGrams.replace(",", ".")) || undefined : undefined;
    onMoveToPossible(consumeDialogItem, qtyVal, gramsVal);
    setConsumeDialogItem(null);
    setConsumeQty("");
    setConsumeGrams("");
  };

  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";

  const renderFoodCard = (fi: FoodItem, col: 'viande' | 'feculent', idx: number) => {
    const unused = isUnused(fi);
    const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
    const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(new Date().toDateString()) : false;
    const totalG = getFoodItemTotalGrams(fi);
    const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
    const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
    const counterUrgent = counterDays !== null && counterDays >= 3;
    const color = colorFromName(fi.id);

    return (
      <div
        key={fi.id}
        data-upu-idx={idx}
        data-upu-col={col}
        draggable={!isTouchDevice && sortMode === "manual"}
        onDragStart={() => { setDragIdx(idx); setDragCol(col); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragCol === col && dragIdx !== null && dragIdx !== idx) handleReorder(col, dragIdx, idx); setDragIdx(null); setDragCol(null); }}
        onTouchStart={(e) => handleTouchStart(e, col, idx)}
        className={`rounded-2xl px-3 py-2 shadow-md transition-all hover:scale-[1.01] flex items-center justify-between gap-2 ${sortMode === "manual" ? "cursor-grab active:cursor-grabbing" : ""} ${isExpired ? 'ring-2 ring-red-500 shadow-red-500/30' : ''} ${unused ? 'ring-1 ring-yellow-400/40' : ''}`}
        style={{ backgroundColor: color }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white break-words whitespace-normal">{fi.name}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {counterDays !== null && (
              <span className={`text-xs font-black px-2 py-0.5 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/80 text-white animate-pulse' : 'bg-white/25 text-white'}`}>
                <Timer className="h-3 w-3" />{counterDays}j
              </span>
            )}
            {totalG > 0 && <span className="text-xs text-white/80 font-bold">{formatNumeric(totalG)}g</span>}
            {qty && <span className="text-xs text-white/80 font-bold">×{qty}</span>}
            {fi.is_infinite && <span className="text-xs text-white/80 font-bold">∞</span>}
            {expLabel && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${isExpired ? 'bg-red-500/60 text-white' : 'bg-white/20 text-white/90'}`}>
                📅{expLabel}
              </span>
            )}
            {unused && <span className="text-[10px] text-yellow-200 font-bold">⚡inutilisé</span>}
          </div>
        </div>
        <button
          onClick={() => {
            if ((fi.quantity && fi.quantity > 1) || fi.grams) {
              setConsumeDialogItem(fi);
              setConsumeQty(fi.quantity ? "1" : "");
              setConsumeGrams("");
            } else {
              onMoveToPossible(fi);
            }
          }}
          className="shrink-0 h-7 w-7 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-colors"
          title="Ajouter aux possibles"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleCollapse}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(); } }}
          className="flex items-center gap-2 flex-1 cursor-pointer select-none"
        >
          {!collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            🔀 Un par un
          </h2>
          <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onToggleSort(); }} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </div>

      {consumeDialogItem && (
        <div className="mt-3 rounded-2xl bg-muted/50 border p-3">
          <p className="text-sm font-semibold text-foreground mb-2">Consommer « {consumeDialogItem.name} »</p>
          <div className="flex gap-2 items-center mb-2">
            {consumeDialogItem.quantity && consumeDialogItem.quantity > 1 && (
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">Quantité (max {consumeDialogItem.quantity})</label>
                <Input value={consumeQty} onChange={e => setConsumeQty(e.target.value)} placeholder="1" inputMode="numeric" className="h-8 rounded-xl text-sm" autoFocus />
              </div>
            )}
            {consumeDialogItem.grams && (
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">Grammes</label>
                <Input value={consumeGrams} onChange={e => setConsumeGrams(e.target.value)} placeholder={`max ${getFoodItemTotalGrams(consumeDialogItem)}g`} inputMode="decimal" className="h-8 rounded-xl text-sm" autoFocus={!consumeDialogItem.quantity || consumeDialogItem.quantity <= 1} />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConsumeConfirm} className="flex-1 rounded-xl text-xs">Confirmer</Button>
            <Button size="sm" variant="ghost" onClick={() => { setConsumeDialogItem(null); setConsumeQty(""); setConsumeGrams(""); }} className="rounded-xl text-xs">Annuler</Button>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className={`grid grid-cols-2 gap-3 mt-3 ${touchActive ? "touch-none" : ""}`}>
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Drumstick className="h-3 w-3 text-red-400" /> Viande ({sortedViande.length})
            </p>
            {sortedViande.length === 0 && <p className="text-muted-foreground text-xs italic text-center py-4">Aucun</p>}
            {sortedViande.map((fi, idx) => renderFoodCard(fi, 'viande', idx))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Wheat className="h-3 w-3 text-amber-400" /> Féculent ({sortedFeculent.length})
            </p>
            {sortedFeculent.length === 0 && <p className="text-muted-foreground text-xs italic text-center py-4">Aucun</p>}
            {sortedFeculent.map((fi, idx) => renderFoodCard(fi, 'feculent', idx))}
          </div>
        </div>
      )}
    </div>
  );
}

// getCounterIngredientNames imported from @/lib/stockUtils


function AvailableList({ category, meals, foodItems, allMeals, sortMode, onToggleSort, collapsed, onToggleCollapse, onMoveToPossible, onMovePartialToPossible, onMoveFoodItemToPossible, onDeleteFoodItem, onMoveNameMatchToPossible, onRename, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes
}: {category: {value: string;label: string;emoji: string;};meals: Meal[];foodItems: FoodItem[];allMeals: Meal[];sortMode: AvailableSortMode;onToggleSort: () => void;collapsed: boolean;onToggleCollapse: () => void;onMoveToPossible: (id: string) => void;onMovePartialToPossible: (meal: Meal, ratio: number) => void;onMoveFoodItemToPossible: (fi: FoodItem) => void;onDeleteFoodItem: (id: string) => void;onMoveNameMatchToPossible: (meal: Meal, fi: FoodItem) => void;onRename: (id: string, name: string) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onToggleFavorite: (id: string) => void;onUpdateOvenTemp: (id: string, t: string | null) => void;onUpdateOvenMinutes: (id: string, m: string | null) => void;}) {
  const isPlat = category.value === "plat";

  const stockMap = buildStockMap(foodItems);
  const { getPreference: getAvailPref, setPreference: setAvailPref } = usePreferences();
  const storedOrder = getAvailPref<string[]>(`available_order_${category.value}`, []);
  const [avDragIndex, setAvDragIndex] = useState<number | null>(null);

  // 1. Meals realizable via ingredient matching — subtract those already in possible
  const available: {meal: Meal;multiple: number | null;}[] = meals
    .filter(meal => meal.ingredients?.trim())
    .map((meal) => {
      const rawMultiple = getMealMultiple(meal, stockMap);
      if (rawMultiple === null) return { meal, multiple: null };
      return { meal, multiple: rawMultiple };
    })
    .filter(({ multiple }) => multiple !== null && (multiple === Infinity || (multiple as number) > 0));
  const availableMealIds = new Set(available.map(a => a.meal.id));

  // 1b. Partial recipes (50-100%): meals that can be made at reduced proportion
  const partialAvailable: {meal: Meal; ratio: number;}[] = meals
    .filter(meal => meal.ingredients?.trim() && !availableMealIds.has(meal.id))
    .map(meal => {
      const ratio = getMealFractionalRatio(meal, stockMap);
      if (ratio === null) return null;
      return { meal, ratio };
    })
    .filter(Boolean) as {meal: Meal; ratio: number;}[];
  const partialMealIds = new Set(partialAvailable.map(p => p.meal.id));

  // 2. Name-match: stock items that strict-match a "Tous" recipe
  // PRIORITY: if a recipe from "Tous" matches a food-as-meal name, show the RECIPE card
  type NameMatch = {meal: Meal;fi: FoodItem;portionsAvailable: number | null;};
  const nameMatches: NameMatch[] = [];
  const nameMatchedFiIds = new Set<string>();
  const nameMatchedMealIds = new Set<string>();

  for (const meal of meals) {
    if (availableMealIds.has(meal.id) || partialMealIds.has(meal.id)) continue;
    // Skip meals with ingredients (they're handled by ingredient-matching above)
    if (meal.ingredients?.trim()) continue;
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        const mealGrams = parseQty(meal.grams);
        const stockGrams = fi.is_infinite ? Infinity : getFoodItemTotalGrams(fi);
        if (!fi.is_infinite && stockGrams <= 0) continue;
        let portions: number | null = null;
        if (!fi.is_infinite && mealGrams > 0) {
          portions = Math.floor(stockGrams / mealGrams);
          if (portions < 1) continue;
        } else if (!fi.is_infinite) {
          const rawPortions = fi.quantity ?? 1;
          portions = rawPortions;
          if (portions < 1) continue;
        }
        nameMatches.push({ meal, fi, portionsAvailable: fi.is_infinite ? null : portions });
        nameMatchedFiIds.add(fi.id);
        nameMatchedMealIds.add(meal.id);
        break;
      }
    }
  }

  // 3. is_meal food items — only if NOT already covered by a recipe name-match
  // Recipe priority: if a recipe in "Tous" has the same name (case/plural insensitive), skip food-as-meal
  const isMealItems = foodItems.filter((fi) => {
    if (!fi.is_meal) return false;
    if (nameMatchedFiIds.has(fi.id)) return false;
    // Check if any recipe in Tous matches this food item name
    const hasRecipeMatch = meals.some(m => strictNameMatch(m.name, fi.name));
    if (hasRecipeMatch) return false; // Recipe takes priority
    return true;
   });

  // 4. Unused food items: items whose stock is not consumed by any AVAILABLE recipe across ALL categories
  const unusedFoodItems = (() => {
    const nonToujoursItems = foodItems.filter(fi => fi.storage_type !== 'toujours');

    // Build a global list of available meals (feasible, multiple > 0) across ALL categories
    const globalAvailableMeals: Meal[] = allMeals.filter(meal => {
      if (!meal.ingredients?.trim()) return false;
      const m = getMealMultiple(meal, stockMap);
      return m !== null && m > 0;
    });

    // Also consider name-match meals (meals without ingredients that match a food item name)
    const nameMatchMealNames = new Set<string>();
    for (const meal of allMeals) {
      if (meal.ingredients?.trim()) continue;
      for (const fi of foodItems) {
        if (strictNameMatch(meal.name, fi.name)) {
          nameMatchMealNames.add(normalizeForMatch(fi.name));
          break;
        }
      }
    }

    // Build a set of all ingredient names used by available recipes
    const usedIngredientKeys = new Set<string>();
    for (const meal of globalAvailableMeals) {
      const groups = parseIngredientGroups(meal.ingredients!);
      for (const group of groups) {
        // Find which alternative is actually available in stock
        for (const alt of group) {
          const key = findStockKey(stockMap, alt.name);
          if (key !== null) {
            const stock = stockMap.get(key)!;
            if (stock.infinite || stock.grams > 0 || stock.count > 0) {
              usedIngredientKeys.add(key);
            }
          }
        }
      }
    }

    // Also add name-match items as "used"
    for (const nmKey of nameMatchMealNames) {
      usedIngredientKeys.add(nmKey);
    }

    return nonToujoursItems.filter(fi => {
      // is_meal items already appear as cards in "au choix", don't show in unused list
      if (fi.is_meal) return false;
      if (fi.is_infinite) {
        const fiKey = normalizeForMatch(fi.name);
        for (const usedKey of usedIngredientKeys) {
          if (strictNameMatch(fiKey, usedKey)) return false;
        }
        return true;
      }
      const fiKey = normalizeForMatch(fi.name);
      for (const usedKey of usedIngredientKeys) {
        if (strictNameMatch(fiKey, usedKey)) return false;
      }
      return true;
    });
  })();


  // Sort available items based on sortMode
  let sortedAvailable = [...available];
  let sortedNameMatches = [...nameMatches];
  let sortedIsMealItems = [...isMealItems];

  if (sortMode === "calories") {
    const parseCal = (cal: string | null) => parseFloat((cal || "0").replace(/[^0-9.]/g, "")) || 0;
    sortedAvailable.sort((a, b) => parseCal(a.meal.calories) - parseCal(b.meal.calories));
    sortedNameMatches.sort((a, b) => parseCal(a.meal.calories) - parseCal(b.meal.calories));
    sortedIsMealItems.sort((a, b) => parseCal(a.calories) - parseCal(b.calories));
  } else if (sortMode === "expiration") {
    sortedAvailable.sort((a, b) => {
      const aExp = getEarliestIngredientExpiration(a.meal, foodItems);
      const bExp = getEarliestIngredientExpiration(b.meal, foodItems);
      const aCounter = getMaxIngredientCounter(a.meal, foodItems);
      const bCounter = getMaxIngredientCounter(b.meal, foodItems);
      return compareExpirationWithCounter(aExp, bExp, aCounter, bCounter);
    });

    sortedNameMatches.sort((a, b) => {
      const ac = a.fi.counter_start_date ? Math.floor((Date.now() - new Date(a.fi.counter_start_date).getTime()) / 86400000) : null;
      const bc = b.fi.counter_start_date ? Math.floor((Date.now() - new Date(b.fi.counter_start_date).getTime()) / 86400000) : null;
      return compareExpirationWithCounter(a.fi.expiration_date, b.fi.expiration_date, ac, bc);
    });

    sortedIsMealItems.sort((a, b) => {
      const ac = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
      const bc = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
      return compareExpirationWithCounter(a.expiration_date, b.expiration_date, ac, bc);
    });

    // Split is_meal items: those WITHOUT expiration stay prioritized (first), those WITH expiration get interleaved
    const isMealNoDate = sortedIsMealItems.filter(fi => !fi.expiration_date);
    const isMealWithDate = sortedIsMealItems.filter(fi => !!fi.expiration_date);
    sortedIsMealItems = isMealNoDate;
    // We'll store items-with-date for interleaving in render
    (sortedIsMealItems as any).__withDate = isMealWithDate;
  }

  const totalCount = sortedAvailable.length + sortedNameMatches.length + sortedIsMealItems.length + partialAvailable.length;

  const SortIcon = sortMode === "calories" ? Flame : sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "expiration" ? "Péremption" : "Manuel";

  const isToday = (dateStr: string | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 w-full">
        <button onClick={onToggleCollapse} className="flex items-center gap-2 flex-1 text-left">
          {!collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            {category.label} au choix
          </h2>
          <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
        </button>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </div>

      {!collapsed &&
      <div className="flex flex-col gap-2 mt-3">
          {/* Unused food items — ABOVE cards for Plats only */}
          {isPlat && unusedFoodItems.length > 0 && (
            <div className="rounded-2xl bg-muted/30 border border-border/20 p-3 mb-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">🧊 Aliments inutilisés ({unusedFoodItems.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {[...unusedFoodItems].sort((a, b) => {
                  const today = new Date(new Date().toDateString());
                  const aExp = a.expiration_date;
                  const bExp = b.expiration_date;
                  const aCounter = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
                  const bCounter = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
                  // Counter items first
                  if (aCounter !== null && bCounter === null) return -1;
                  if (aCounter === null && bCounter !== null) return 1;
                  if (aCounter !== null && bCounter !== null && aCounter !== bCounter) return bCounter - aCounter;
                  const aExpired = aExp ? new Date(aExp) < today : false;
                  const bExpired = bExp ? new Date(bExp) < today : false;
                  if (aExpired && !bExpired) return -1;
                  if (!aExpired && bExpired) return 1;
                  if (aExp && bExp) return aExp.localeCompare(bExp);
                  if (aExp && !bExp) return -1;
                  if (!aExp && bExp) return 1;
                  return 0;
                }).map(fi => {
                  const totalG = getFoodItemTotalGrams(fi);
                  const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
                  const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(new Date().toDateString()) : false;
                  const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
                  const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
                  const counterUrgent = counterDays !== null && counterDays >= 3;
                  return (
                    <span key={fi.id} className={`text-[11px] px-2.5 py-1.5 rounded-full font-medium transition-colors inline-flex items-center gap-1 ${isExpired ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40' : 'bg-muted/80 text-muted-foreground hover:bg-muted'}`}>
                      {fi.name}
                      {counterDays !== null && (
                        <span className={`text-[9px] font-black px-1 py-0 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/60 text-white' : 'opacity-70'}`}>
                          ⏱{counterDays}j
                        </span>
                      )}
                      {totalG > 0 && <span className="opacity-60">{formatNumeric(totalG)}g</span>}
                      {qty && <span className="opacity-60">×{qty}</span>}
                      {fi.is_infinite && <span className="opacity-60">∞</span>}
                      {expLabel && <span className={`text-[9px] ${isExpired ? 'text-red-300' : 'opacity-50'}`}>📅{expLabel}</span>}
                      <button
                        onClick={() => onDeleteFoodItem(fi.id)}
                        className="ml-0.5 opacity-40 hover:opacity-100 hover:text-destructive transition-opacity"
                        title="Supprimer cet aliment"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* When in expiration sort, build a merged list for interleaving */}
          {(() => {
            const isMealWithDate: FoodItem[] = (sortedIsMealItems as any).__withDate || [];

            // Build unified array for DnD reorder in manual mode
            type UnifiedAvail =
              | { type: 'isMeal'; fi: FoodItem; key: string }
              | { type: 'nm'; nm: typeof sortedNameMatches[0]; nmIdx: number; key: string }
              | { type: 'av'; item: typeof sortedAvailable[0]; key: string }
              | { type: 'partial'; item: typeof partialAvailable[0]; key: string };
            const unifiedItems: UnifiedAvail[] = [
              ...sortedIsMealItems.map(fi => ({ type: 'isMeal' as const, fi, key: `fi-${fi.id}` })),
              ...sortedNameMatches.map((nm, idx) => ({ type: 'nm' as const, nm, nmIdx: idx, key: `nm-${nm.meal.id}` })),
              ...sortedAvailable.map(item => ({ type: 'av' as const, item, key: `av-${item.meal.id}` })),
              ...partialAvailable.map(item => ({ type: 'partial' as const, item, key: `pa-${item.meal.id}` })),
            ];
            if (sortMode === "manual" && storedOrder.length > 0) {
              const orderMap = new Map(storedOrder.map((k: string, i: number) => [k, i]));
              unifiedItems.sort((a, b) => (orderMap.get(a.key) ?? Infinity) - (orderMap.get(b.key) ?? Infinity));
            }
            if (sortMode === "calories") {
              const getCal = (u: typeof unifiedItems[0]): number => {
                if (u.type === 'isMeal') return parseFloat((u.fi.calories || "0").replace(/[^0-9.]/g, "")) || 0;
                if (u.type === 'nm') return parseFloat((u.nm.meal.calories || "0").replace(/[^0-9.]/g, "")) || 0;
                if (u.type === 'av') return parseFloat((u.item.meal.calories || "0").replace(/[^0-9.]/g, "")) || 0;
                if (u.type === 'partial') return parseFloat((u.item.meal.calories || "0").replace(/[^0-9.]/g, "")) || 0;
                return 0;
              };
              unifiedItems.sort((a, b) => getCal(a) - getCal(b));
            }
            const handleAvReorder = (fromIdx: number, toIdx: number) => {
              const reordered = [...unifiedItems];
              const [moved] = reordered.splice(fromIdx, 1);
              reordered.splice(toIdx, 0, moved);
              setAvailPref.mutate({ key: `available_order_${category.value}`, value: reordered.map(u => u.key) });
            };

            // Helper to render an is_meal food item card
            const renderIsMealCard = (fi: FoodItem, unifiedIdx?: number) => {
              const expLabel = formatExpirationLabel(fi.expiration_date);
              const isExpiredFi = fi.expiration_date && new Date(fi.expiration_date) < new Date(new Date().toDateString());
              const expIsTodayFi = isToday(fi.expiration_date);
              const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
                ? `${parseQty(fi.grams) * fi.quantity}g`
                : (fi.is_infinite ? "∞" : fi.grams ?? null);
              const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
              const fakeMeal: Meal = {
                id: `fi-${fi.id}`,
                name: fi.name,
                category: "plat",
                calories: fi.calories,
                grams: displayGrams,
                ingredients: null,
                color: colorFromName(fi.id),
                sort_order: 0,
                created_at: fi.created_at,
                is_available: true,
                is_favorite: false,
                oven_temp: null,
                oven_minutes: null,
              };
              return (
                <div key={fi.id} className="relative">
                  <MealCard meal={fakeMeal}
                    onMoveToPossible={() => onMoveFoodItemToPossible(fi)}
                    onRename={() => {}} onDelete={() => onDeleteFoodItem(fi.id)} onUpdateCalories={() => {}} onUpdateGrams={() => {}} onUpdateIngredients={() => {}}
                    onDragStart={(e) => { e.dataTransfer.setData("mealId", fi.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
                    expirationLabel={expLabel}
                    expirationDate={fi.expiration_date}
                    expirationIsToday={expIsTodayFi}
                    maxIngredientCounter={counterDays} />
                  {fi.quantity && fi.quantity > 1 && (
                    <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                      x{fi.quantity}
                    </div>
                  )}
                </div>);
            };

            // Helper to render a name-match card
            const renderNameMatchCard = (nm: typeof sortedNameMatches[0], idx: number, unifiedIdx?: number) => {
              const { meal, fi, portionsAvailable } = nm;
              const expLabel = formatExpirationLabel(fi.expiration_date);
              const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
              const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
                ? `${parseQty(fi.grams) * fi.quantity}g`
                : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
              const expIsTodayNm = isToday(fi.expiration_date);
              const fakeMeal: Meal = {
                ...meal,
                id: `nm-${meal.id}-${fi.id}`,
                grams: displayGrams,
                color: meal.color,
              };
              return (
                <div key={`nm-${idx}`} className="relative">
                  <MealCard meal={fakeMeal}
                    onMoveToPossible={() => onMoveNameMatchToPossible(meal, fi)}
                    onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                    onToggleFavorite={() => onToggleFavorite(meal.id)}
                    onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                    onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                    onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
                    hideDelete
                    expirationLabel={expLabel}
                    expirationDate={fi.expiration_date}
                    expirationIsToday={expIsTodayNm}
                    maxIngredientCounter={counterDays} />
                  <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                    {fi.is_infinite
                      ? <InfinityIcon className="inline h-[15px] w-[15px]" />
                      : portionsAvailable !== null ? `x${portionsAvailable}` : `x${fi.quantity ?? 1}`}
                  </div>
                </div>);
            };

            // Helper to render an available recipe card
            const renderAvailableCard = (item: typeof sortedAvailable[0], unifiedIdx?: number) => {
              const { meal, multiple } = item;
              const expDate = getEarliestIngredientExpiration(meal, foodItems);
              const expLabel = formatExpirationLabel(expDate);
              const expiringIng = getExpiringIngredientName(meal, foodItems);
              const expiredIngs = getExpiredIngredientNames(meal, foodItems);
              const maxCounter = getMaxIngredientCounter(meal, foodItems);
              const counterIngs = getCounterIngredientNames(meal, foodItems);
              const expIsTodayAv = isToday(expDate);
              return (
                <div key={meal.id} className="relative">
                  <MealCard meal={meal}
                    onMoveToPossible={() => onMoveToPossible(meal.id)}
                    onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                    onToggleFavorite={() => onToggleFavorite(meal.id)}
                    onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                    onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                    onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
                    hideDelete
                    expirationLabel={expLabel}
                    expirationDate={expDate}
                    expirationIsToday={expIsTodayAv}
                    expiringIngredientName={expiringIng}
                    expiredIngredientNames={expiredIngs}
                    counterIngredientNames={counterIngs}
                    maxIngredientCounter={maxCounter} />
                  {multiple !== null &&
                    <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                      x{multiple === Infinity ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : multiple}
                    </div>
                  }
                </div>
              );
            };

            // Helper to render a partial recipe card (50-100%)
            const renderPartialCard = (item: typeof partialAvailable[0], unifiedIdx?: number) => {
              const { meal, ratio } = item;
              const pct = Math.round(ratio * 100);
              const expDate = getEarliestIngredientExpiration(meal, foodItems);
              const expLabel = formatExpirationLabel(expDate);
              const expIsTodayPa = isToday(expDate);
              const maxCounter = getMaxIngredientCounter(meal, foodItems);
              const counterIngs = getCounterIngredientNames(meal, foodItems);
              const partialMeal = buildScaledMealForRatio(meal, ratio);
              return (
                <div key={`partial-${meal.id}`} className="relative">
                  <MealCard meal={partialMeal}
                    onMoveToPossible={() => onMovePartialToPossible(meal, ratio)}
                    onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                    onToggleFavorite={() => onToggleFavorite(meal.id)}
                    onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                    onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                    onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
                    hideDelete
                    expirationLabel={expLabel}
                    expirationDate={expDate}
                    expirationIsToday={expIsTodayPa}
                    counterIngredientNames={counterIngs}
                    maxIngredientCounter={maxCounter} />
                  <div className="absolute top-2 right-8 z-10 bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                    {pct}%
                  </div>
                </div>
              );
            };

            if (sortMode === "expiration") {
              type UnifiedItem = 
                | { type: 'isMeal'; fi: FoodItem; sortDate: string | null; sortCounter: number | null }
                | { type: 'nameMatch'; nm: typeof sortedNameMatches[0]; idx: number; sortDate: string | null; sortCounter: number | null }
                | { type: 'available'; item: typeof sortedAvailable[0]; sortDate: string | null; sortCounter: number | null }
                | { type: 'partial'; item: typeof partialAvailable[0]; sortDate: string | null; sortCounter: number | null };

              const unified: UnifiedItem[] = [];

              // Include ALL is_meal items (both with and without dates)
              for (const fi of [...sortedIsMealItems, ...isMealWithDate]) {
                const counter = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
                unified.push({ type: 'isMeal', fi, sortDate: fi.expiration_date, sortCounter: counter });
              }
              for (let i = 0; i < sortedNameMatches.length; i++) {
                const nm = sortedNameMatches[i];
                const counter = nm.fi.counter_start_date ? Math.floor((Date.now() - new Date(nm.fi.counter_start_date).getTime()) / 86400000) : null;
                unified.push({ type: 'nameMatch', nm, idx: i, sortDate: nm.fi.expiration_date, sortCounter: counter });
              }
              for (const item of sortedAvailable) {
                const expDate = getEarliestIngredientExpiration(item.meal, foodItems);
                const counter = getMaxIngredientCounter(item.meal, foodItems);
                unified.push({ type: 'available', item, sortDate: expDate, sortCounter: counter });
              }
              for (const item of partialAvailable) {
                const expDate = getEarliestIngredientExpiration(item.meal, foodItems);
                const counter = getMaxIngredientCounter(item.meal, foodItems);
                unified.push({ type: 'partial', item, sortDate: expDate, sortCounter: counter });
              }

              unified.sort((a, b) => {
                return compareExpirationWithCounter(a.sortDate, b.sortDate, a.sortCounter, b.sortCounter);
              });

              return (
                <>
                  {unified.map((u, i) => {
                    if (u.type === 'isMeal') return renderIsMealCard(u.fi);
                    if (u.type === 'nameMatch') return renderNameMatchCard(u.nm, u.idx);
                    if (u.type === 'partial') return renderPartialCard(u.item);
                    return renderAvailableCard(u.item);
                  })}
                </>
              );
            }

            // Default: render unified array (supports manual DnD reorder)
            return (
              <>
                {unifiedItems.map((u, idx) => {
                  if (u.type === 'isMeal') return renderIsMealCard(u.fi, idx);
                  if (u.type === 'nm') return renderNameMatchCard(u.nm, u.nmIdx, idx);
                  if (u.type === 'partial') return renderPartialCard(u.item, idx);
                  return renderAvailableCard(u.item, idx);
                })}
              </>
            );
          })()}

          {totalCount === 0 &&
        <p className="text-muted-foreground text-sm text-center py-4 italic">
              Aucun repas réalisable avec les aliments disponibles
            </p>
        }

          {/* Unused food items — BELOW cards for non-Plat categories */}
          {!isPlat && unusedFoodItems.length > 0 && (
            <div className="mt-4 rounded-2xl bg-muted/30 border border-border/20 p-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">🧊 Aliments inutilisés ({unusedFoodItems.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {[...unusedFoodItems].sort((a, b) => {
                  const today = new Date(new Date().toDateString());
                  const aExp = a.expiration_date;
                  const bExp = b.expiration_date;
                  const aCounter = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
                  const bCounter = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
                  if (aCounter !== null && bCounter === null) return -1;
                  if (aCounter === null && bCounter !== null) return 1;
                  if (aCounter !== null && bCounter !== null && aCounter !== bCounter) return bCounter - aCounter;
                  const aExpired = aExp ? new Date(aExp) < today : false;
                  const bExpired = bExp ? new Date(bExp) < today : false;
                  if (aExpired && !bExpired) return -1;
                  if (!aExpired && bExpired) return 1;
                  if (aExp && bExp) return aExp.localeCompare(bExp);
                  if (aExp && !bExp) return -1;
                  if (!aExp && bExp) return 1;
                  return 0;
                }).map(fi => {
                  const totalG = getFoodItemTotalGrams(fi);
                  const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
                  const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(new Date().toDateString()) : false;
                  const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
                  const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
                  const counterUrgent = counterDays !== null && counterDays >= 3;
                  return (
                    <span key={fi.id} className={`text-[11px] px-2.5 py-1.5 rounded-full font-medium transition-colors inline-flex items-center gap-1 ${isExpired ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40' : 'bg-muted/80 text-muted-foreground hover:bg-muted'}`}>
                      {fi.name}
                      {counterDays !== null && (
                        <span className={`text-[9px] font-black px-1 py-0 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/60 text-white' : 'opacity-70'}`}>
                          ⏱{counterDays}j
                        </span>
                      )}
                      {totalG > 0 && <span className="opacity-60">{formatNumeric(totalG)}g</span>}
                      {qty && <span className="opacity-60">×{qty}</span>}
                      {fi.is_infinite && <span className="opacity-60">∞</span>}
                      {expLabel && <span className={`text-[9px] ${isExpired ? 'text-red-300' : 'opacity-50'}`}>📅{expLabel}</span>}
                      <button
                        onClick={() => onDeleteFoodItem(fi.id)}
                        className="ml-0.5 opacity-40 hover:opacity-100 hover:text-destructive transition-opacity"
                        title="Supprimer cet aliment"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      }
    </div>);
}

function MasterList({ category, meals, foodItems, sortMode, onToggleSort, collapsed, onToggleCollapse, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onReorder
}: {category: {value: string;label: string;emoji: string;};meals: Meal[];foodItems: FoodItem[];sortMode: MasterSortMode;onToggleSort: () => void;collapsed: boolean;onToggleCollapse: () => void;onMoveToPossible: (id: string) => void;onRename: (id: string, name: string) => void;onDelete: (id: string) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onToggleFavorite: (id: string) => void;onUpdateOvenTemp: (id: string, t: string | null) => void;onUpdateOvenMinutes: (id: string, m: string | null) => void;onReorder: (fromIndex: number, toIndex: number) => void;}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const stockMap = buildStockMap(foodItems);

  const SortIcon = sortMode === "calories" ? Flame : sortMode === "favorites" ? Star : sortMode === "ingredients" ? List : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "favorites" ? "Favoris" : sortMode === "ingredients" ? "Ingrédients" : "Manuel";

  const filteredMeals = searchQuery.trim()
    ? meals.filter(m => {
        const q = normalizeForMatch(searchQuery);
        if (normalizeForMatch(m.name).includes(q)) return true;
        // Also search in ingredient names
        if (m.ingredients) {
          const groups = m.ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
          for (const group of groups) {
            const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
            for (const alt of alts) {
              if (normalizeForMatch(alt).includes(q)) return true;
            }
          }
        }
        return false;
      })
    : meals;

  return (
    <MealList
      title={`Tous · ${category.label}`}
      emoji="📋"
      count={meals.length}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      headerActions={
      <>
        {!collapsed && (
          <div className="relative mr-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 w-24 sm:w-32 pl-6 text-[10px] rounded-xl"
            />
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className={`h-3 w-3 ${sortMode === "favorites" ? "text-yellow-400 fill-yellow-400" : ""}`} />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </>
      }>

      {!collapsed &&
      <>
          {filteredMeals.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">{searchQuery ? "Aucun résultat" : "Aucun repas"}</p>}
          {filteredMeals.map((meal, index) => {
            const missingIngs = getMissingIngredients(meal, stockMap);
            return (
              <MealCard key={meal.id} meal={meal}
                onMoveToPossible={() => onMoveToPossible(meal.id)}
                onRename={(name) => onRename(meal.id, name)}
                onDelete={() => onDelete(meal.id)}
                onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
                onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
                onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                onToggleFavorite={() => onToggleFavorite(meal.id)}
                onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                missingIngredientNames={missingIngs.size > 0 ? missingIngs : undefined}
                onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "master"); setDragIndex(index); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }} />
            );
          })}
        </>
      }
    </MealList>);
}

function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onReturnWithoutDeduction, onReturnToMaster, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onUpdatePossibleIngredients, onUpdateQuantity, onReorder, onExternalDrop, highlightedId, foodItems, onAddDirectly, masterSourcePmIds, unParUnSourcePmIds
}: {category: {value: string;label: string;emoji: string;};items: PossibleMeal[];sortMode: SortMode;onToggleSort: () => void;onRandomPick: () => void;onRemove: (id: string) => void;onReturnWithoutDeduction: (id: string) => void;onReturnToMaster: (id: string) => void;onDelete: (id: string) => void;onDuplicate: (id: string) => void;onUpdateExpiration: (id: string, d: string | null) => void;onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;onUpdateCounter: (id: string, d: string | null) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;onUpdateQuantity: (id: string, qty: number) => void;onReorder: (fromIndex: number, toIndex: number) => void;onExternalDrop: (mealId: string, source: string) => void;highlightedId: string | null;foodItems: FoodItem[];onAddDirectly: () => void;masterSourcePmIds: Set<string>;unParUnSourcePmIds: Set<string>;}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const sortLabel = sortMode === "manual" ? "Manuel" : sortMode === "expiration" ? "Péremption" : "Planning";
  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;

  return (
    <MealList title={`${category.label} possibles`} emoji={category.emoji} count={items.length} onExternalDrop={onExternalDrop}
    headerActions={<>
        <Button size="sm" variant="ghost" onClick={onAddDirectly} className="h-6 w-6 p-0" title="Ajouter"><Plus className="h-3 w-3" /></Button>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5"><SortIcon className="h-3 w-3" /><span className="hidden sm:inline">{sortLabel}</span></Button>
        <Button size="sm" variant="ghost" onClick={onRandomPick} className="h-6 w-6 p-0"><Dice5 className="h-3.5 w-3.5" /></Button>
      </>}>
      {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">Glisse des repas ici →</p>}
      {items.map((pm, index) =>
      <PossibleMealCard key={pm.id} pm={pm}
      onRemove={() => onRemove(pm.id)}
      onReturnWithoutDeduction={masterSourcePmIds.has(pm.id) ? undefined : () => onReturnWithoutDeduction(pm.id)}
      onReturnWithoutDeductionLabel={unParUnSourcePmIds.has(pm.id) ? "Revenir dans Un par un" : undefined}
      onReturnToMaster={masterSourcePmIds.has(pm.id) ? () => onReturnToMaster(pm.id) : undefined}
      onDelete={() => onDelete(pm.id)}
      onDuplicate={() => onDuplicate(pm.id)}
      onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
      onUpdatePlanning={(day, time) => onUpdatePlanning(pm.id, day, time)}
      onUpdateCounter={(d) => onUpdateCounter(pm.id, d)}
      onUpdateCalories={(cal) => onUpdateCalories(pm.meal_id, cal)}
      onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g)}
      onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
      onUpdatePossibleIngredients={(newIng) => onUpdatePossibleIngredients(pm.id, newIng)}
      onUpdateQuantity={(qty) => onUpdateQuantity(pm.id, qty)}
      onDragStart={(e) => { e.dataTransfer.setData("mealId", pm.meal_id); e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("source", "possible"); setDragIndex(index); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragIndex !== null && dragIndex !== index) {
          onReorder(dragIndex, index);
        }
        setDragIndex(null);
      }}
      isHighlighted={highlightedId === pm.id} />
      )}
    </MealList>);
}

export default Index;
