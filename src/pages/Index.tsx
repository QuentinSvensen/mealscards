import { useState, useEffect } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Lock, Loader2 } from "lucide-react";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMeals, type MealCategory, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import { toast } from "@/hooks/use-toast";

const CATEGORIES: { value: MealCategory; label: string; emoji: string }[] = [
  { value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
  { value: "entree", label: "Entrées", emoji: "🥗" },
  { value: "plat", label: "Plats", emoji: "🍽️" },
  { value: "dessert", label: "Desserts", emoji: "🍰" },
  { value: "bonus", label: "Bonus", emoji: "⭐" },
];

type SortMode = "manual" | "expiration" | "planning";
type MainPage = "repas" | "planning" | "courses";

// PIN lock — shown on every page load (no sessionStorage persistence)
function PinLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (pin.length !== 4) return;
    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("verify-pin", {
        body: { pin },
      });
      if (fnError || !data?.success) {
        setError(true);
        setPin("");
        setTimeout(() => setError(false), 1500);
      } else {
        onUnlock();
      }
    } catch {
      setError(true);
      setPin("");
      setTimeout(() => setError(false), 1500);
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
          className={`w-32 text-center text-2xl tracking-[0.5em] font-mono ${error ? 'border-destructive animate-shake' : ''}`}
          autoFocus
          disabled={loading}
        />
        <Button onClick={handleSubmit} disabled={pin.length !== 4 || loading} className="w-32">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrer"}
        </Button>
        {error && <p className="text-destructive text-sm">Code incorrect</p>}
      </div>
    </div>
  );
}

const ROUTE_TO_PAGE: Record<string, MainPage> = {
  "/repas": "repas",
  "/planning": "planning",
  "/courses": "courses",
};

const PAGE_TO_ROUTE: Record<MainPage, string> = {
  repas: "/repas",
  planning: "/planning",
  courses: "/courses",
};

const Index = () => {
  const [unlocked, setUnlocked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const mainPage: MainPage = ROUTE_TO_PAGE[location.pathname] ?? "repas";

  const setMainPage = (page: MainPage) => {
    navigate(PAGE_TO_ROUTE[page]);
  };

  const {
    isLoading,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateIngredients, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible,
  } = useMeals();

  const [activeCategory, setActiveCategory] = useState<MealCategory>("plat");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<"all" | "possible">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({});

  if (!unlocked) return <PinLock onUnlock={() => setUnlocked(true)} />;

  const openDialog = (target: "all" | "possible" = "all") => {
    setNewCategory(activeCategory);
    setAddTarget(target);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    if (addTarget === "possible") {
      addMealToPossibleDirectly.mutate({ name: newName.trim(), category: newCategory }, {
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" }); }
      });
    } else {
      addMeal.mutate({ name: newName.trim(), category: newCategory }, {
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
  };

  const handleReorderPossible = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getSortedPossible(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderPossibleMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    setSortModes((prev) => ({ ...prev, [cat]: "manual" }));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground animate-pulse text-lg">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <h1 className="text-lg sm:text-xl font-extrabold text-foreground shrink-0">🍽️</h1>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-center">
            <div className="flex bg-muted rounded-full p-0.5 gap-0.5">
              <button onClick={() => setMainPage("repas")} className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${mainPage === "repas" ? "bg-background shadow-sm" : ""}`}>
                <UtensilsCrossed className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className={mainPage === "repas" ? "text-orange-500 font-bold" : "text-muted-foreground"}>Repas</span>
              </button>
              <button onClick={() => setMainPage("planning")} className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${mainPage === "planning" ? "bg-background shadow-sm" : ""}`}>
                <CalendarRange className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className={mainPage === "planning" ? "text-blue-500 font-bold" : "text-muted-foreground"}>Planning</span>
              </button>
              <button onClick={() => setMainPage("courses")} className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${mainPage === "courses" ? "bg-background shadow-sm" : ""}`}>
                <ShoppingCart className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className={mainPage === "courses" ? "text-green-500 font-bold" : "text-muted-foreground"}>Courses</span>
              </button>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        {mainPage === "courses" && <ShoppingList />}
        {mainPage === "planning" && <WeeklyPlanning />}
        {mainPage === "repas" && (
          <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MealCategory)}>
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <TabsList className="flex-1 overflow-x-auto">
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c.value} value={c.value} className="text-[10px] sm:text-xs px-2 sm:px-3">
                    {c.emoji} <span className="hidden sm:inline ml-1">{c.label}</span>
                  </TabsTrigger>
                ))}
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
                      onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
                    <Select value={newCategory} onValueChange={(v) => setNewCategory(v as MealCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button onClick={() => { setAddTarget("all"); handleAdd(); }} disabled={!newName.trim()} className="flex-1 text-xs">
                        Tous les repas
                      </Button>
                      <Button onClick={() => { setAddTarget("possible"); handleAdd(); }} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs">
                        Possibles uniquement
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {CATEGORIES.map((cat) => (
              <TabsContent key={cat.value} value={cat.value}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <MasterList
                    category={cat}
                    meals={getMealsByCategory(cat.value)}
                    onMoveToPossible={(id) => moveToPossible.mutate(id)}
                    onRename={(id, name) => renameMeal.mutate({ id, name })}
                    onDelete={(id) => deleteMeal.mutate(id)}
                    onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                    onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                    onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                    onReorder={(from, to) => handleReorderMeals(cat.value, from, to)}
                  />
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
                    onAddDirectly={() => openDialog("possible")}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>
    </div>
  );
};

// --- Sub-components ---

function MasterList({ category, meals, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onReorder }: {
  category: { value: string; label: string; emoji: string };
  meals: Meal[];
  onMoveToPossible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <MealList title={`Tous · ${category.label}`} emoji="📋" count={meals.length}>
      {meals.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">Aucun repas</p>}
      {meals.map((meal, index) => (
        <MealCard key={meal.id} meal={meal}
          onMoveToPossible={() => onMoveToPossible(meal.id)}
          onRename={(name) => onRename(meal.id, name)}
          onDelete={() => onDelete(meal.id)}
          onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
          onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
          onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "master"); setDragIndex(index); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }}
        />
      ))}
    </MealList>
  );
}

function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onReorder, onExternalDrop, highlightedId, onAddDirectly }: {
  category: { value: string; label: string; emoji: string };
  items: PossibleMeal[];
  sortMode: SortMode;
  onToggleSort: () => void;
  onRandomPick: () => void;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateExpiration: (id: string, d: string | null) => void;
  onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;
  onUpdateCounter: (id: string, d: string | null) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string) => void;
  highlightedId: string | null;
  onAddDirectly: () => void;
}) {
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
      {items.map((pm, index) => (
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
          onDragStart={(e) => { e.dataTransfer.setData("mealId", pm.meal_id); e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("source", "possible"); setDragIndex(index); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }}
          isHighlighted={highlightedId === pm.id}
        />
      ))}
    </MealList>
  );
}

export default Index;
