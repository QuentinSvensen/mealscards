/**
 * PossibleList — Liste des repas "possibles" (à préparer prochainement).
 *
 * Affiche les cartes de repas planifiés avec tri (manuel, péremption, planning),
 * ajout direct, tirage aléatoire, et drag & drop interne + externe.
 *
 * Chaque carte est enveloppée dans MemoizedPossibleMealCard pour la performance.
 * Un séparateur "Aujourd'hui" s'affiche quand un repas est planifié pour aujourd'hui.
 *
 * Le popup de détails (double-clic) affiche les macros, ingrédients, cuisson, compteur.
 *
 * Popup détails : mêmes ingrédients structurés que partout ailleurs (StructuredIngredientInline).
 */
import React, { useMemo, useState } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays, CalendarClock, Flame, Weight, Timer, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MealList } from "@/components/MealList";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import type { PossibleMeal } from "@/hooks/useMeals";
import { computeIngredientCalories, computeIngredientProtein, getMealColor, ingredientsForPossibleCardDisplay } from "@/lib/ingredientUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { buildStockMap, analyzeMealIngredients, getDisplayedPMCalories, buildFoodItemIndex, resolveCounterStartForPossibleBadge } from "@/lib/stockUtils";
import type { StockInfo } from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { getAdaptedCounterDays, getCounterDaysBadgeTooltip } from "@/lib/ingredientUtils";
import { fr } from "date-fns/locale";

const DAY_LABELS_FULL: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

const TIME_LABELS: Record<string, string> = {
  matin: 'Petit déj', midi: 'Midi', soir: 'Soir',
};

/** Retourne l'emoji représentant une catégorie de repas (en-têtes, popups). */
function getCategoryEmoji(cat?: string) {
  if (cat === "petit_dejeuner") return "🥐";
  if (cat === "plat") return "🍲";
  if (cat === "dessert") return "🍰";
  if (cat === "collation") return "🥨";
  return "🍴";
}

const MemoizedPossibleMealCard = React.memo(
  PossibleMealCard,
  (prevProps: any, nextProps: any) => {
    return (
      prevProps.pm === nextProps.pm &&
      prevProps.realtimeCounterStartDate === nextProps.realtimeCounterStartDate &&
      prevProps.isHighlighted === nextProps.isHighlighted &&
      prevProps.stockMap === nextProps.stockMap &&
      prevProps.foodItems === nextProps.foodItems &&
      prevProps.onReturnWithoutDeductionLabel === nextProps.onReturnWithoutDeductionLabel &&
      !!prevProps.onReturnToMaster === !!nextProps.onReturnToMaster &&
      !!prevProps.onReturnWithoutDeduction === !!nextProps.onReturnWithoutDeduction &&
      !!prevProps.onUpdateQuantity === !!nextProps.onUpdateQuantity &&
      (prevProps.expiredIngredientNames?.size ?? 0) === (nextProps.expiredIngredientNames?.size ?? 0) &&
      (prevProps.expiringSoonIngredientNames?.size ?? 0) === (nextProps.expiringSoonIngredientNames?.size ?? 0)
    );
  }
);

type SortMode = "manual" | "expiration" | "planning";

interface PossibleListProps {
  category: { value: string; label: string; emoji: string };
  items: PossibleMeal[];
  sortMode: SortMode;
  stockMap: Map<string, StockInfo>;
  onToggleSort: () => void;
  onRandomPick: () => void;
  onRemove: (id: string) => void;
  onReturnWithoutDeduction: (id: string) => void;
  onReturnToMaster: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateExpiration: (id: string, d: string | null) => void;
  onUpdatePlanning: (id: string, day: string | null, time: string | null, counter_start_date?: string | null) => void;
  onUpdateCounter: (id: string, d: string | null) => void;
  onUpdateCalories: (id: string, cal: string | null, pmId?: string) => void;
  onUpdateProtein?: (id: string, pro: string | null, pmId?: string) => void;
  onUpdateGrams: (id: string, g: string | null, pmId?: string) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;
  onUpdateOvenTemp?: (id: string, temp: string | null) => void;
  onUpdateOvenMinutes?: (id: string, minutes: string | null) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onSplitQuantity?: (id: string, ratio: number, baseIngredients: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string, source: string, pmId?: string | null) => void;
  highlightedId: string | null;
  foodItems: FoodItem[];
  onAddDirectly: () => void;
  masterSourcePmIds: Set<string>;
  unParUnSourcePmIds: Set<string>;
  /** Toutes les cartes possibles, toutes catégories (utilisé pour la priorité du badge compteur). */
  allPossibleMeals?: PossibleMeal[];
}

/** Liste des repas « possibles » pour une catégorie : tri, glisser-déposer, actions et détail en popup. */
export function PossibleList({
  category, items, sortMode, stockMap, onToggleSort, onRandomPick, onRemove,
  onReturnWithoutDeduction, onReturnToMaster, onDelete, onDuplicate,
  onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateProtein, onUpdateGrams,
  onUpdateIngredients, onUpdatePossibleIngredients, onUpdateOvenTemp, onUpdateOvenMinutes,
  onUpdateQuantity, onSplitQuantity, onReorder, onExternalDrop, highlightedId, foodItems,
  onAddDirectly, masterSourcePmIds, unParUnSourcePmIds, allPossibleMeals
}: PossibleListProps) {
  /** Liste de siblings utilisée pour décider de l’affichage du badge compteur (toutes catégories si fourni). */
  const badgeSiblings = allPossibleMeals ?? items;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [popupPm, setPopupPm] = useState<PossibleMeal | null>(null);
  const [hidePastPlannedCards, setHidePastPlannedCards] = useState(true);

  // Indexer les articles alimentaires pour une recherche en O(1) dans analyzeMealIngredients
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);

  const sortLabel = sortMode === "manual" ? "Manuel" : sortMode === "expiration" ? "Péremption" : "Planning";
  const SortIcon = sortMode === "expiration" ? CalendarDays : sortMode === "planning" ? CalendarClock : ArrowUpDown;
  const displayItemsWithAnalysis = useMemo(() => {
    return items.map(pm => {
      const meal = pm.meals;
      if (!meal) return { pm, analysis: null };
      const currentIngredients = pm.ingredients_override ?? meal.ingredients;
      const analysis = analyzeMealIngredients({ ...meal, ingredients: currentIngredients }, foodItems, foodItemIndex);
      return { pm, analysis };
    });
  }, [items, foodItems, foodItemIndex]);
  const todayISO = format(new Date(), 'yyyy-MM-dd');
  const visibleItemsWithAnalysis = useMemo(() => {
    if (!hidePastPlannedCards) return displayItemsWithAnalysis;
    return displayItemsWithAnalysis.filter(({ pm }) => {
      if (!pm.day_of_week) return true;
      // Les dates de planning au format ISO strict avant aujourd'hui sont masquées.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week)) return true;
      return pm.day_of_week >= todayISO;
    });
  }, [displayItemsWithAnalysis, hidePastPlannedCards, todayISO]);

  return (
    <MealList title={`${category.label} possibles`} emoji={category.emoji} count={visibleItemsWithAnalysis.length} onExternalDrop={onExternalDrop}
      headerActions={<>
        <label className="inline-flex items-center justify-center mr-1 cursor-pointer" title="Masquer les cartes planifiées avant aujourd'hui">
          <input
            type="checkbox"
            checked={hidePastPlannedCards}
            onChange={(e) => setHidePastPlannedCards(e.target.checked)}
            className="h-4 w-4 rounded border-border/70 bg-background accent-foreground"
            aria-label="Masquer les cartes planifiées avant aujourd'hui"
          />
        </label>
        <Button size="sm" variant="ghost" onClick={onAddDirectly} className="h-6 w-6 p-0" title="Ajouter"><Plus className="h-3 w-3" /></Button>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5"><SortIcon className="h-3 w-3" /><span>{sortLabel}</span></Button>
        <Button size="sm" variant="ghost" onClick={onRandomPick} className="h-6 w-6 p-0"><Dice5 className="h-3.5 w-3.5" /></Button>
      </>}>
      {visibleItemsWithAnalysis.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">Glisse des repas ici →</p>}
      {(() => {
        let hasTodayLine = false;

        return visibleItemsWithAnalysis.map(({ pm, analysis }, index) => {
          const meal = pm.meals;
          if (!meal || !analysis) return null;
          const expiredIngs = analysis.expiredIngredientNames;
          const soonIngs = analysis.expiringSoonIngredientNames;
          const resolvedCounterStart =
            masterSourcePmIds.has(pm.id) || unParUnSourcePmIds.has(pm.id)
              ? null
              : resolveCounterStartForPossibleBadge(
                  pm,
                  badgeSiblings,
                  analysis.earliestCounterDate,
                  pm.counter_start_date ?? undefined,
                  foodItems,
                  foodItemIndex,
                );

          const isTodayPM = pm.day_of_week === todayISO;
          const isPrevToday = index > 0 && visibleItemsWithAnalysis[index - 1].pm.day_of_week === todayISO;
          const isNextToday = index < visibleItemsWithAnalysis.length - 1 && visibleItemsWithAnalysis[index + 1].pm.day_of_week === todayISO;

          const showTopSeparator = isTodayPM && !isPrevToday && index > 0;
          const showBottomSeparator = isTodayPM && !isNextToday && index < visibleItemsWithAnalysis.length - 1;

          return (
            <React.Fragment key={pm.id}>
              {showTopSeparator && (
                <div className="flex items-center gap-2 my-2 mt-4">
                  <Separator className="flex-1 opacity-40 bg-primary/30" />
                  <span className="text-[10px] uppercase tracking-widest font-black text-primary/60 flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> Aujourd'hui
                  </span>
                  <Separator className="flex-1 opacity-40 bg-primary/30" />
                </div>
              )}
              <MemoizedPossibleMealCard pm={pm} stockMap={stockMap} foodItems={foodItems}
                expiredIngredientNames={expiredIngs}
                expiringSoonIngredientNames={soonIngs}
                onRemove={() => onRemove(pm.id)}
                onReturnWithoutDeduction={masterSourcePmIds.has(pm.id) ? undefined : () => onReturnWithoutDeduction(pm.id)}
                onReturnWithoutDeductionLabel={unParUnSourcePmIds.has(pm.id) ? "Revenir dans Un par un" : undefined}
                onReturnToMaster={masterSourcePmIds.has(pm.id) ? () => onReturnToMaster(pm.id) : undefined}
                onDelete={() => onDelete(pm.id)}
                onDuplicate={() => onDuplicate(pm.id)}
                onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
                onUpdatePlanning={(day, time) =>
                  // Créneau complet : ne pas passer de counter forcé (Index → null sur la ligne PM + sync food_items).
                  // Sinon le 4e paramètre repasse une date « ouvert maintenant » et fausse updateFoodItemCountersForPlanning.
                  onUpdatePlanning(
                    pm.id,
                    day,
                    time,
                    day && time
                      ? undefined
                      : (resolvedCounterStart ?? pm.counter_start_date ?? analysis.earliestCounterDate),
                  )}
                onUpdateCounter={(d) => onUpdateCounter(pm.id, d)}
                onUpdateCalories={(cal) => onUpdateCalories(pm.meal_id, cal, pm.id)}
                onUpdateProtein={onUpdateProtein ? (pro) => onUpdateProtein(pm.meal_id, pro, pm.id) : undefined}
                onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g, pm.id)}
                onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
                onUpdatePossibleIngredients={(newIng) => onUpdatePossibleIngredients(pm.id, newIng)}
                onUpdateOvenTemp={onUpdateOvenTemp ? (t) => onUpdateOvenTemp(pm.meals.id, t) : undefined}
                onUpdateOvenMinutes={onUpdateOvenMinutes ? (m) => onUpdateOvenMinutes(pm.meals.id, m) : undefined}
                onUpdateQuantity={unParUnSourcePmIds.has(pm.id) ? (qty) => onUpdateQuantity(pm.id, qty) : undefined}
                onSplitQuantity={onSplitQuantity ? (ratio, baseIng) => onSplitQuantity(pm.id, ratio, baseIng) : undefined}
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
                onDoubleClick={() => setPopupPm(pm)}
                isHighlighted={highlightedId === pm.id}
                realtimeCounterStartDate={
                  resolvedCounterStart === null
                    ? undefined
                    : (resolvedCounterStart ?? analysis.earliestCounterDate ?? pm.counter_start_date ?? undefined)
                } />

              {showBottomSeparator && (
                <div className="py-2 px-2">
                  <Separator className="bg-primary/20" />
                </div>
              )}
            </React.Fragment>
          );
        });
      })()}

      <Dialog open={!!popupPm} onOpenChange={(open) => { if (!open) setPopupPm(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du repas</DialogTitle>
          {popupPm && popupPm.meals && (() => {
            const meal = popupPm.meals;
            const displayIngredients = popupPm.ingredients_override ?? meal.ingredients;
            const popupDisplayIngredients = ingredientsForPossibleCardDisplay(displayIngredients);
            const ingCal = computeIngredientCalories(displayIngredients);
            const ingPro = computeIngredientProtein(displayIngredients);
            const displayCal = ingCal !== null ? String(ingCal) : meal.calories;
            const displayPro = ingPro !== null ? String(ingPro) : meal.protein;
            const analysis = analyzeMealIngredients({ ingredients: displayIngredients } as any, foodItems, foodItemIndex);
            const effectiveStart =
              resolveCounterStartForPossibleBadge(
                popupPm,
                badgeSiblings,
                analysis.earliestCounterDate,
                popupPm.counter_start_date ?? undefined,
                foodItems,
                foodItemIndex,
              ) ??
              analysis.earliestCounterDate ??
              popupPm.counter_start_date ??
              null;
            const counterDays = getAdaptedCounterDays(effectiveStart, popupPm.day_of_week, popupPm.created_at, popupPm.meal_time);
            const counterBadgeTitle =
              counterDays !== null && effectiveStart
                ? getCounterDaysBadgeTooltip(effectiveStart, popupPm.day_of_week, popupPm.meal_time, counterDays)
                : undefined;

            const expired = popupPm.expiration_date && new Date(popupPm.expiration_date) < new Date();

            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(displayIngredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">{getCategoryEmoji(meal.category)} {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1" title="Calories">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1" title="Protéines">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1" title="Grammes">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                  {counterDays !== null && (
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`} title={counterBadgeTitle}>
                      <Timer className="h-3.5 w-3.5" /> {counterDays}j
                    </span>
                  )}
                </div>
                {popupPm.expiration_date && (
                  <p className={`text-sm mb-2 ${expired ? 'text-red-200 font-bold' : 'text-white/70'}`}>
                    📅 {format(parseISO(popupPm.expiration_date), "d MMMM yyyy", { locale: fr })}
                  </p>
                )}
                {popupDisplayIngredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90">
                      <StructuredIngredientInline
                        ingredients={popupDisplayIngredients}
                        stockMap={stockMap}
                        forcePlainWhite
                      />
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1">
                    <Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}
                  </p>
                )}
                {popupPm.day_of_week && popupPm.meal_time && (
                  <p className="text-xs text-white/50 mt-3">
                    {DAY_LABELS_FULL[popupPm.day_of_week]} — {TIME_LABELS[popupPm.meal_time]}
                  </p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </MealList>
  );
}
