/**
 * PossibleList — Liste des repas "possibles" (à préparer prochainement).
 *
 * Affiche les cartes de repas planifiés avec tri (manuel, péremption, planning),
 * ajout direct, tirage aléatoire, et drag & drop interne + externe.
 *
 * Chaque carte est enveloppée dans MemoizedPossibleMealCard pour la performance.
 * Un séparateur "Aujourd'hui" s'affiche quand un repas est planifié pour aujourd'hui.
 *
 * Le popup de détails (double-clic) affiche macros, description, ingrédients, cuisson, compteur.
 *
 * Popup détails : mêmes ingrédients structurés que partout ailleurs (StructuredIngredientInline).
 */
import React, { useMemo, useState } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays, CalendarClock, Flame, Weight, Timer, Thermometer, FileText, Wheat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MealList } from "@/components/MealList";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import { applyContainerReorderDrop } from "@/lib/listReorderDnD";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import { computeIngredientCalories, computeIngredientProtein, computeIngredientFiber, getMealColor, ingredientsForPossibleCardDisplay, getAdaptedCounterHours } from "@/lib/ingredientUtils";
import { resolveMealDescriptionForDisplay } from "@/lib/mealDescription";
import { isPossibleOnlyCreatedMeal } from "@/lib/possibleOnlyMeals";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { buildStockMap, analyzeMealIngredients, getDisplayedPMCalories, getDisplayedPMFiber, buildFoodItemIndex, resolveCounterStartForPossibleBadge, resolveInheritedFutureLotOpening, findEarliestActiveCounterDate, pickEarliestPastCounterStart, formatFrozenPossibleCounterTooltip, formatPossibleCounterBadgeLabel, readFrozenPossibleCounterDays, resolveVisiblePossibleCounterDays, type PossibleFrozenCounterDaysMap } from "@/lib/stockUtils";
import type { StockInfo } from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import { usePreferenceValue } from "@/hooks/usePreferences";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import type { NinjaCreamiBaseGroup, NinjaCreamiCatalogLine } from "@/domain/ninjaCreami/ninjaCreami";
import { isNinjaCreamiStockExemptPossibleMeal } from "@/domain/ninjaCreami/ninjaCreami";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

import {
  DAY_LABELS,
  isPossibleMealVisibleForPlanningDay,
} from "@/lib/planningWeekUtils";

const TIME_LABELS: Record<string, string> = {
  matin: 'Petit déj', midi: 'Midi', gouter: 'Goûter', soir: 'Soir',
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
      prevProps.ingredientMacroSources === nextProps.ingredientMacroSources &&
      prevProps.mealsCatalog === nextProps.mealsCatalog &&
      prevProps.onReturnWithoutDeductionLabel === nextProps.onReturnWithoutDeductionLabel &&
      !!prevProps.onReturnToMaster === !!nextProps.onReturnToMaster &&
      prevProps.onReturnToMasterLabel === nextProps.onReturnToMasterLabel &&
      !!prevProps.onReturnWithoutDeduction === !!nextProps.onReturnWithoutDeduction &&
      !!prevProps.onUpdateQuantity === !!nextProps.onUpdateQuantity &&
      !!prevProps.onRename === !!nextProps.onRename &&
      !!prevProps.fromMaster === !!nextProps.fromMaster &&
      !!prevProps.onSaveToNinjaTested === !!nextProps.onSaveToNinjaTested &&
      prevProps.ninjaCreamiBaseGroups === nextProps.ninjaCreamiBaseGroups &&
      prevProps.ninjaCreamiExtrasLines === nextProps.ninjaCreamiExtrasLines &&
      prevProps.ninjaCreamiTestsGroupOrder === nextProps.ninjaCreamiTestsGroupOrder &&
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
  onUpdateFiber?: (id: string, fiber: string | null, pmId?: string) => void;
  onUpdateGrams: (id: string, g: string | null, pmId?: string) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;
  onUpdateOvenTemp?: (id: string, temp: string | null) => void;
  onUpdateOvenMinutes?: (id: string, minutes: string | null) => void;
  onUpdateDescription?: (id: string, description: string | null) => void;
  /** Renomme un repas (Possibles uniquement, ou carte Ninja Creami). */
  onRename?: (id: string, name: string) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onSplitQuantity?: (id: string, ratio: number, baseIngredients: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string, source: string, pmId?: string | null) => void;
  highlightedId: string | null;
  foodItems: FoodItem[];
  ingredientMacroAutofillSources?: IngredientMacroAutofillSources;
  onAddDirectly: () => void;
  masterSourcePmIds: Set<string>;
  unParUnSourcePmIds: Set<string>;
  /** Toutes les cartes possibles, toutes catégories (utilisé pour la priorité du badge compteur). */
  allPossibleMeals?: PossibleMeal[];
  /** Snapshots de déduction par carte (état stock avant consommation, pour retrouver le compteur réel). */
  deductionSnapshots?: Record<string, FoodItem[]>;
  /** Jours de compteur figés par id de carte Possible (prefs). */
  frozenCounterDaysByPmId?: PossibleFrozenCounterDaysMap;
  /** Catalogue des repas (Master / Au choix) pour retomber sur la description homonyme si absente. */
  mealsCatalog?: Meal[];
  /** Ids des repas créés via « Possibles uniquement » (renommables depuis Possible). */
  possibleOnlyMealIds?: string[];
  /** Possible issus de Ninja Creami → Tests (option enregistrer Recettes testées ; renommables). */
  ninjaCreamiTestPmIds?: Set<string> | string[];
  onSaveToNinjaTested?: (pmId: string) => void;
  /** Meal ids déjà en Recettes testées (équivalent Tous : pas de lien stock ; renommables). */
  ninjaCreamiMealIds?: Set<string> | string[];
  /** Catalogue Base Tests pour l’option « Ajouter extras ». */
  ninjaCreamiBaseGroups?: NinjaCreamiBaseGroup[];
  /** Catalogue Extras Tests pour l’option « Ajouter extras ». */
  ninjaCreamiExtrasLines?: NinjaCreamiCatalogLine[];
  /** Ordre des sous-catégories Tests pour « Ajouter extras ». */
  ninjaCreamiTestsGroupOrder?: string[] | null;
}

/** Liste des repas « possibles » pour une catégorie : tri, glisser-déposer, actions et détail en popup. */
export function PossibleList({
  category, items, sortMode, stockMap, onToggleSort, onRandomPick, onRemove,
  onReturnWithoutDeduction, onReturnToMaster, onDelete, onDuplicate,
  onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateProtein, onUpdateFiber, onUpdateGrams,
  onUpdateIngredients, onUpdatePossibleIngredients, onUpdateOvenTemp, onUpdateOvenMinutes, onUpdateDescription,
  onRename,
  onUpdateQuantity, onSplitQuantity, onReorder, onExternalDrop, highlightedId, foodItems,
  ingredientMacroAutofillSources,
  onAddDirectly, masterSourcePmIds, unParUnSourcePmIds, allPossibleMeals, deductionSnapshots = {},
  frozenCounterDaysByPmId = {},
  mealsCatalog = [],
  possibleOnlyMealIds = [],
  ninjaCreamiTestPmIds,
  onSaveToNinjaTested,
  ninjaCreamiMealIds,
  ninjaCreamiBaseGroups,
  ninjaCreamiExtrasLines,
  ninjaCreamiTestsGroupOrder,
}: PossibleListProps) {
  /** Liste de siblings utilisée pour décider de l’affichage du badge compteur (toutes catégories si fourni). */
  const badgeSiblings = allPossibleMeals ?? items;
  /** Fiches d’avant déduction : mémoire des lots dont le stock a été entièrement consommé. */
  const consumedLotSnapshots = useMemo(
    () => Object.values(deductionSnapshots).flat(),
    [deductionSnapshots],
  );
  const ninjaTestPmSet = useMemo(() => {
    if (!ninjaCreamiTestPmIds) return new Set<string>();
    return ninjaCreamiTestPmIds instanceof Set
      ? ninjaCreamiTestPmIds
      : new Set(ninjaCreamiTestPmIds);
  }, [ninjaCreamiTestPmIds]);
  const ninjaMealIdSet = useMemo(() => {
    if (!ninjaCreamiMealIds) return new Set<string>();
    return ninjaCreamiMealIds instanceof Set
      ? ninjaCreamiMealIds
      : new Set(ninjaCreamiMealIds);
  }, [ninjaCreamiMealIds]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [popupPm, setPopupPm] = useState<PossibleMeal | null>(null);
  /**
   * Décochée = à partir du lundi de la semaine courante (lun→… + semaines futures).
   * Cochée = à partir d’aujourd’hui (masque les jours de planning strictement avant aujourd’hui).
   * Défaut cochée : mode « à partir d’aujourd’hui ».
   */
  const [showFromToday, setShowFromToday] = useState(true);
  const hideCalorieDisplay = usePreferenceValue<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);

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
    const now = new Date();
    return displayItemsWithAnalysis.filter(({ pm }) =>
      isPossibleMealVisibleForPlanningDay(pm.day_of_week, showFromToday, now),
    );
  }, [displayItemsWithAnalysis, showFromToday]);

  /**
   * Drop dans le vide de l’encadré Possible : réordonne la carte glissée selon la position Y.
   */
  const handleContainerReorderDrop = (e: React.DragEvent): boolean => {
    const source = e.dataTransfer.getData("source");
    if (source !== "possible" || dragIndex === null) return false;
    const cardsRoot = (e.currentTarget as HTMLElement).querySelector("[data-meal-list-cards]");
    const handled = applyContainerReorderDrop(dragIndex, e.clientY, cardsRoot, onReorder);
    setDragIndex(null);
    return handled;
  };

  return (
    <MealList title={`${category.label} possibles`} emoji={category.emoji} count={visibleItemsWithAnalysis.length} onExternalDrop={onExternalDrop}
      onInternalReorderDrop={handleContainerReorderDrop}
      headerActions={<>
        <label
          className="inline-flex items-center justify-center mr-1 cursor-pointer"
          title="Décochée : à partir du lundi de la semaine courante. Cochée : à partir d’aujourd’hui."
        >
          <input
            type="checkbox"
            checked={showFromToday}
            onChange={(e) => setShowFromToday(e.target.checked)}
            className="h-4 w-4 rounded border-border/70 bg-background accent-foreground"
            aria-label="N’afficher que les plats à partir d’aujourd’hui (décochée : dès le lundi de la semaine)"
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
          const cardIngredients = pm.ingredients_override ?? meal.ingredients;
          const stockExempt =
            masterSourcePmIds.has(pm.id) ||
            isNinjaCreamiStockExemptPossibleMeal(
              pm.id,
              pm.meal_id,
              ninjaTestPmSet,
              ninjaMealIdSet,
            );
          const snapshotPastOpening = cardIngredients
            ? findEarliestActiveCounterDate(cardIngredients, deductionSnapshots[pm.id] ?? [], foodItemIndex)
            : undefined;
          const resolvedCounterStart =
            stockExempt || unParUnSourcePmIds.has(pm.id)
              ? null
              : resolveCounterStartForPossibleBadge(
                  pm,
                  badgeSiblings,
                  analysis.earliestCounterDate,
                  pm.counter_start_date ?? undefined,
                  foodItems,
                  foodItemIndex,
                  undefined,
                  analysis.earliestActiveCounterDate,
                );

          // Ouverture programmée par une carte planifiée plus tôt (Sandwich jeu. → Pâtes ven.).
          const inheritedFutureOpening = stockExempt
            ? undefined
            : resolveInheritedFutureLotOpening(
                pm, badgeSiblings, foodItems, foodItemIndex,
                undefined, undefined, undefined, consumedLotSnapshots,
              );

          const frozenCounterDays = resolveVisiblePossibleCounterDays({
            frozenDays: readFrozenPossibleCounterDays(frozenCounterDaysByPmId, pm.id),
            inheritedFutureOpeningIso: inheritedFutureOpening,
            ingredients: cardIngredients,
            foodItems,
            index: foodItemIndex,
            dayKey: pm.day_of_week,
            mealTime: pm.meal_time,
            stockExempt,
          });

          const isTodayPM = pm.day_of_week === todayISO;
          const isPrevToday = index > 0 && visibleItemsWithAnalysis[index - 1].pm.day_of_week === todayISO;
          const isNextToday = index < visibleItemsWithAnalysis.length - 1 && visibleItemsWithAnalysis[index + 1].pm.day_of_week === todayISO;

          const showTopSeparator = isTodayPM && !isPrevToday && index > 0;
          const showBottomSeparator = isTodayPM && !isNextToday && index < visibleItemsWithAnalysis.length - 1;

          const returnToMasterLabel = ninjaMealIdSet.has(pm.meal_id)
            ? "Revenir dans Au choix"
            : ninjaTestPmSet.has(pm.id)
              ? "Retirer de Possible"
              : "Revenir dans Tous";

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
              <div data-reorder-idx={index}>
                <MemoizedPossibleMealCard pm={pm} stockMap={stockMap} foodItems={foodItems}
                  ingredientMacroSources={ingredientMacroAutofillSources}
                  mealsCatalog={mealsCatalog}
                  fromMaster={stockExempt}
                  frozenCounterDays={frozenCounterDays}
                  expiredIngredientNames={expiredIngs}
                  expiringSoonIngredientNames={soonIngs}
                  onRemove={() => onRemove(pm.id)}
                  onReturnWithoutDeduction={stockExempt ? undefined : () => onReturnWithoutDeduction(pm.id)}
                  onReturnWithoutDeductionLabel={unParUnSourcePmIds.has(pm.id) ? "Revenir dans Un par un" : undefined}
                  onReturnToMaster={stockExempt ? () => onReturnToMaster(pm.id) : undefined}
                  onReturnToMasterLabel={returnToMasterLabel}
                  onSaveToNinjaTested={
                    ninjaTestPmSet.has(pm.id) && onSaveToNinjaTested
                      ? () => onSaveToNinjaTested(pm.id)
                      : undefined
                  }
                  ninjaCreamiBaseGroups={ninjaCreamiBaseGroups}
                  ninjaCreamiExtrasLines={ninjaCreamiExtrasLines}
                  ninjaCreamiTestsGroupOrder={ninjaCreamiTestsGroupOrder}
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
                  onUpdateFiber={onUpdateFiber ? (fiber) => onUpdateFiber(pm.meal_id, fiber, pm.id) : undefined}
                  onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g, pm.id)}
                  onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
                  onUpdatePossibleIngredients={(newIng) => onUpdatePossibleIngredients(pm.id, newIng)}
                  onUpdateOvenTemp={onUpdateOvenTemp ? (t) => onUpdateOvenTemp(pm.meals.id, t) : undefined}
                  onUpdateOvenMinutes={onUpdateOvenMinutes ? (m) => onUpdateOvenMinutes(pm.meals.id, m) : undefined}
                  onUpdateDescription={onUpdateDescription ? (d) => onUpdateDescription(pm.meals.id, d) : undefined}
                  onRename={
                    onRename &&
                    (isPossibleOnlyCreatedMeal(meal.id, possibleOnlyMealIds) ||
                      isNinjaCreamiStockExemptPossibleMeal(
                        pm.id,
                        meal.id,
                        ninjaCreamiTestPmIds,
                        ninjaCreamiMealIds,
                      ))
                      ? (name) => onRename(meal.id, name)
                      : undefined
                  }
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
                    inheritedFutureOpening
                      ?? (resolvedCounterStart === null
                        ? undefined
                        : pickEarliestPastCounterStart(
                            resolvedCounterStart,
                            snapshotPastOpening,
                            analysis.earliestActiveCounterDate,
                            analysis.earliestCounterDate,
                            pm.counter_start_date,
                          ))
                  } />
              </div>

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
            const popupFiber =
              getDisplayedPMFiber(popupPm, undefined, undefined, foodItems, foodItemIndex)
              ?? computeIngredientFiber(displayIngredients);
            const displayFiber = popupFiber != null && Number(popupFiber) > 0 ? String(Math.round(Number(popupFiber))) : null;
            const analysis = analyzeMealIngredients({ ingredients: displayIngredients } as any, foodItems, foodItemIndex);
            const popupStockExempt =
              masterSourcePmIds.has(popupPm.id) ||
              isNinjaCreamiStockExemptPossibleMeal(
                popupPm.id,
                popupPm.meal_id,
                ninjaTestPmSet,
                ninjaMealIdSet,
              );
            const popupInheritedOpening = popupStockExempt
              ? undefined
              : resolveInheritedFutureLotOpening(
                  popupPm,
                  badgeSiblings,
                  foodItems,
                  foodItemIndex,
                  undefined,
                  undefined,
                  undefined,
                  consumedLotSnapshots,
                );
            const frozenCounterDays = resolveVisiblePossibleCounterDays({
              frozenDays: readFrozenPossibleCounterDays(frozenCounterDaysByPmId, popupPm.id),
              inheritedFutureOpeningIso: popupInheritedOpening,
              ingredients: displayIngredients,
              foodItems,
              index: foodItemIndex,
              dayKey: popupPm.day_of_week,
              mealTime: popupPm.meal_time,
              stockExempt: popupStockExempt,
            });
            const counterDays = frozenCounterDays;
            const popupCounterStart =
              popupInheritedOpening
              ?? analysis.earliestActiveCounterDate
              ?? analysis.earliestCounterDate
              ?? popupPm.counter_start_date;
            const popupCounterHours =
              counterDays === 0
                ? getAdaptedCounterHours(popupCounterStart, popupPm.day_of_week, popupPm.meal_time)
                : null;
            const counterBadgeLabel = formatPossibleCounterBadgeLabel(counterDays, popupCounterHours);
            const counterBadgeTitle = formatFrozenPossibleCounterTooltip(
              frozenCounterDays,
              popupCounterStart,
              popupCounterHours,
            );

            const expired = popupPm.expiration_date && new Date(popupPm.expiration_date) < new Date();
            const popupDescription = resolveMealDescriptionForDisplay(meal, mealsCatalog);

            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients?.trim() ? meal.ingredients : displayIngredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">{getCategoryEmoji(meal.category)} {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && !hideCalorieDisplay && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1" title="Calories">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1" title="Protéines">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {displayFiber && (
                    <span className="text-sm font-bold bg-emerald-600/50 px-2.5 py-1 rounded-full flex items-center gap-1" title="Fibres">
                      <Wheat className="h-3.5 w-3.5" /> {displayFiber}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1" title="Grammes">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                  {counterDays !== null && counterBadgeLabel && (
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`} title={counterBadgeTitle}>
                      <Timer className="h-3.5 w-3.5" /> {counterBadgeLabel}
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
                {popupDescription?.trim() && (
                  <div className="bg-black/20 rounded-xl p-3 mt-2">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" /> Préparation
                    </p>
                    <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{popupDescription}</p>
                  </div>
                )}
                {popupPm.day_of_week && popupPm.meal_time && (
                  <p className="text-xs text-white/50 mt-3">
                    {DAY_LABELS[popupPm.day_of_week]} — {TIME_LABELS[popupPm.meal_time]}
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
