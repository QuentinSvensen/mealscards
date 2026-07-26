/**
 * MasterList — Liste "Tous" affichant l'ensemble des repas d'une catégorie.
 *
 * Affiche tous les repas du catalogue avec recherche, tri multiple
 * (manuel, calories, protéines, note, satiété, favoris, ingrédients) et drag & drop
 * pour réordonner.
 *
 * Chaque carte affiche les ingrédients manquants, les dates de péremption,
 * les compteurs d'ouverture et les macros nutritionnelles.
 */
import { useMemo, useState, type DragEvent } from "react";
import { Flame, Star, List, ArrowUpDown, Search, ArrowUp, ArrowDown, Drumstick, Hash, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealList } from "@/components/MealList";
import { applyContainerReorderDrop } from "@/lib/listReorderDnD";
import { MealCard } from "@/components/MealCard";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import { buildStockMap, buildFoodItemIndex, getMissingIngredients, analyzeMealIngredients, formatExpirationLabel } from "@/lib/stockUtils";
import { normalizeForMatch } from "@/lib/ingredientUtils";
import { isToday } from "date-fns";
import type { MasterSortMode } from "@/lib/mealListSort";

export type { MasterSortMode };

interface MasterListProps {
  category: { value: string; label: string; emoji: string };
  meals: Meal[];
  foodItems: FoodItem[];
  sortMode: MasterSortMode;
  sortAsc: boolean;
  onToggleSort: () => void;
  onToggleSortDirection: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateProtein: (id: string, prot: string | null) => void;
  onUpdateFiber: (id: string, fiber: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateOvenTemp: (id: string, t: string | null) => void;
  onUpdateOvenMinutes: (id: string, m: string | null) => void;
  onUpdateDescription: (id: string, description: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  ingredientMacroAutofillSources?: IngredientMacroAutofillSources;
}

export function MasterList({ category, meals, foodItems, sortMode, sortAsc, onToggleSort, onToggleSortDirection, collapsed, onToggleCollapse, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateProtein, onUpdateFiber, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onUpdateDescription, onReorder, ingredientMacroAutofillSources }: MasterListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** Map de stock mémoïsée pour éviter une nouvelle Map à chaque rendu (casse le memo MealCard). */
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  /** Index aliments mémoïsé pour accélérer analyzeMealIngredients. */
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  const ingredientSuggestions = useMemo(
    () => foodItems.map((item) => item.name).filter(Boolean),
    [foodItems],
  );

  const SortIcon =
    sortMode === "calories" ? Flame
      : sortMode === "protein" ? Drumstick
        : sortMode === "note" ? Hash
          : sortMode === "satiety" ? Scale
            : sortMode === "favorites" ? Star
              : sortMode === "ingredients" ? List
                : ArrowUpDown;
  const sortLabel =
    sortMode === "calories" ? "Calories"
      : sortMode === "protein" ? "Protéines"
        : sortMode === "note" ? "Note"
          : sortMode === "satiety" ? "Satiété"
            : sortMode === "favorites" ? "Favoris"
              : sortMode === "ingredients" ? "Ingrédients"
                : "Manuel";
  const isNumericSort =
    sortMode === "calories" || sortMode === "protein" || sortMode === "note" || sortMode === "satiety";

  const filteredMeals = searchQuery.trim()
    ? meals.filter(m => {
        const q = normalizeForMatch(searchQuery);
        if (normalizeForMatch(m.name).includes(q)) return true;
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

  /**
   * Drop dans le vide de l’encadré Master : réordonne selon la position Y la plus proche.
   */
  const handleContainerReorderDrop = (e: DragEvent): boolean => {
    if (dragIndex === null) return false;
    const cardsRoot = (e.currentTarget as HTMLElement).querySelector("[data-meal-list-cards]");
    const handled = applyContainerReorderDrop(dragIndex, e.clientY, cardsRoot, onReorder);
    setDragIndex(null);
    return handled;
  };

  return (
    <MealList
      title={`Tous · ${category.label}`}
      emoji="📋"
      count={meals.length}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      onInternalReorderDrop={handleContainerReorderDrop}
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
          {isNumericSort && (
            <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-6 w-6 p-0">
              {sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </Button>
          )}
        </>
      }>

      {!collapsed &&
        <>
          {filteredMeals.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">{searchQuery ? "Aucun résultat" : "Aucun repas"}</p>}
          {filteredMeals.map((meal, index) => {
            const missingIngs = getMissingIngredients(meal, stockMap);
            const analysis = analyzeMealIngredients(meal, foodItems, foodItemIndex);
            const expLabel = formatExpirationLabel(analysis.earliestExpiration);
            const expIsTodayM = isToday(analysis.earliestExpiration);

            return (
              <div key={meal.id} data-reorder-idx={index}>
                <MealCard meal={meal} stockMap={stockMap}
                  foodItems={foodItems}
                  foodItemIndex={foodItemIndex}
                  ingredientSuggestions={ingredientSuggestions}
                  ingredientMacroSources={ingredientMacroAutofillSources}
                  onMoveToPossible={() => onMoveToPossible(meal.id)}
                  onRename={(name) => onRename(meal.id, name)}
                  onDelete={() => onDelete(meal.id)}
                  onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
                  onUpdateProtein={(prot) => onUpdateProtein(meal.id, prot)}
                  onUpdateFiber={(fiber) => onUpdateFiber(meal.id, fiber)}
                  onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
                  onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                  onToggleFavorite={() => onToggleFavorite(meal.id)}
                  onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                  onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                  onUpdateDescription={(d) => onUpdateDescription(meal.id, d)}
                  missingIngredientNames={missingIngs.size > 0 ? missingIngs : undefined}
                  expirationLabel={expLabel} expirationDate={analysis.earliestExpiration} expirationIsToday={expIsTodayM}
                  expiredIngredientNames={analysis.expiredIngredientNames} expiringSoonIngredientNames={analysis.expiringSoonIngredientNames}
                  maxIngredientCounter={analysis.maxIngredientCounter} counterIngredientNames={analysis.counterIngredientNames}
                  earliestCounterDate={analysis.earliestCounterDate}
                  onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "master"); setDragIndex(index); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }}
                  hideCounter />
              </div>
            );
          })}
        </>
      }
    </MealList>
  );
}
