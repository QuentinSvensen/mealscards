import { useEffect, useMemo, useRef, useState } from "react";
import { Drumstick, Flame, Plus, Search, Save, Trash2, Wheat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { toast } from "@/hooks/use-toast";
import {
  buildIngredientMacroUpdatePlan,
  collectIngredientMacroEntries,
  createIngredientMacroLibraryItem,
  areIngredientMacroLibrariesEqual,
  persistMissingIngredientMacroEntries,
  removeIngredientMacroLibraryItem,
  upsertIngredientMacroLibraryItem,
  type IngredientMacroEntry,
  type IngredientMacroLibraryItem,
} from "@/domain/macros/ingredientMacroDatabase";

interface MacroIngredientsProps {
  meals: Meal[];
  possibleMeals: PossibleMeal[];
  foodItems: FoodItem[];
  macroLibrary: IngredientMacroLibraryItem[];
  onSaveMacroLibrary: (library: IngredientMacroLibraryItem[]) => void;
  onUpdateMealIngredients: (id: string, ingredients: string) => void;
  onUpdatePossibleIngredients: (id: string, ingredients_override: string | null) => void;
  onUpdateFoodItemMacro: (id: string, updates: { calories: string | null; protein: string | null; fiber: string | null }) => void;
}

interface DraftMacro {
  calories: string;
  protein: string;
  fiber: string;
}

// Renvoie les valeurs actuellement visibles, en tenant compte des edits non sauvegardés.
function getDraftValue(entry: IngredientMacroEntry, drafts: Record<string, DraftMacro>): DraftMacro {
  return drafts[entry.key] ?? { calories: entry.calories, protein: entry.protein, fiber: entry.fiber };
}

// Indique si la ligne a été modifiée par rapport aux macros de référence chargées.
function hasDraftChanged(entry: IngredientMacroEntry, drafts: Record<string, DraftMacro>): boolean {
  const draft = drafts[entry.key];
  if (!draft) return false;
  return draft.calories.trim() !== entry.calories || draft.protein.trim() !== entry.protein || draft.fiber.trim() !== entry.fiber;
}

// Produit une signature stable du référentiel pour éviter de relancer deux fois la même sauvegarde automatique.
function getMacroLibrarySignature(library: IngredientMacroLibraryItem[]): string {
  return JSON.stringify(
    [...library]
      .sort((a, b) => a.key.localeCompare(b.key, "fr"))
      .map((entry) => [entry.key, entry.displayName, entry.calories, entry.protein, entry.fiber ?? ""]),
  );
}

// Affiche le référentiel central des macros d'ingrédients et propage chaque modification aux recettes.
export function MacroIngredients({
  meals,
  possibleMeals,
  foodItems,
  macroLibrary,
  onSaveMacroLibrary,
  onUpdateMealIngredients,
  onUpdatePossibleIngredients,
  onUpdateFoodItemMacro,
}: MacroIngredientsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftMacro>>({});
  const [newIngredientName, setNewIngredientName] = useState("");
  const [newIngredientCalories, setNewIngredientCalories] = useState("");
  const [newIngredientProtein, setNewIngredientProtein] = useState("");
  const [newIngredientFiber, setNewIngredientFiber] = useState("");
  const [manuallyDeletedKeys, setManuallyDeletedKeys] = useState<Set<string>>(() => new Set());
  const pendingAutoPersistSignature = useRef<string | null>(null);

  const entries = useMemo(
    () => collectIngredientMacroEntries(meals, possibleMeals, macroLibrary, foodItems),
    [meals, possibleMeals, macroLibrary, foodItems],
  );

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      entry.displayName.toLowerCase().includes(query),
    );
  }, [entries, searchQuery]);

  useEffect(() => {
    const nextLibrary = persistMissingIngredientMacroEntries(macroLibrary, entries, manuallyDeletedKeys);
    if (areIngredientMacroLibrariesEqual(nextLibrary, macroLibrary)) {
      pendingAutoPersistSignature.current = null;
      return;
    }

    const nextSignature = getMacroLibrarySignature(nextLibrary);
    if (pendingAutoPersistSignature.current === nextSignature) return;

    pendingAutoPersistSignature.current = nextSignature;
    onSaveMacroLibrary(nextLibrary);
  }, [entries, macroLibrary, manuallyDeletedKeys, onSaveMacroLibrary]);

  // Met à jour le brouillon local d'une cellule calories/protéines/fibres.
  const updateDraft = (entry: IngredientMacroEntry, field: keyof DraftMacro, value: string) => {
    setDrafts((current) => {
      const draft = getDraftValue(entry, current);
      return {
        ...current,
        [entry.key]: { ...draft, [field]: value },
      };
    });
  };

  // Ajoute un ingrédient libre au référentiel macros persistant.
  const addIngredient = () => {
    const item = createIngredientMacroLibraryItem(newIngredientName, newIngredientCalories, newIngredientProtein, newIngredientFiber);
    if (!item) {
      toast({ title: "Nom requis", description: "Indique le nom de l'ingrédient à ajouter.", variant: "destructive" });
      return;
    }
    if (!item.calories && !item.protein && !item.fiber) {
      toast({ title: "Macros requises", description: "Ajoute au moins une valeur de macro.", variant: "destructive" });
      return;
    }

    onSaveMacroLibrary(upsertIngredientMacroLibraryItem(macroLibrary, item));
    setNewIngredientName("");
    setNewIngredientCalories("");
    setNewIngredientProtein("");
    setNewIngredientFiber("");
    setSearchQuery(item.displayName);
    toast({ title: "Ingrédient ajouté", description: `${item.displayName} est maintenant dans le référentiel macros.` });
  };

  // Sauvegarde une ligne et applique les nouvelles macros dans tous les ingrédients correspondants.
  const saveEntry = (entry: IngredientMacroEntry) => {
    const draft = getDraftValue(entry, drafts);
    const calories = draft.calories.trim();
    const protein = draft.protein.trim();
    const fiber = draft.fiber.trim();
    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, entry.key, calories, protein, fiber);
    const libraryItem = createIngredientMacroLibraryItem(entry.displayName, calories, protein, fiber);

    for (const update of plan.mealUpdates) {
      onUpdateMealIngredients(update.id, update.ingredients);
    }
    for (const update of plan.possibleUpdates) {
      onUpdatePossibleIngredients(update.id, update.ingredients_override);
    }
    for (const update of plan.foodUpdates) {
      onUpdateFoodItemMacro(update.id, { calories: update.calories, protein: update.protein, fiber: update.fiber });
    }

    setDrafts((current) => {
      const next = { ...current };
      delete next[entry.key];
      return next;
    });

    if (libraryItem) {
      setManuallyDeletedKeys((current) => {
        if (!current.has(libraryItem.key)) return current;
        const next = new Set(current);
        next.delete(libraryItem.key);
        return next;
      });
      onSaveMacroLibrary(upsertIngredientMacroLibraryItem(macroLibrary, libraryItem));
    }

    toast({
      title: "Macros synchronisées",
      description: `${entry.displayName} mis à jour dans ${plan.mealUpdates.length} recette(s)${plan.possibleUpdates.length ? `, ${plan.possibleUpdates.length} possible(s)` : ""}${plan.foodUpdates.length ? ` et ${plan.foodUpdates.length} aliment(s)` : ""}.`,
    });
  };

  // Supprime une ligne du référentiel et efface ses macros dans recettes, possibles et aliments.
  const deleteEntry = (entry: IngredientMacroEntry) => {
    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, entry.key, "", "", "");

    for (const update of plan.mealUpdates) {
      onUpdateMealIngredients(update.id, update.ingredients);
    }
    for (const update of plan.possibleUpdates) {
      onUpdatePossibleIngredients(update.id, update.ingredients_override);
    }
    for (const update of plan.foodUpdates) {
      onUpdateFoodItemMacro(update.id, { calories: update.calories, protein: update.protein, fiber: update.fiber });
    }

    setDrafts((current) => {
      const next = { ...current };
      delete next[entry.key];
      return next;
    });
    setManuallyDeletedKeys((current) => new Set(current).add(entry.key));
    onSaveMacroLibrary(removeIngredientMacroLibraryItem(macroLibrary, entry.key));

    toast({
      title: "Ligne supprimée",
      description: `${entry.displayName} retiré du référentiel macros.`,
    });
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-2xl border bg-card/80 p-3 sm:p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-lime-500/15 p-2 text-lime-600 dark:text-lime-400">
            <Wheat className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-extrabold">Macro ingrédients</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Référentiel des calories, protéines et fibres précisées dans les onglets Repas et Aliments. Une sauvegarde propage la macro à toutes les occurrences.
            </p>
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Rechercher un ingrédient..."
            className="rounded-xl pl-9 text-sm"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_90px_90px_90px_auto]">
          <Input
            value={newIngredientName}
            onChange={(event) => setNewIngredientName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            placeholder="Nouvel ingrédient"
            className="rounded-xl text-sm"
          />
          <Input
            value={newIngredientCalories}
            onChange={(event) => setNewIngredientCalories(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Kcal"
            className="rounded-xl text-center text-sm"
          />
          <Input
            value={newIngredientProtein}
            onChange={(event) => setNewIngredientProtein(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Prot."
            className="rounded-xl text-center text-sm"
          />
          <Input
            value={newIngredientFiber}
            onChange={(event) => setNewIngredientFiber(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Fib."
            className="rounded-xl text-center text-sm"
          />
          <Button onClick={addIngredient} className="rounded-xl gap-1 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        </div>
      </div>

      <div className="mx-auto w-fit max-w-full overflow-x-auto rounded-2xl border bg-card shadow-sm">
        <div className="grid grid-cols-[180px_88px_72px_72px_72px_64px_48px] sm:grid-cols-[260px_128px_96px_96px_96px_80px_56px] gap-0 border-b bg-muted/70 px-2 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span>Ingrédient</span>
          <span className="text-center">Base</span>
          <span className="flex items-center justify-center gap-1"><Flame className="h-3 w-3 text-orange-500" />Kcal</span>
          <span className="flex items-center justify-center gap-1"><Drumstick className="h-3 w-3 text-blue-500" />Prot.</span>
          <span className="flex items-center justify-center gap-1"><Wheat className="h-3 w-3 text-emerald-500" />Fib.</span>
          <span className="text-center">Save</span>
          <span className="text-center">Suppr.</span>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Aucun ingrédient avec macros trouvées. Ajoute des valeurs dans les ingrédients d'une recette, ex. <span className="font-mono">100g Dinde{"{105}"} [24]</span>.
          </div>
        ) : (
          <div className="divide-y">
            {filteredEntries.map((entry) => {
              const draft = getDraftValue(entry, drafts);
              const changed = hasDraftChanged(entry, drafts);
              const hasConflict = entry.hasConflictingCalories || entry.hasConflictingProtein || entry.hasConflictingFiber;
              const hasMissingMacro = !draft.calories.trim() || !draft.protein.trim() || !draft.fiber.trim();

              return (
                <div key={entry.key} className="grid grid-cols-[180px_88px_72px_72px_72px_64px_48px] sm:grid-cols-[260px_128px_96px_96px_96px_80px_56px] items-center gap-0 px-2 py-2">
                  <div className="min-w-0 pr-2">
                    <p className={`truncate text-xs sm:text-sm font-semibold ${hasMissingMacro ? "text-red-500" : ""}`}>{entry.displayName}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {entry.recipeCount} recette(s){entry.foodCount ? ` · ${entry.foodCount} aliment(s)` : ""}{entry.overrideCount ? ` · ${entry.overrideCount} possible(s)` : ""}
                    </p>
                    {hasConflict && (
                      <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        Valeurs différentes détectées
                      </p>
                    )}
                  </div>

                  <span className="mx-auto max-w-[80px] truncate rounded-full bg-muted px-2 py-1 text-center text-[10px] font-semibold text-muted-foreground sm:max-w-[120px]">
                    {entry.basisLabel || "-"}
                  </span>

                  <Input
                    value={draft.calories}
                    onChange={(event) => updateDraft(entry, "calories", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <Input
                    value={draft.protein}
                    onChange={(event) => updateDraft(entry, "protein", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <Input
                    value={draft.fiber}
                    onChange={(event) => updateDraft(entry, "fiber", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant={changed ? "default" : "secondary"}
                      disabled={!changed}
                      onClick={() => saveEntry(entry)}
                      className="h-8 w-10 sm:w-auto rounded-xl px-2 text-xs"
                    >
                      <Save className="h-3.5 w-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">OK</span>
                    </Button>
                  </div>

                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteEntry(entry)}
                      className="h-8 w-8 rounded-xl p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title={`Supprimer ${entry.displayName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
