import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Lock, Loader2, ChevronDown, ChevronRight, Download, Upload, ShieldAlert, Apple, Sparkles, Infinity as InfinityIcon, Star, List, Flame, Search } from "lucide-react";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMeals, type MealCategory, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import { useShoppingList } from "@/hooks/useShoppingList";
import { usePreferences } from "@/hooks/usePreferences";
import { toast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

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
        showError("Trop de tentatives, réessaie dans 15 min");
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

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients,
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

  const [activeCategory, setActiveCategory] = useState<MealCategory>("plat");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<"all" | "possible">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [deductionSnapshots, setDeductionSnapshots] = useState<Record<string, FoodItem[]>>({});

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

  // Available sort modes (session-only, default to manual)
  const [availableSortModes, setAvailableSortModes] = useState<Record<string, AvailableSortMode>>({});

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

  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);

  // Session-only collapse state for categories (reset on reconnect)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ 'master-plat': true });
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
      return { ...prev, [cat]: next };
    });
  };

  /** Deduct ingredients from stock and return pre-deduction snapshots for exact rollback */
  const deductIngredientsFromStock = async (meal: Meal): Promise<FoodItem[]> => {
    if (!meal.ingredients?.trim()) return [];

    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);

    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean }>();

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

      const matchingItems = foodItems.filter((fi) => strictNameMatch(fi.name, key) && !fi.is_infinite);

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
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: Math.max(1, fullUnits + 1),
                grams: encodeStoredGrams(perUnit, remainder),
              });
            } else if (fullUnits > 0) {
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: fullUnits,
                grams: formatNumeric(perUnit),
              });
            } else {
              updatesById.set(fi.id, { id: fi.id, delete: true });
            }
          } else {
            updatesById.set(fi.id, { id: fi.id, grams: formatNumeric(remaining) });
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
      const matchingItems = foodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite);
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

      const matchingItems = foodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite);
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

          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        <div className={mainPage === "aliments" ? "" : "hidden"}>
          <FoodItems />
          <FoodItemsSuggestions foodItems={foodItems} existingMealNames={meals.filter(m => m.is_available).map(m => m.name)} />
        </div>
        {mainPage === "courses" && <ShoppingList />}
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
                  <div className="flex flex-col gap-3 sm:gap-4">
                    <MasterList
                  category={cat}
                  meals={getSortedMaster(cat.value)}
                  foodItems={foodItems}
                  sortMode={masterSortModes[cat.value] || "manual"}
                  onToggleSort={() => toggleMasterSort(cat.value)}
                  collapsed={collapsedSections[`master-${cat.value}`] ?? false}
                  onToggleCollapse={() => toggleSectionCollapse(`master-${cat.value}`)}
                  onMoveToPossible={(id) => {
                    moveToPossible.mutate({ mealId: id });
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
                  allMeals={meals}
                  foodItems={foodItems}
                  possibleMeals={possibleMeals}
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
                        setDeductionSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                      }
                    }
                  }}
                  onMoveNameMatchToPossible={async (meal, fi) => {
                    const snapshot = [{ ...fi }];
                    await deductNameMatchStock(meal);
                    const result = await moveToPossible.mutateAsync({ mealId: meal.id, expiration_date: fi.expiration_date });
                    if (result?.id) {
                      setDeductionSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
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
                      setDeductionSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
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
                  <PossibleList
                category={cat}
                items={getSortedPossible(cat.value)}
                sortMode={sortModes[cat.value] || "manual"}
                onToggleSort={() => toggleSort(cat.value)}
                onRandomPick={() => handleRandomPick(cat.value)}
                onRemove={(id) => {
                  // Arrow (consume): just remove, stock already deducted
                  removeFromPossible.mutate(id);
                }}
                onReturnWithoutDeduction={async (id) => {
                  const snapshots = deductionSnapshots[id];
                  if (snapshots && snapshots.length > 0) {
                    // Restore from exact snapshots (re-creates deleted items)
                    await restoreIngredientsToStock({} as Meal, snapshots);
                    setDeductionSnapshots(prev => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    });
                  } else {
                    // Fallback: try to restore from current stock
                    const allPossible = getPossibleByCategory(cat.value);
                    const pm = allPossible.find(p => p.id === id);
                    if (pm?.meals) {
                      await restoreIngredientsToStock(pm.meals);
                    }
                  }
                  removeFromPossible.mutate(id);
                }}
                onDelete={(id) => {
                  // Delete: just remove, stock already deducted
                  deletePossibleMeal.mutate(id);
                }}
                onDuplicate={(id) => duplicatePossibleMeal.mutate(id)}
                onUpdateExpiration={(id, d) => updateExpiration.mutate({ id, expiration_date: d })}
                onUpdatePlanning={(id, day, time) => updatePlanning.mutate({ id, day_of_week: day, meal_time: time })}
                onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                onUpdatePossibleIngredients={async (pmId, newIngredients) => {
                  // Find the possible meal
                  const pm = possibleMeals.find(p => p.id === pmId);
                  if (!pm) return;
                  const oldIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
                  
                  // Calculate difference and adjust stock
                  if (oldIngredients || newIngredients) {
                    await adjustStockForIngredientChange(oldIngredients, newIngredients);
                  }
                  
                  updatePossibleIngredients.mutate({ id: pmId, ingredients_override: newIngredients });
                }}
                onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                onExternalDrop={(mealId) => moveToPossible.mutate({ mealId })}
                highlightedId={highlightedId}
                foodItems={foodItems}
                onAddDirectly={() => openDialog("possible")} />

                </div>
              </TabsContent>
          )}
          </Tabs>
        }
      </main>
    </div>);
};

// --- Sub-components ---

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Strict name matching: handles singular/plural ('s'), case, diacritics, 
 * and at most 1 extra/missing character.
 */
function strictNameMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a).replace(/s$/, "");
  const nb = normalizeForMatch(b).replace(/s$/, "");
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) > 1) return false;
  let diff = 0;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  let si = 0, li = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] !== longer[li]) { diff++; if (diff > 1) return false; li++; } else { si++; li++; }
  }
  return true;
}

function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const [base] = qty.split("|");
  const normalized = base.replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = parseFloat(match[0]);
  return isNaN(n) ? 0 : n;
}

function parsePartialQty(qty: string | null | undefined): number {
  if (!qty || !qty.includes("|")) return 0;
  const [, partial] = qty.split("|");
  const normalized = (partial || "").replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = parseFloat(match[0]);
  return isNaN(n) ? 0 : n;
}

function formatNumeric(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return String(rounded).replace(/\.0$/, "");
}

function encodeStoredGrams(unit: number, partial: number | null): string {
  const unitPart = formatNumeric(unit);
  if (!partial || partial <= 0 || partial >= unit) return unitPart;
  return `${unitPart}|${formatNumeric(partial)}`;
}

function getFoodItemTotalGrams(fi: FoodItem): number {
  const unit = parseQty(fi.grams);
  if (unit <= 0) return 0;
  if (!fi.quantity || fi.quantity < 1) return unit;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < unit) {
    return unit * Math.max(0, fi.quantity - 1) + partial;
  }
  return unit * fi.quantity;
}

function parseIngredientLine(ing: string): {qty: number; count: number; name: string;} {
  const trimmed = ing.trim().replace(/\s+/g, " ");
  const unitRegex = "(?:g|gr|grammes?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) {
    return {
      qty: parseFloat(matchFull[1].replace(",", ".")),
      count: parseFloat(matchFull[2].replace(",", ".")),
      name: normalizeForMatch(matchFull[3])
    };
  }

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) {
    return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]) };
  }

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) {
    return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]) };
  }

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed) };
}

/**
 * Parse ingredient string into OR groups.
 * Format: "100g poulet | 80g dinde, 50g salade"
 * Returns: [[{poulet}, {dinde}], [{salade}]]
 * Each inner array = OR alternatives for a single ingredient slot.
 */
function parseIngredientGroups(raw: string): Array<Array<{qty: number; count: number; name: string}>> {
  if (!raw?.trim()) return [];
  const groups = raw
    .split(/(?:\n|,(?!\d))/)
    .map(s => s.trim())
    .filter(Boolean);
  return groups.map(group => {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    return alts.map(alt => parseIngredientLine(alt));
  });
}

/**
 * For an OR group, pick the first alternative that exists in stock with sufficient quantity.
 * Returns the parsed ingredient line of the best match, or null if none match.
 */
function pickBestAlternative(
  alts: Array<{qty: number; count: number; name: string}>,
  stockMap: Map<string, StockInfo>
): {qty: number; count: number; name: string} | null {
  for (const alt of alts) {
    const key = findStockKey(stockMap, alt.name);
    if (!key) continue;
    const stock = stockMap.get(key)!;
    if (stock.infinite) return alt;
    if (alt.count > 0 && stock.count >= alt.count) return alt;
    if (alt.qty > 0 && stock.grams >= alt.qty) return alt;
    if (alt.count === 0 && alt.qty === 0) return alt; // Name-only match
  }
  return null;
}

interface StockInfo {
  grams: number;
  count: number;
  infinite: boolean;
}

function buildStockMap(foodItems: FoodItem[]): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>();
  for (const fi of foodItems) {
    const key = normalizeForMatch(fi.name);
    const prev = map.get(key) ?? { grams: 0, count: 0, infinite: false };
    if (fi.is_infinite) {
      map.set(key, { ...prev, infinite: true });
    } else {
      const totalGrams = getFoodItemTotalGrams(fi);
      const itemQty = fi.quantity ?? 1;
      map.set(key, {
        grams: prev.grams + totalGrams,
        count: prev.count + itemQty,
        infinite: prev.infinite,
      });
    }
  }
  return map;
}

/** Find stock key using STRICT matching (no substring) */
function findStockKey(stockMap: Map<string, StockInfo>, name: string): string | null {
  for (const key of stockMap.keys()) {
    if (strictNameMatch(key, name)) return key;
  }
  return null;
}

/**
 * Get meal multiple: how many times this recipe can be made.
 * Now supports OR groups — for each group, at least one alternative must be available.
 */
function getMealMultiple(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let multiple = Infinity;

  for (const group of groups) {
    // For each group, find the best alternative and compute how many times it can provide
    let bestGroupMultiple = 0;
    let anyMatch = false;

    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (key === null) continue;
      const stock = stockMap.get(key)!;
      if (stock.infinite) { bestGroupMultiple = Infinity; anyMatch = true; break; }
      let altMultiple = 0;
      if (alt.count > 0) {
        if (stock.count >= alt.count) {
          altMultiple = Math.floor(stock.count / alt.count);
          anyMatch = true;
        }
      } else if (alt.qty > 0) {
        if (stock.grams >= alt.qty) {
          altMultiple = Math.floor(stock.grams / alt.qty);
          anyMatch = true;
        }
      } else {
        // Name-only match (no qty/grams required)
        altMultiple = Infinity;
        anyMatch = true;
      }
      bestGroupMultiple = Math.max(bestGroupMultiple, altMultiple);
    }

    if (!anyMatch) return null;
    multiple = Math.min(multiple, bestGroupMultiple);
  }
  return multiple === Infinity ? Infinity : multiple;
}

/** Find earliest expiration date among food items that match any ingredient of a meal */
function getEarliestIngredientExpiration(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let earliest: string | null = null;

  for (const group of groups) {
    for (const alt of group) {
      for (const fi of foodItems) {
        if (strictNameMatch(fi.name, alt.name) && fi.expiration_date) {
          if (!earliest || fi.expiration_date < earliest) {
            earliest = fi.expiration_date;
          }
        }
      }
    }
  }
  return earliest;
}

/** Get the ingredient name with earliest expiration */
function getExpiringIngredientName(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let earliest: string | null = null;
  let earliestIngName: string | null = null;

  for (const group of groups) {
    for (const alt of group) {
      for (const fi of foodItems) {
        if (strictNameMatch(fi.name, alt.name) && fi.expiration_date) {
          if (!earliest || fi.expiration_date < earliest) {
            earliest = fi.expiration_date;
            earliestIngName = alt.name;
          }
        }
      }
    }
  }
  return earliestIngName;
}

/** Get expired ingredient names for a meal */
function getExpiredIngredientNames(meal: Meal, foodItems: FoodItem[]): Set<string> {
  const expired = new Set<string>();
  if (!meal.ingredients?.trim()) return expired;
  const today = new Date(new Date().toDateString());
  const groups = parseIngredientGroups(meal.ingredients);
  
  for (const group of groups) {
    for (const alt of group) {
      for (const fi of foodItems) {
        if (strictNameMatch(fi.name, alt.name) && fi.expiration_date) {
          if (new Date(fi.expiration_date) < today) {
            expired.add(alt.name);
          }
        }
      }
    }
  }
  return expired;
}

/** Get max counter days among all ingredients of a meal */
function getMaxIngredientCounter(meal: Meal, foodItems: FoodItem[]): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let maxDays: number | null = null;

  for (const group of groups) {
    for (const alt of group) {
      for (const fi of foodItems) {
        if (strictNameMatch(fi.name, alt.name) && fi.counter_start_date) {
          const days = Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000);
          if (maxDays === null || days > maxDays) maxDays = days;
        }
      }
    }
  }
  return maxDays;
}

function formatExpirationLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return format(parseISO(dateStr), 'd MMM', { locale: fr });
  } catch {
    return null;
  }
}

/** Check if a food item is used as an ingredient in any recipe of a given set of meals */
function isFoodUsedInMeals(fi: FoodItem, mealsToCheck: Meal[]): boolean {
  const fiKey = normalizeForMatch(fi.name);
  return mealsToCheck.some(meal => {
    if (!meal.ingredients) return false;
    const groups = parseIngredientGroups(meal.ingredients);
    return groups.some(group =>
      group.some(alt => strictNameMatch(fiKey, alt.name))
    );
  });
}

/** Get missing ingredient names for a meal (not in stock) — OR-aware */
function getMissingIngredients(meal: Meal, stockMap: Map<string, StockInfo>): Set<string> {
  const missing = new Set<string>();
  if (!meal.ingredients?.trim()) return missing;
  const groups = parseIngredientGroups(meal.ingredients);

  for (const group of groups) {
    // For an OR group, if ANY alternative is in stock, the group is satisfied
    let groupSatisfied = false;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (key) {
        const stock = stockMap.get(key)!;
        if (stock.infinite) { groupSatisfied = true; break; }
        if (alt.count > 0 && stock.count >= alt.count) { groupSatisfied = true; break; }
        if (alt.qty > 0 && stock.grams >= alt.qty) { groupSatisfied = true; break; }
        if (alt.count === 0 && alt.qty === 0) { groupSatisfied = true; break; }
      }
    }
    if (!groupSatisfied) {
      // Mark all alternatives in the group as missing
      for (const alt of group) {
        missing.add(alt.name);
      }
    }
  }
  return missing;
}

// ─── AvailableList ────────────────────────────────────────────────────────────
function AvailableList({ category, meals, allMeals, foodItems, possibleMeals, sortMode, onToggleSort, collapsed, onToggleCollapse, onMoveToPossible, onMoveFoodItemToPossible, onDeleteFoodItem, onMoveNameMatchToPossible, onRename, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes
}: {category: {value: string;label: string;emoji: string;};meals: Meal[];allMeals: Meal[];foodItems: FoodItem[];possibleMeals: PossibleMeal[];sortMode: AvailableSortMode;onToggleSort: () => void;collapsed: boolean;onToggleCollapse: () => void;onMoveToPossible: (id: string) => void;onMoveFoodItemToPossible: (fi: FoodItem) => void;onDeleteFoodItem: (id: string) => void;onMoveNameMatchToPossible: (meal: Meal, fi: FoodItem) => void;onRename: (id: string, name: string) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onToggleFavorite: (id: string) => void;onUpdateOvenTemp: (id: string, t: string | null) => void;onUpdateOvenMinutes: (id: string, m: string | null) => void;}) {

  const stockMap = buildStockMap(foodItems);

  // 1. Meals realizable via ingredient matching — subtract those already in possible
  const available: {meal: Meal;multiple: number | null;}[] = meals
    .filter(meal => meal.ingredients?.trim())
    .map((meal) => {
      const rawMultiple = getMealMultiple(meal, stockMap);
      if (rawMultiple === null) return { meal, multiple: null };
      const inPossible = possibleMeals.filter(pm => pm.meal_id === meal.id).length;
      const adjusted = rawMultiple === Infinity ? Infinity : rawMultiple - inPossible;
      return { meal, multiple: adjusted };
    })
    .filter(({ multiple }) => multiple !== null && (multiple === Infinity || (multiple as number) > 0));
  const availableMealIds = new Set(available.map(a => a.meal.id));

  // 2. Name-match: stock items that strict-match a "Tous" recipe
  // PRIORITY: if a recipe from "Tous" matches a food-as-meal name, show the RECIPE card
  type NameMatch = {meal: Meal;fi: FoodItem;portionsAvailable: number | null;};
  const nameMatches: NameMatch[] = [];
  const nameMatchedFiIds = new Set<string>();
  const nameMatchedMealIds = new Set<string>();

  for (const meal of meals) {
    if (availableMealIds.has(meal.id)) continue;
    // Skip meals with ingredients (they're handled by ingredient-matching above)
    if (meal.ingredients?.trim()) continue;
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        const mealGrams = parseQty(meal.grams);
        const stockGrams = fi.is_infinite ? Infinity : getFoodItemTotalGrams(fi);
        if (!fi.is_infinite && stockGrams <= 0) continue;
        const inPossible = possibleMeals.filter(pm => pm.meal_id === meal.id).length;
        let portions: number | null = null;
        if (!fi.is_infinite && mealGrams > 0) {
          portions = Math.floor(stockGrams / mealGrams) - inPossible;
          if (portions < 1) continue;
        } else if (!fi.is_infinite) {
          const rawPortions = fi.quantity ?? 1;
          portions = rawPortions - inPossible;
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

  // Orphan food items: items from Aliments not used in ANY "au choix" recipe in THIS category
  // Exception: "toujours" items never appear; infinite items never appear
  // Cross-category: subtract usage from ALL other categories' realizable "au choix" recipes
  // Only show the surplus that remains
  const allAvailableMeals = allMeals.filter(m => m.is_available);
  const thisCategoryMeals = allAvailableMeals.filter(m => m.category === category.value);

  // Calculate total usage from ALL categories' realizable "au choix" recipes (except this one)
  const otherCatMeals = allAvailableMeals.filter(m => m.category !== category.value);
  const otherCatUsage = new Map<string, { grams: number; count: number }>();
  for (const meal of otherCatMeals) {
    if (!meal.ingredients?.trim()) continue;
    const multiple = getMealMultiple(meal, stockMap);
    if (multiple === null || multiple <= 0) continue;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      const alt = pickBestAlternative(group, stockMap);
      if (!alt) continue;
      const key = findStockKey(stockMap, alt.name);
      if (!key) continue;
      const prev = otherCatUsage.get(key) ?? { grams: 0, count: 0 };
      if (alt.qty > 0) prev.grams += alt.qty;
      if (alt.count > 0) prev.count += alt.count;
      otherCatUsage.set(key, prev);
    }
  }

  // Also calculate usage from THIS category's recipes (to exclude items that ARE used here)
  const thisCatUsage = new Map<string, boolean>();
  for (const meal of thisCategoryMeals) {
    if (!meal.ingredients?.trim()) continue;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        const key = findStockKey(stockMap, alt.name);
        if (key) thisCatUsage.set(key, true);
      }
    }
  }

  const orphanFoodItems: { fi: FoodItem; surplusGrams: number; surplusCount: number }[] = [];
  const processedNames = new Set<string>();
  for (const fi of foodItems) {
    if (fi.is_meal) continue;
    if (fi.storage_type === 'toujours') continue;
    if (fi.is_infinite) continue;

    const fiKey = normalizeForMatch(fi.name);
    if (processedNames.has(fiKey)) continue;

    const stockKey = findStockKey(stockMap, fiKey);
    if (!stockKey) continue;

    // If this ingredient IS used in this category's recipes, skip
    if (thisCatUsage.has(stockKey)) continue;

    const stock = stockMap.get(stockKey);
    if (!stock || stock.infinite) continue;

    processedNames.add(fiKey);

    const otherUsage = otherCatUsage.get(stockKey);
    const usedGrams = otherUsage?.grams ?? 0;
    const usedCount = otherUsage?.count ?? 0;

    const surplusGrams = stock.grams - usedGrams;
    const surplusCount = stock.count - usedCount;

    if (surplusGrams <= 0 && surplusCount <= 0) continue;

    orphanFoodItems.push({ fi, surplusGrams, surplusCount });
  }

  // Already deduplicated by processedNames above, just sort by expiration
  const dedupedOrphans = [...orphanFoodItems].sort((a, b) => {
    if (!a.fi.expiration_date && !b.fi.expiration_date) return 0;
    if (!a.fi.expiration_date) return 1;
    if (!b.fi.expiration_date) return -1;
    return a.fi.expiration_date.localeCompare(b.fi.expiration_date);
  });

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
    const getExpSort = (meal: Meal) => {
      const exp = getEarliestIngredientExpiration(meal, foodItems);
      const counter = getMaxIngredientCounter(meal, foodItems);
      return { exp, counter };
    };
    
    sortedAvailable.sort((a, b) => {
      const sa = getExpSort(a.meal), sb = getExpSort(b.meal);
      const today = new Date(new Date().toDateString());
      const aExpired = sa.exp && new Date(sa.exp) < today;
      const bExpired = sb.exp && new Date(sb.exp) < today;
      if (aExpired && sa.counter !== null && (!bExpired || sb.counter === null)) return -1;
      if (bExpired && sb.counter !== null && (!aExpired || sa.counter === null)) return 1;
      if (aExpired && bExpired && sa.counter !== null && sb.counter !== null) {
        if (sb.counter !== sa.counter) return sb.counter - sa.counter;
        return (sa.exp || "").localeCompare(sb.exp || "");
      }
      if (sa.counter !== null && sb.counter === null) return -1;
      if (sb.counter !== null && sa.counter === null) return 1;
      if (sa.counter !== null && sb.counter !== null) return sb.counter - sa.counter;
      if (!sa.exp && !sb.exp) return 0;
      if (!sa.exp) return 1;
      if (!sb.exp) return -1;
      return sa.exp.localeCompare(sb.exp);
    });

    sortedNameMatches.sort((a, b) => {
      const ae = a.fi.expiration_date;
      const be = b.fi.expiration_date;
      if (!ae && !be) return 0;
      if (!ae) return 1;
      if (!be) return -1;
      return ae.localeCompare(be);
    });

    sortedIsMealItems.sort((a, b) => {
      if (!a.expiration_date && !b.expiration_date) return 0;
      if (!a.expiration_date) return 1;
      if (!b.expiration_date) return -1;
      return a.expiration_date.localeCompare(b.expiration_date);
    });
  }

  const totalCount = sortedAvailable.length + sortedNameMatches.length + sortedIsMealItems.length;

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
          {/* Show is_meal food items FIRST (above recipes) */}
          {sortedIsMealItems.map((fi) => {
            const expLabel = formatExpirationLabel(fi.expiration_date);
            const isExpired = fi.expiration_date && new Date(fi.expiration_date) < new Date(new Date().toDateString());
            const expIsToday = isToday(fi.expiration_date);
            const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
              ? `${parseQty(fi.grams) * fi.quantity}g`
              : (fi.is_infinite ? "∞" : fi.grams ?? null);
            const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
            const fakeMeal: Meal = {
              id: `fi-${fi.id}`,
              name: fi.name,
              category: "plat",
              calories: fi.quantity && fi.quantity > 1 && fi.calories
                ? `${parseFloat(fi.calories.replace(/[^0-9.]/g, '')) * fi.quantity}`
                : fi.calories,
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
                  onDragStart={(e) => { e.dataTransfer.setData("mealId", fi.id); e.dataTransfer.setData("source", "available"); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  expirationLabel={expLabel}
                  expirationDate={fi.expiration_date}
                  expirationIsToday={expIsToday}
                  maxIngredientCounter={counterDays} />
                {fi.quantity && fi.quantity > 1 && (
                  <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                    x{fi.quantity}
                  </div>
                )}
              </div>);
          })}

          {/* Name-matched stock items */}
          {sortedNameMatches.map(({ meal, fi, portionsAvailable }, idx) => {
            const expLabel = formatExpirationLabel(fi.expiration_date);
            const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
            const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
              ? `${parseQty(fi.grams) * fi.quantity}g`
              : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
            const expIsToday = isToday(fi.expiration_date);
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
                  onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  hideDelete
                  expirationLabel={expLabel}
                  expirationDate={fi.expiration_date}
                  expirationIsToday={expIsToday}
                  maxIngredientCounter={counterDays} />
                <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                  {fi.is_infinite
                    ? <InfinityIcon className="inline h-[15px] w-[15px]" />
                    : portionsAvailable !== null ? `x${portionsAvailable}` : `x${fi.quantity ?? 1}`}
                </div>
              </div>);
          })}

          {/* Ingredient-matched recipes */}
          {sortedAvailable.map(({ meal, multiple }) => {
            const expDate = getEarliestIngredientExpiration(meal, foodItems);
            const expLabel = formatExpirationLabel(expDate);
            const expiringIng = getExpiringIngredientName(meal, foodItems);
            const expiredIngs = getExpiredIngredientNames(meal, foodItems);
            const maxCounter = getMaxIngredientCounter(meal, foodItems);
            const expIsToday = isToday(expDate);
            return (
              <div key={meal.id} className="relative">
                <MealCard meal={meal}
                  onMoveToPossible={() => onMoveToPossible(meal.id)}
                  onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                  onToggleFavorite={() => onToggleFavorite(meal.id)}
                  onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                  onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                  onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  hideDelete
                  expirationLabel={expLabel}
                  expirationDate={expDate}
                  expirationIsToday={expIsToday}
                  expiringIngredientName={expiringIng}
                  expiredIngredientNames={expiredIngs}
                  maxIngredientCounter={maxCounter} />
                {multiple !== null &&
                  <div className="absolute top-2 right-8 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
                    x{multiple === Infinity ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : multiple}
                  </div>
                }
              </div>
            );
          })}

          {dedupedOrphans.length > 0 &&
        <div className="mt-1 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2">
              <p className="text-[10px] text-muted-foreground font-semibold mb-1 uppercase tracking-wide">Aliments inutilisés dans les recettes</p>
              <div className="flex flex-wrap gap-1">
              {dedupedOrphans.map(({ fi, surplusGrams }) => {
                const isExpired = fi.expiration_date && new Date(fi.expiration_date) < new Date(new Date().toDateString());
                const displayGrams = surplusGrams > 0 ? `${formatNumeric(surplusGrams)}g` : null;
                return (
                  <span key={fi.id} className={`text-[10px] px-2 py-0.5 rounded-full ${isExpired ? 'bg-red-500/20 text-red-600 dark:text-red-400 ring-1 ring-red-500/50 font-semibold' : 'bg-muted text-muted-foreground'}`}>
                    {fi.name}{displayGrams ? ` ${displayGrams}` : ''}{fi.quantity && fi.quantity > 1 ? ` x${fi.quantity}` : ''}
                  </span>
                );
              })}
              </div>
            </div>
        }

          {totalCount === 0 && dedupedOrphans.length === 0 &&
        <p className="text-muted-foreground text-sm text-center py-4 italic">
              Aucun repas réalisable avec les aliments disponibles
            </p>
        }
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
    ? meals.filter(m => normalizeForMatch(m.name).includes(normalizeForMatch(searchQuery)))
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
        <div className="relative mr-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 w-24 sm:w-32 pl-6 text-[10px] rounded-lg"
          />
        </div>
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

function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onReturnWithoutDeduction, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onUpdatePossibleIngredients, onReorder, onExternalDrop, highlightedId, foodItems, onAddDirectly
}: {category: {value: string;label: string;emoji: string;};items: PossibleMeal[];sortMode: SortMode;onToggleSort: () => void;onRandomPick: () => void;onRemove: (id: string) => void;onReturnWithoutDeduction: (id: string) => void;onDelete: (id: string) => void;onDuplicate: (id: string) => void;onUpdateExpiration: (id: string, d: string | null) => void;onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;onUpdateCounter: (id: string, d: string | null) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;onReorder: (fromIndex: number, toIndex: number) => void;onExternalDrop: (mealId: string) => void;highlightedId: string | null;foodItems: FoodItem[];onAddDirectly: () => void;}) {
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
      onReturnWithoutDeduction={() => onReturnWithoutDeduction(pm.id)}
      onDelete={() => onDelete(pm.id)}
      onDuplicate={() => onDuplicate(pm.id)}
      onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
      onUpdatePlanning={(day, time) => onUpdatePlanning(pm.id, day, time)}
      onUpdateCounter={(d) => onUpdateCounter(pm.id, d)}
      onUpdateCalories={(cal) => onUpdateCalories(pm.meal_id, cal)}
      onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g)}
      onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
      onUpdatePossibleIngredients={(newIng) => onUpdatePossibleIngredients(pm.id, newIng)}
      onDragStart={(e) => { e.dataTransfer.setData("mealId", pm.meal_id); e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("source", "possible"); setDragIndex(index); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }}
      isHighlighted={highlightedId === pm.id} />
      )}
    </MealList>);
}

export default Index;
