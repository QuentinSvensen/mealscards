import { useMemo, useState } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MealList } from "@/components/MealList";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import type { PossibleMeal } from "@/hooks/useMeals";
import { computeIngredientCalories } from "@/lib/ingredientUtils";
import type { FoodItem } from "@/components/FoodItems";

type SortMode = "manual" | "expiration" | "planning";

interface PossibleListProps {
  category: { value: string; label: string; emoji: string };
  items: PossibleMeal[];
  sortMode: SortMode;
  onToggleSort: () => void;
  onRandomPick: () => void;
  onRemove: (id: string) => void;
  onReturnWithoutDeduction: (id: string) => void;
  onReturnToMaster: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateExpiration: (id: string, d: string | null) => void;
  onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;
  onUpdateCounter: (id: string, d: string | null) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string, source: string) => void;
  highlightedId: string | null;
  foodItems: FoodItem[];
  onAddDirectly: () => void;
  masterSourcePmIds: Set<string>;
  unParUnSourcePmIds: Set<string>;
}

export function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onReturnWithoutDeduction, onReturnToMaster, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onUpdatePossibleIngredients, onUpdateQuantity, onReorder, onExternalDrop, highlightedId, foodItems, onAddDirectly, masterSourcePmIds, unParUnSourcePmIds }: PossibleListProps) {
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
    </MealList>
  );
}
