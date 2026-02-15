import { useState } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MealList } from "@/components/MealList";
import { MealCard } from "@/components/MealCard";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMeals, type MealCategory, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import { toast } from "@/hooks/use-toast";

const CATEGORIES: { value: MealCategory; label: string; emoji: string; allEmoji: string }[] = [
  { value: "entree", label: "Entrées", emoji: "🥗", allEmoji: "📋" },
  { value: "plat", label: "Plats", emoji: "🍽️", allEmoji: "📋" },
  { value: "dessert", label: "Desserts", emoji: "🍰", allEmoji: "📋" },
];

type SortMode = "manual" | "expiration" | "planning";

const Index = () => {
  const {
    isLoading,
    addMeal, renameMeal, updateCalories, deleteMeal, reorderMeals,
    moveToPossible, removeFromPossible, updateQuantity, updateExpiration, updatePlanning,
    deletePossibleMeal, reorderPossibleMeals,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible,
  } = useMeals();

  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({
    entree: "manual", plat: "manual", dessert: "manual",
  });

  const handleAdd = () => {
    if (!newName.trim()) return;
    addMeal.mutate({ name: newName.trim(), category: newCategory }, {
      onSuccess: () => {
        setNewName("");
        setDialogOpen(false);
        toast({ title: "Repas ajouté 🎉" });
      },
    });
  };

  const handleRandomPick = (cat: string) => {
    const pick = getRandomPossible(cat);
    if (!pick) {
      toast({ title: "Aucun repas possible dans cette catégorie" });
      return;
    }
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

  // Reorder within list
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
        <p className="text-muted-foreground animate-pulse text-lg">Chargement des repas…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-foreground">🍽️ Mes Repas</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full gap-2">
                  <Plus className="h-4 w-4" /> Ajouter
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nouveau repas</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <Input
                    autoFocus
                    placeholder="Ex: Pâtes carbonara"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  />
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(v as MealCategory)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAdd} disabled={!newName.trim()}>Ajouter</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <Tabs defaultValue="plat">
          <TabsList className="mb-4">
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.value} value={c.value}>
                {c.emoji} {c.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {CATEGORIES.map((cat) => (
            <TabsContent key={cat.value} value={cat.value}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Master list */}
                <MasterList
                  category={cat}
                  meals={getMealsByCategory(cat.value)}
                  onMoveToPossible={(id) => moveToPossible.mutate(id)}
                  onRename={(id, name) => renameMeal.mutate({ id, name })}
                  onDelete={(id) => deleteMeal.mutate(id)}
                  onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                  onReorder={(from, to) => handleReorderMeals(cat.value, from, to)}
                />

                {/* Possible list */}
                <PossibleList
                  category={cat}
                  items={getSortedPossible(cat.value)}
                  sortMode={sortModes[cat.value] || "manual"}
                  onToggleSort={() => toggleSort(cat.value)}
                  onRandomPick={() => handleRandomPick(cat.value)}
                  onRemove={(id) => removeFromPossible.mutate(id)}
                  onDelete={(id) => deletePossibleMeal.mutate(id)}
                  onUpdateQuantity={(id, q) => updateQuantity.mutate({ id, quantity: q })}
                  onUpdateExpiration={(id, d) => updateExpiration.mutate({ id, expiration_date: d })}
                  onUpdatePlanning={(id, day, time) => updatePlanning.mutate({ id, day_of_week: day, meal_time: time })}
                  onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                  onExternalDrop={(mealId) => moveToPossible.mutate(mealId)}
                  highlightedId={highlightedId}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
};

// --- Sub-components ---

function MasterList({ category, meals, onMoveToPossible, onRename, onDelete, onUpdateCalories, onReorder }: {
  category: typeof CATEGORIES[number];
  meals: Meal[];
  onMoveToPossible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <MealList
      title={`Toutes les ${category.label.toLowerCase()}`}
      emoji={category.allEmoji}
      count={meals.length}
    >
      {meals.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8 italic">Aucun repas</p>
      )}
      {meals.map((meal, index) => (
        <MealCard
          key={meal.id}
          meal={meal}
          onMoveToPossible={() => onMoveToPossible(meal.id)}
          onRename={(name) => onRename(meal.id, name)}
          onDelete={() => onDelete(meal.id)}
          onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
          onDragStart={(e) => {
            e.dataTransfer.setData("mealId", meal.id);
            e.dataTransfer.setData("source", `Toutes les ${category.label.toLowerCase()}`);
            setDragIndex(index);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragIndex !== null && dragIndex !== index) {
              onReorder(dragIndex, index);
            }
            setDragIndex(null);
          }}
        />
      ))}
    </MealList>
  );
}

function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onDelete, onUpdateQuantity, onUpdateExpiration, onUpdatePlanning, onReorder, onExternalDrop, highlightedId }: {
  category: typeof CATEGORIES[number];
  items: PossibleMeal[];
  sortMode: SortMode;
  onToggleSort: () => void;
  onRandomPick: () => void;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateQuantity: (id: string, q: number) => void;
  onUpdateExpiration: (id: string, d: string | null) => void;
  onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string) => void;
  highlightedId: string | null;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const sortLabel = sortMode === "manual" ? "Manuel" : sortMode === "expiration" ? "Péremption" : "Planning";
  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;

  return (
    <MealList
      title={`${category.label} possibles`}
      emoji={category.emoji}
      count={items.length}
      onExternalDrop={onExternalDrop}
      headerActions={
        <>
          <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-xs gap-1 h-7">
            <SortIcon className="h-3 w-3" /> {sortLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRandomPick} className="h-7 w-7 p-0">
            <Dice5 className="h-4 w-4" />
          </Button>
        </>
      }
    >
      {items.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8 italic">Glisse des repas ici →</p>
      )}
      {items.map((pm, index) => (
        <PossibleMealCard
          key={pm.id}
          pm={pm}
          onRemove={() => onRemove(pm.id)}
          onDelete={() => onDelete(pm.id)}
          onUpdateQuantity={(q) => onUpdateQuantity(pm.id, q)}
          onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
          onUpdatePlanning={(day, time) => onUpdatePlanning(pm.id, day, time)}
          onDragStart={(e) => {
            e.dataTransfer.setData("mealId", pm.meal_id);
            e.dataTransfer.setData("source", `${category.label} possibles`);
            setDragIndex(index);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragIndex !== null && dragIndex !== index) {
              onReorder(dragIndex, index);
            }
            setDragIndex(null);
          }}
          isHighlighted={highlightedId === pm.id}
        />
      ))}
    </MealList>
  );
}

export default Index;
