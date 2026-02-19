import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Lock, Loader2, ChevronDown, ChevronRight, Download, Upload, ShieldAlert, Apple, Sparkles, Infinity as InfinityIcon, Star, Flame } from "lucide-react";
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
import { useShoppingList, type ShoppingItem, type ShoppingGroup } from "@/hooks/useShoppingList";
import { toast } from "@/hooks/use-toast";

const CATEGORIES: {value: MealCategory;label: string;emoji: string;}[] = [
{ value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
{ value: "entree", label: "Entrées", emoji: "🥗" },
{ value: "plat", label: "Plats", emoji: "🍽️" },
{ value: "dessert", label: "Desserts", emoji: "🍰" },
{ value: "bonus", label: "Bonus", emoji: "⭐" }];

// ─── Validation schema ────────────────────────────────────────────────────────
const mealSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)")
});


type SortMode = "manual" | "expiration" | "planning";
type MasterSortMode = "manual" | "calories" | "favorites";
type MainPage = "aliments" | "repas" | "planning" | "courses";

// PIN lock — shown on every page load (no sessionStorage persistence)
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
      const { data, error: fnError } = await supabase.functions.invoke("verify-pin", {
        body: { pin }
      });

      if (fnError) {
        // Distinguish network/cold-start errors from auth errors
        const msg = fnError.message?.includes("PIN") || fnError.message?.includes("requis") ?
        "Code incorrect" :
        "Service indisponible, réessaie";
        showError(msg);
      } else if (!data?.success) {
        showError("Code incorrect");
      } else {
        if (data.access_token && data.refresh_token) {
          await supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token
          });
        }
        onUnlock();
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
        {error && <p className="text-destructive text-sm text-center">{errorMsg}</p>}
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

  const setMainPage = (page: MainPage) => {
    navigate(PAGE_TO_ROUTE[page]);
  };

  // ── Synchronise la session auth réelle (défense en profondeur) ───────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // ── Fin de session au refresh/fermeture de page ──────────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      supabase.auth.signOut();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const unlocked = !!session;

  // ── Fetch blocked IPs count (only when unlocked) ─────────────────────────────
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
    meals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateIngredients, toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals();

  // Shopping list hook for import/export
  const { groups: shoppingGroups, items: shoppingItems } = useShoppingList();

  const [activeCategory, setActiveCategory] = useState<MealCategory>("plat");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<"all" | "possible">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({});
  const [masterSortModes, setMasterSortModes] = useState<Record<string, MasterSortMode>>({});
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);

  // Triple-clic sur l'emoji pour afficher le menu caché
  const handleLogoClick = () => {
    setLogoClickCount((c) => {
      const next = c + 1;
      if (next >= 3) {setShowDevMenu(true);return 0;}
      return next;
    });
  };

  // session === undefined means still loading (don't flash PinLock)
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
        onSuccess: () => {setNewName("");setDialogOpen(false);toast({ title: "Repas ajouté aux possibles 🎉" });}
      });
    } else {
      addMeal.mutate({ name: result.data.name, category: newCategory }, {
        onSuccess: () => {setNewName("");setDialogOpen(false);toast({ title: "Repas ajouté 🎉" });}
      });
    }
  };

  const handleRandomPick = (cat: string) => {
    const pick = getRandomPossible(cat);
    if (!pick) {toast({ title: "Aucun repas possible" });return;}
    setHighlightedId(pick.id);
    toast({ title: `🎲 ${pick.meals.name}` });
    setTimeout(() => setHighlightedId(null), 3000);
  };

  const toggleSort = (cat: string) => {
    setSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next = current === "manual" ? "expiration" : current === "expiration" ? "planning" : "manual";
      return { ...prev, [cat]: next };
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
    setMasterSortModes((prev) => ({ ...prev, [cat]: "manual" }));
  };

  const toggleMasterSort = (cat: string) => {
    setMasterSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next = current === "manual" ? "calories" : current === "calories" ? "favorites" : "manual";
      return { ...prev, [cat]: next };
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
    return items;
  };

  const handleReorderPossible = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getSortedPossible(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderPossibleMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    setSortModes((prev) => ({ ...prev, [cat]: "manual" }));
  };

  // ── Déduire les ingrédients du stock quand on déplace vers "Possible" ────────
  const deductIngredientsFromStock = async (meal: Meal) => {
    if (!meal.ingredients?.trim()) return;
    const ingredients = meal.ingredients.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    const stockMap = buildStockMap(foodItems);

    const updates: Array<{id: string;grams: string | null;delete?: boolean;}> = [];

    for (const ing of ingredients) {
      const { qty: needed, name } = parseIngredientLine(ing);
      if (needed <= 0) continue;

      const key = findStockKey(stockMap, name);
      if (!key) continue;

      const available = stockMap.get(key)!;
      if (available === Infinity) continue; // infini → on ignore

      const matchingItems = foodItems.filter((fi) => {
        const fiKey = normalizeForMatch(fi.name);
        return (fiKey.includes(key) || key.includes(fiKey)) && !fi.is_infinite && parseQty(fi.grams) > 0;
      });

      let toDeduct = needed;
      for (const fi of matchingItems) {
        if (toDeduct <= 0) break;
        const fiQty = parseQty(fi.grams);
        const deduct = Math.min(fiQty, toDeduct);
        const newQty = Math.max(0, fiQty - deduct);
        toDeduct -= deduct;
        updates.push({ id: fi.id, grams: newQty > 0 ? String(Math.round(newQty * 10) / 10) : null, delete: newQty === 0 });
        // Update stockMap for next ingredient
        if (newQty === 0) stockMap.delete(key);else
        stockMap.set(key, newQty);
      }
    }

    // Apply updates
    await Promise.all(updates.map((u) =>
    u.delete ?
    supabase.from("food_items").delete().eq("id", u.id) :
    supabase.from("food_items").update({ grams: u.grams } as any).eq("id", u.id)
    ));
    // Invalidate food_items cache so UI refreshes
    qc.invalidateQueries({ queryKey: ["food_items"] });
  };


  const handleExportMeals = () => {
    const allCats: MealCategory[] = ["plat", "entree", "dessert", "bonus", "petit_dejeuner"];
    const lines = allCats.flatMap((cat) => getMealsByCategory(cat)).map((m) => {
      const parts: string[] = [`cat=${m.category}`];
      if (m.calories) parts.push(`cal=${m.calories}`);
      if (m.grams) parts.push(`grams=${m.grams}`);
      if (m.ingredients) parts.push(`ing=${m.ingredients.replace(/\n/g, ', ')}`);
      return `${m.name} (${parts.join('; ')})`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');a.href = URL.createObjectURL(blob);a.download = 'repas.txt';a.click();
    toast({ title: `✅ ${lines.length} repas exportés` });
    setShowDevMenu(false);
  };

  const handleImportMeals = () => {
    const input = document.createElement('input');
    input.type = 'file';input.accept = '.txt';
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
      for (const line of lineParts) {
        const match = line.match(/^(.+?)\s*\((.+)\)$/);
        const name = match ? match[1].trim() : line;
        const paramsStr = match ? match[2] : '';
        const params: Record<string, string> = {};
        paramsStr.split(';').forEach((p) => {const [k, ...v] = p.split('=');if (k) params[k.trim()] = v.join('=').trim();});
        addMeal.mutate({ name, category: params.cat as MealCategory || 'plat' });
        count++;
      }
      toast({ title: `✅ ${count} repas importés` });
      setShowDevMenu(false);
    };
    input.click();
  };

  // ── Export / Import liste de courses ────────────────────────────────────────
  const handleExportShopping = () => {
    const lines: string[] = [];
    // Groups with their items
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
    // Ungrouped items
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
    const a = document.createElement('a');a.href = URL.createObjectURL(blob);a.download = 'courses.txt';a.click();
    toast({ title: `✅ Liste de courses exportée` });
    setShowDevMenu(false);
  };

  const handleImportShopping = () => {
    const input = document.createElement('input');
    input.type = 'file';input.accept = '.txt';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const isPlainText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
      if (!isPlainText) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      // Import is additive — we don't delete existing items
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      // We'll use supabase directly for bulk insert since we need ordering
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
          const name = match ? match[1].trim() : line;
          const paramsStr = match ? match[2] : '';
          const params: Record<string, string> = {};
          paramsStr.split(';').forEach((p) => {const [k, ...v] = p.split('=');if (k) params[k.trim()] = v.join('=').trim();});
          await (sb as any).from('shopping_items').insert({
            name,
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
      {/* Hidden dev menu — triple-clic sur 🍽️ */}
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
                if (data?.success) {setBlockedCount(0);toast({ title: "✅ Score PIN réinitialisé" });} else
                toast({ title: "❌ Erreur", variant: "destructive" });
              } catch {toast({ title: "❌ Erreur", variant: "destructive" });}
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
          {/* Left: logo + blocked count */}
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
          {/* Center tabs — flex-1 takes all available space, max-width keeps tabs compact on large screens */}
          <div className="flex items-center flex-1 min-w-0 justify-center">
            <div className="bg-muted rounded-full p-0.5 w-full max-w-xs sm:max-w-sm py-[6px] my-0 px-0 flex items-center justify-center gap-[2px]">
              <button onClick={() => setMainPage("aliments")} className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 min-w-0 px-1 sm:px-2 ${mainPage === "aliments" ? "bg-background shadow-sm" : ""}`}>
                <Apple className="h-3 w-3 shrink-0" />
                <span className={`text-[9px] sm:text-[11px] truncate leading-tight ${mainPage === "aliments" ? "text-lime-600 dark:text-lime-400 font-bold" : "text-muted-foreground"}`}>Aliments</span>
              </button>
              <button onClick={() => setMainPage("repas")} className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 min-w-0 px-1 sm:px-2 ${mainPage === "repas" ? "bg-background shadow-sm" : ""}`}>
                <UtensilsCrossed className="h-3 w-3 shrink-0" />
                <span className={`text-[9px] sm:text-[11px] truncate leading-tight ${mainPage === "repas" ? "text-orange-500 font-bold" : "text-muted-foreground"}`}>Repas</span>
              </button>
              <button onClick={() => setMainPage("planning")} className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 min-w-0 px-1 sm:px-2 ${mainPage === "planning" ? "bg-background shadow-sm" : ""}`}>
                <CalendarRange className="h-3 w-3 shrink-0" />
                <span className={`text-[9px] sm:text-[11px] truncate leading-tight ${mainPage === "planning" ? "text-blue-500 font-bold" : "text-muted-foreground"}`}>Planning</span>
              </button>
              <button onClick={() => setMainPage("courses")} className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 min-w-0 px-1 sm:px-2 ${mainPage === "courses" ? "bg-background shadow-sm" : ""}`}>
                <ShoppingCart className="h-3 w-3 shrink-0" />
                <span className={`text-[9px] sm:text-[11px] truncate leading-tight ${mainPage === "courses" ? "text-green-500 font-bold" : "text-muted-foreground"}`}>Courses</span>
              </button>
            </div>
          </div>
          {/* Right: theme toggle */}
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        {mainPage === "aliments" &&
        <>
            <FoodItems />
            <FoodItemsSuggestions foodItems={foodItems} />
          </>
        }
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
                      <Button onClick={() => {setAddTarget("all");handleAdd();}} disabled={!newName.trim()} className="flex-1 text-xs rounded-xl">
                        Tous les repas
                      </Button>
                      <Button onClick={() => {setAddTarget("possible");handleAdd();}} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs rounded-xl">
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
                  sortMode={masterSortModes[cat.value] || "manual"}
                  onToggleSort={() => toggleMasterSort(cat.value)}
                  onMoveToPossible={async (id) => {
                    const meal = meals.find((m) => m.id === id);
                    if (meal) await deductIngredientsFromStock(meal);
                    moveToPossible.mutate(id);
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
                  onReorder={(from, to) => handleReorderMeals(cat.value, from, to)} />

                    <AvailableList
                  category={cat}
                  meals={getMealsByCategory(cat.value)}
                  foodItems={foodItems}
                  onMoveToPossible={async (id) => {
                    const meal = meals.find((m) => m.id === id);
                    if (meal) await deductIngredientsFromStock(meal);
                    moveToPossible.mutate(id);
                  }}
                  onMoveFoodItemToPossible={async (fi) => {
                    await addMealToPossibleDirectly.mutateAsync({ name: fi.name, category: cat.value });
                  }}
                  onDeleteFoodItem={(id) => {deleteFoodItem(id);}} />

                  </div>
                  <PossibleList
                category={cat}
                items={getSortedPossible(cat.value)}
                sortMode={sortModes[cat.value] || "manual"}
                onToggleSort={() => toggleSort(cat.value)}
                onRandomPick={() => handleRandomPick(cat.value)}
                onRemove={(id) => removeFromPossible.mutate(id)}
                onDelete={(id) => deletePossibleMeal.mutate(id)}
                onDuplicate={(id) => duplicatePossibleMeal.mutate(id)}
                onUpdateExpiration={(id, d) => updateExpiration.mutate({ id, expiration_date: d })}
                onUpdatePlanning={(id, day, time) => updatePlanning.mutate({ id, day_of_week: day, meal_time: time })}
                onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                onExternalDrop={(mealId) => moveToPossible.mutate(mealId)}
                highlightedId={highlightedId}
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

// ─── Normalize text for fuzzy ingredient matching ────────────────────────────
function normalizeForMatch(text: string): string {
  return text.
  toLowerCase().
  normalize("NFD").
  replace(/[\u0300-\u036f]/g, "").
  replace(/[^a-z0-9\s]/g, "").
  trim();
}

// Parse a quantity string like "100g" or "200" → number
function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const n = parseFloat(qty.replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Parse an ingredient line like "100g jambon" → { qty: 100, name: "jambon" }
function parseIngredientLine(ing: string): {qty: number;name: string;} {
  const m = ing.match(/^(\d+(?:[.,]\d+)?)\s*(?:[a-zA-Zµ°%]+\.?)?\s+(.*)/i);
  if (m) return { qty: parseFloat(m[1].replace(",", ".")), name: normalizeForMatch(m[2]) };
  return { qty: 0, name: normalizeForMatch(ing) };
}

// Build aggregated stock map: normalized name → total grams (Infinity if any is_infinite)
function buildStockMap(foodItems: FoodItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const fi of foodItems) {
    const key = normalizeForMatch(fi.name);
    const prev = map.get(key) ?? 0;
    if (fi.is_infinite || prev === Infinity) {
      map.set(key, Infinity);
    } else {
      map.set(key, prev + parseQty(fi.grams));
    }
  }
  return map;
}

// Find a stock key that fuzzy-matches the ingredient name
function findStockKey(stockMap: Map<string, number>, name: string): string | null {
  for (const key of stockMap.keys()) {
    if (key.includes(name) || name.includes(key)) return key;
  }
  return null;
}

// Compute how many times a meal can be made given the stock, or null if not possible.
// Returns Infinity if all matched ingredients are infinite.
function getMealMultiple(meal: Meal, stockMap: Map<string, number>): number | null {
  if (!meal.ingredients?.trim()) return null;

  const ingredients = meal.ingredients.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (ingredients.length === 0) return null;

  let multiple = Infinity;

  for (const ing of ingredients) {
    const { qty: needed, name } = parseIngredientLine(ing);
    const key = findStockKey(stockMap, name);
    if (key === null) return null; // ingredient not found → can't make

    const available = stockMap.get(key)!;
    if (available === Infinity) continue; // infinite stock, no constraint

    if (needed <= 0) continue; // no quantity specified — just presence check

    if (available < needed) return null; // not enough
    multiple = Math.min(multiple, Math.floor(available / needed));
  }

  return multiple === Infinity ? Infinity : multiple;
}

// ─── AvailableList — "Au choix" collapsible sub-column ───────────────────────

/** Fuzzy match: same after removing diacritics/case/extra-s, or differ by at most 1 char */
function fuzzyNameMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a).replace(/s$/, "");
  const nb = normalizeForMatch(b).replace(/s$/, "");
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Levenshtein distance ≤ 1
  if (Math.abs(na.length - nb.length) > 1) return false;
  let diff = 0;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  let si = 0,li = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] !== longer[li]) {diff++;if (diff > 1) return false;li++;} else {si++;li++;}
  }
  return true;
}

function AvailableList({ category, meals, foodItems, onMoveToPossible, onMoveFoodItemToPossible, onDeleteFoodItem
}: {category: {value: string;label: string;emoji: string;};meals: Meal[];foodItems: FoodItem[];onMoveToPossible: (id: string) => void;onMoveFoodItemToPossible: (fi: FoodItem) => void;onDeleteFoodItem: (id: string) => void;}) {

  const [open, setOpen] = useState(true);

  // Aggregate stock from all food items
  const stockMap = buildStockMap(foodItems);

  // Meals realizable with current stock (via ingredients)
  const available: {meal: Meal;multiple: number | null;}[] = meals.
  map((meal) => ({ meal, multiple: getMealMultiple(meal, stockMap) })).
  filter(({ multiple }) => multiple !== null);

  // Food items marked as is_meal that appear as standalone cards
  const isMealItems = foodItems.filter((fi) => fi.is_meal);

  /**
   * Food items from stock whose name fuzzy-matches the name of a meal in "Tous"
   * for this category. One stock item can match multiple meals (shown once per meal).
   * We exclude items already surfaced as is_meal.
   */
  type NameMatch = {meal: Meal;fi: FoodItem;portionsAvailable: number | null;};
  const nameMatches: NameMatch[] = [];
  const isMealIds = new Set(isMealItems.map((fi) => fi.id));

  for (const meal of meals) {
    for (const fi of foodItems) {
      if (isMealIds.has(fi.id)) continue; // already shown as is_meal
      if (fuzzyNameMatch(meal.name, fi.name)) {
        // Calculate how many portions possible from stock
        const qty = fi.is_infinite ? null : parseQty(fi.grams);
        nameMatches.push({ meal, fi, portionsAvailable: qty });
      }
    }
  }

  // Also surface food items that no recipe ingredient matches AND is NOT is_meal AND not a name-match
  const nameMatchFiIds = new Set(nameMatches.map((nm) => nm.fi.id));
  const orphanFoodItems = foodItems.filter((fi) => {
    if (fi.is_meal) return false;
    if (nameMatchFiIds.has(fi.id)) return false;
    const fiKey = normalizeForMatch(fi.name);
    const usedByAnyMeal = meals.some((meal) => {
      if (!meal.ingredients) return false;
      const ings = meal.ingredients.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      return ings.some((ing) => {
        const { name } = parseIngredientLine(ing);
        return fiKey.includes(name) || name.includes(fiKey);
      });
    });
    return !usedByAnyMeal;
  });

  const totalCount = available.length + isMealItems.length + nameMatches.length;

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left">

        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-500" />
          {category.label} au choix
        </h2>
        <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
      </button>

      {open &&
      <div className="flex flex-col gap-2 mt-3">
          {/* Recipes available via ingredients matching */}
          {available.map(({ meal, multiple }) =>
        <div key={meal.id} className="relative">
              <MealCard
            meal={meal}
            onMoveToPossible={() => onMoveToPossible(meal.id)}
            onRename={() => {}}
            onDelete={() => {}}
            onUpdateCalories={() => {}}
            onUpdateGrams={() => {}}
            onUpdateIngredients={() => {}}
            onDragStart={(e) => {e.dataTransfer.setData("mealId", meal.id);e.dataTransfer.setData("source", "available");}}
            onDragOver={(e) => {e.preventDefault();e.stopPropagation();}}
            onDrop={(e) => {e.preventDefault();e.stopPropagation();}}
            hideDelete />

              {/* Multiple badge */}
              {multiple !== null &&
          <div className="absolute top-2 right-2 z-10 gap-0.5 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex-row flex items-center justify-center">
                  x{multiple === Infinity ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : multiple}
                </div>
          }
            </div>
        )}

          {/* Name-match: stock items whose name matches a meal in "Tous" for this category */}
          {nameMatches.map(({ meal, fi, portionsAvailable }, idx) => {
          // Build a fake Meal to reuse MealCard, using the meal's color for visual link
          const fakeMeal: Meal = {
            id: `nm-${meal.id}-${fi.id}`,
            name: meal.name,
            category: meal.category,
            calories: meal.calories,
            grams: fi.is_infinite ? "∞" : fi.grams ?? null,
            ingredients: meal.ingredients,
            color: meal.color,
            sort_order: 0,
            created_at: fi.created_at,
            is_available: true,
            is_favorite: meal.is_favorite
          };
          return (
            <div key={`nm-${idx}`} className="relative">
                <MealCard
                meal={fakeMeal}
                onMoveToPossible={() => onMoveToPossible(meal.id)}
                onRename={() => {}}
                onDelete={() => {}}
                onUpdateCalories={() => {}}
                onUpdateGrams={() => {}}
                onUpdateIngredients={() => {}}
                onDragStart={(e) => {e.dataTransfer.setData("mealId", meal.id);e.dataTransfer.setData("source", "available");}}
                onDragOver={(e) => {e.preventDefault();e.stopPropagation();}}
                onDrop={(e) => {e.preventDefault();e.stopPropagation();}}
                hideDelete />

                {/* Quantity badge from stock */}
                <div className="absolute top-2 right-2 z-10 gap-0.5 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex-row flex items-center justify-center">
                  {fi.is_infinite ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : portionsAvailable !== null ? `${portionsAvailable}g` : ""}
                </div>
              </div>);

        })}

          {/* is_meal food items — appear as standalone with full card UI.
          - Delete option wired to onDeleteFoodItem (removes from food_items)
          - No quantity badge (user requested) */}
          {isMealItems.map((fi) => {
          // Build a fake Meal object to reuse MealCard — use same colorFromName for visual consistency
          const fakeMeal: Meal = {
            id: `fi-${fi.id}`,
            name: fi.name,
            category: "plat",
            calories: fi.calories,
            grams: fi.is_infinite ? "∞" : fi.grams ?? null,
            ingredients: null,
            color: colorFromName(fi.name),
            sort_order: 0,
            created_at: fi.created_at,
            is_available: true,
            is_favorite: false
          };
          return (
            <div key={fi.id} className="relative">
              <MealCard
                meal={fakeMeal}
                onMoveToPossible={() => onMoveFoodItemToPossible(fi)}
                onRename={() => {}}
                onDelete={() => onDeleteFoodItem(fi.id)}
                onUpdateCalories={() => {}}
                onUpdateGrams={() => {}}
                onUpdateIngredients={() => {}}
                onDragStart={(e) => {e.dataTransfer.setData("mealId", fi.id);e.dataTransfer.setData("source", "available");}}
                onDragOver={(e) => {e.preventDefault();e.stopPropagation();}}
                onDrop={(e) => {e.preventDefault();e.stopPropagation();}} />

            </div>);
        })}

          {/* Orphan warning */}
          {orphanFoodItems.length > 0 &&
        <div className="mt-1 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2">
              <p className="text-[10px] text-muted-foreground font-semibold mb-1 uppercase tracking-wide">Aliments inutilisés dans les recettes</p>
              <div className="flex flex-wrap gap-1">
                {orphanFoodItems.map((fi) =>
            <span key={fi.id} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                    {fi.name}{fi.grams ? ` ${fi.grams}` : ''}
                  </span>
            )}
              </div>
            </div>
        }

          {totalCount === 0 && orphanFoodItems.length === 0 &&
        <p className="text-muted-foreground text-sm text-center py-4 italic">
              Aucun repas réalisable avec les aliments disponibles
            </p>
        }
        </div>
      }
    </div>);

}

function MasterList({ category, meals, sortMode, onToggleSort, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onReorder
}: {category: {value: string;label: string;emoji: string;};meals: Meal[];sortMode: MasterSortMode;onToggleSort: () => void;onMoveToPossible: (id: string) => void;onRename: (id: string, name: string) => void;onDelete: (id: string) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onToggleFavorite: (id: string) => void;onReorder: (fromIndex: number, toIndex: number) => void;}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const SortIcon = sortMode === "calories" ? Flame : sortMode === "favorites" ? Star : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "favorites" ? "Favoris" : "Manuel";

  return (
    <MealList
      title={`Tous · ${category.label}`}
      emoji="📋"
      count={meals.length}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      headerActions={
      <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className={`h-3 w-3 ${sortMode === "favorites" ? "text-yellow-400 fill-yellow-400" : ""}`} />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      }>

      {!collapsed &&
      <>
          {meals.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">Aucun repas</p>}
          {meals.map((meal, index) =>
        <MealCard key={meal.id} meal={meal}
        onMoveToPossible={() => onMoveToPossible(meal.id)}
        onRename={(name) => onRename(meal.id, name)}
        onDelete={() => onDelete(meal.id)}
        onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
        onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
        onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
        onToggleFavorite={() => onToggleFavorite(meal.id)}
        onDragStart={(e) => {e.dataTransfer.setData("mealId", meal.id);e.dataTransfer.setData("source", "master");setDragIndex(index);}}
        onDragOver={(e) => {e.preventDefault();e.stopPropagation();}}
        onDrop={(e) => {e.preventDefault();e.stopPropagation();if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index);setDragIndex(null);}} />

        )}
        </>
      }
    </MealList>);

}



















function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onReorder, onExternalDrop, highlightedId, onAddDirectly


















}: {category: {value: string;label: string;emoji: string;};items: PossibleMeal[];sortMode: SortMode;onToggleSort: () => void;onRandomPick: () => void;onRemove: (id: string) => void;onDelete: (id: string) => void;onDuplicate: (id: string) => void;onUpdateExpiration: (id: string, d: string | null) => void;onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;onUpdateCounter: (id: string, d: string | null) => void;onUpdateCalories: (id: string, cal: string | null) => void;onUpdateGrams: (id: string, g: string | null) => void;onUpdateIngredients: (id: string, ing: string | null) => void;onReorder: (fromIndex: number, toIndex: number) => void;onExternalDrop: (mealId: string) => void;highlightedId: string | null;onAddDirectly: () => void;}) {
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
      onDelete={() => onDelete(pm.id)}
      onDuplicate={() => onDuplicate(pm.id)}
      onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
      onUpdatePlanning={(day, time) => onUpdatePlanning(pm.id, day, time)}
      onUpdateCounter={(d) => onUpdateCounter(pm.id, d)}
      onUpdateCalories={(cal) => onUpdateCalories(pm.meal_id, cal)}
      onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g)}
      onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
      onDragStart={(e) => {e.dataTransfer.setData("mealId", pm.meal_id);e.dataTransfer.setData("pmId", pm.id);e.dataTransfer.setData("source", "possible");setDragIndex(index);}}
      onDragOver={(e) => {e.preventDefault();e.stopPropagation();}}
      onDrop={(e) => {e.preventDefault();e.stopPropagation();if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index);setDragIndex(null);}}
      isHighlighted={highlightedId === pm.id} />

      )}
    </MealList>);

}

export default Index;