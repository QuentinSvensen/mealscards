import { Check, Flame, Plus, Sparkles, Wheat, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PlanningInput } from "@/components/planning/PlanningInput";
import { PlanningAssignedExtraChips } from "@/components/planning/PlanningAssignedExtraChips";
import { PlanningGouterBand } from "@/components/planning/PlanningGouterBand";
import { PlanningWeekTotalsFooter } from "@/components/planning/PlanningWeekTotalsFooter";
import {
  DRINK_CALORIES,
  TIME_LABELS,
  SLOT_MEAL_TOTAL_CLASS,
  SLOT_MEAL_TOTAL_SEP_CLASS,
} from "@/components/planning/planningSlotStyles";
import { MAIN_GRID_TIMES, TIMES, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import {
  getCardDisplayCalories,
  getCardDisplayProtein,
  getCardDisplayFiber,
} from "@/hooks/useCalorieBalance";
import {
  extraFitsRemainingCalories,
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
  getRemainingDayCalories,
  hasCalorieGoalRangeMin,
} from "@/domain/planning/calorieGoalRange";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { PlanningSnapshotEntry } from "@/domain/planning/types";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
import { splitSortedExtrasByDivider } from "@/lib/extrasDividerUtils";
import {
  getAssignedExtraIdsForDay,
  mergeExtraDaySelectionIds,
  scaleExtraDisplayMacrosByCount,
} from "@/lib/planningExtraMacros";
import {
  pickDayExtraSelections,
  isExtraIdAssignedForDay,
  isDessertExtraInSelections,
  resolveNextWeekUnassignedExtraRow,
  resolveDessertCatalogId,
  countDisplayableExtraSelections,
  groupAssignedExtraIds,
  resolveAssignedExtraForDisplay,
  getAssignedExtraLabel,
  resolvePlanningExtraFoodMacros,
  formatExtraQuantitySubtitle,
  formatExtraRemainingCountLabel,
  resolveExtraColumnInputDisplayValue,
  resolveExtraColumnManualFromInput,
  resolveExtraFoodRemainingCount,
  extractExtraDisplayQuantity,
  buildCustomExtraSelectionId,
  appendNextWeekExtraSelection,
} from "@/domain/planning/extraDisplay";
import { getDisplayedFiber as getMealFiber } from "@/lib/stockUtils";
import { toast } from "@/hooks/use-toast";

const DEFAULT_WEEKLY_MULTIPLIER = 7;

export interface PlanningNextWeekViewProps {
  weekDates: Array<{ key: string; iso: string; display: string }>;
  savedSnapshots: Record<string, PlanningSnapshotEntry>;
  nextBreakfastSelections: Record<string, string>;
  nextBreakfastManualCalories: Record<string, number>;
  nextBreakfastManualProteins: Record<string, number>;
  nextExtraCalories: Record<string, number>;
  nextExtraProteins: Record<string, number>;
  nextExtraFibers: Record<string, number>;
  nextExtraSelections: Record<string, string[]>;
  nextExtraSlotAssignments: Record<string, string[]>;
  nextManualCalories: Record<string, number>;
  nextManualProteins: Record<string, number>;
  nextManualFibers: Record<string, number>;
  nextDrinkChecks: Record<string, boolean>;
  allMealsById: Map<string, Meal>;
  possiblePetitDej: PossibleMeal[];
  petitDejMeals: Meal[];
  calOverrides: Record<string, any>;
  proOverrides: Record<string, any>;
  foodItems: FoodItem[];
  foodMacroIndex: any;
  isAvailableCb: (name: string) => boolean;
  getMealsForSlot: (key: string, time: string, iso: string) => PossibleMeal[];
  sumDayExtras: (ids: string[]) => { cal: number; pro: number; fiber: number };
  resolveExtraSnapshotForDay: (iso: string, key: string) => any;
  allSingleIngredientDessertExtras: any[];
  singleIngredientDessertExtras: any[];
  singleIngredientDessertById: Map<string, any>;
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>;
  canAddDessertById: Map<string, boolean>;
  dessertPossibleCountById: Map<string, number>;
  ingredientMacroLibrary: IngredientMacroLibraryItem[] | null | undefined;
  testItemIdSet: Set<string>;
  foodSortModes: Record<string, string>;
  sortDirections: Record<string, boolean>;
  extrasDividerAfterId: string | null;
  hideDayCalorieTotals: boolean;
  NEXT_DAILY_GOAL: number;
  NEXT_DAILY_GOAL_LOW: number;
  NEXT_PROTEIN_GOAL: number;
  NEXT_FIBER_GOAL: number;
  dragOverSlot: string | null;
  setDragOverSlot: React.Dispatch<React.SetStateAction<string | null>>;
  draggedSelectedExtraId: string | null;
  setDraggedSelectedExtraId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraggedSelectedExtraOrigin: React.Dispatch<React.SetStateAction<{ iso: string; key: string } | null>>;
  openExtrasDay: string | null;
  setOpenExtrasDay: React.Dispatch<React.SetStateAction<string | null>>;
  isTouchDevice: boolean;
  customExtraName: string;
  setCustomExtraName: React.Dispatch<React.SetStateAction<string>>;
  customExtraCal: string;
  setCustomExtraCal: React.Dispatch<React.SetStateAction<string>>;
  customExtraProt: string;
  setCustomExtraProt: React.Dispatch<React.SetStateAction<string>>;
  customExtraFiber: string;
  setCustomExtraFiber: React.Dispatch<React.SetStateAction<string>>;
  setPreference: { mutate: (args: { key: string; value: unknown }) => void };
  handleNextWeekDrop: (e: React.DragEvent, iso: string, time: string) => void;
  unassignNextExtraFromAllDaySlots: (extraId: string, iso: string, key: string) => void;
  deselectNextExtraForDay: (extraId: string, iso: string, key: string) => void;
  removeOneNextWeekExtraOccurrence: (id: string, iso: string, key: string) => Promise<void>;
  addNextWeekExtraOccurrence: (id: string, iso: string, key: string) => Promise<boolean>;
  renderMiniCard: (pm: PossibleMeal, compact?: boolean, showMacros?: boolean) => React.ReactNode;
  getMealCal: (meal: any, ingredientsOverride?: any) => number;
  getMealPro: (meal: any, ingredientsOverride?: any) => number;
  parseCalories: (cal: string | null | undefined) => number;
  parseProtein: (prot: string | null | undefined) => number;
}

/**
 * Vue éditable de la semaine suivante (weekOffset === 1) : aperçu post-reset.
 */
export function PlanningNextWeekView(props: PlanningNextWeekViewProps) {
  const {
    weekDates,
    savedSnapshots,
    nextBreakfastSelections,
    nextBreakfastManualCalories,
    nextBreakfastManualProteins,
    nextExtraCalories,
    nextExtraProteins,
    nextExtraFibers,
    nextExtraSelections,
    nextExtraSlotAssignments,
    nextManualCalories,
    nextManualProteins,
    nextManualFibers,
    nextDrinkChecks,
    allMealsById,
    possiblePetitDej,
    petitDejMeals,
    calOverrides,
    proOverrides,
    foodItems,
    foodMacroIndex,
    isAvailableCb,
    getMealsForSlot,
    sumDayExtras,
    resolveExtraSnapshotForDay,
    allSingleIngredientDessertExtras,
    singleIngredientDessertExtras,
    singleIngredientDessertById,
    dessertExtraStockSnapshots,
    canAddDessertById,
    dessertPossibleCountById,
    ingredientMacroLibrary,
    testItemIdSet,
    foodSortModes,
    sortDirections,
    extrasDividerAfterId,
    hideDayCalorieTotals,
    NEXT_DAILY_GOAL,
    NEXT_DAILY_GOAL_LOW,
    NEXT_PROTEIN_GOAL,
    NEXT_FIBER_GOAL,
    dragOverSlot,
    setDragOverSlot,
    draggedSelectedExtraId,
    setDraggedSelectedExtraId,
    setDraggedSelectedExtraOrigin,
    openExtrasDay,
    setOpenExtrasDay,
    isTouchDevice,
    customExtraName,
    setCustomExtraName,
    customExtraCal,
    setCustomExtraCal,
    customExtraProt,
    setCustomExtraProt,
    customExtraFiber,
    setCustomExtraFiber,
    setPreference,
    handleNextWeekDrop,
    unassignNextExtraFromAllDaySlots,
    deselectNextExtraForDay,
    removeOneNextWeekExtraOccurrence,
    addNextWeekExtraOccurrence,
    renderMiniCard,
    getMealCal,
    getMealPro,
    parseCalories,
    parseProtein,
  } = props;

  return (
<div className="space-y-3">
          <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">📅 Aperçu semaine prochaine — inclut les éléments conservés après reset</p>
          </div>
          {weekDates.map(({ key, iso, display }) => {
            // Base post-reset : captures sauvegardées uniquement (ce qui survit au reset)
            const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
            const baseBfMealId = bfSnap?.mealId || undefined;
            const baseBfManualCal = bfSnap?.cal || 0;
            const baseBfManualPro = bfSnap?.prot || 0;
            const extraSnap = resolveExtraSnapshotForDay(iso, key);
            const baseExtraCal = extraSnap?.cal || 0;
            const baseExtraPro = extraSnap?.prot || 0;
            const baseExtraFiber = extraSnap?.fiber || 0;
            const baseExtraSel: string[] = extraSnap?.itemIds || [];

            // Surcharges semaine prochaine > base post-reset
            const effBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? baseBfMealId;
            const effBfMeal = effBfSel?.startsWith('meal:') ? allMealsById.get(effBfSel.slice(5)) : null;
            // Résoudre les sélections pm: (petit déj dans Possible)
            const effBfPm = effBfSel?.startsWith('pm:') ? possiblePetitDej.find(p => p.id === effBfSel.slice(3)) : null;
            const effBfManualCal = nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal;
            const effBfManualPro = nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro;
            const effExtraCal = nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal;
            const effExtraPro = nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro;
            const effExtraFiber = nextExtraFibers[iso] ?? nextExtraFibers[key] ?? baseExtraFiber;
            const effExtraSel = pickDayExtraSelections(nextExtraSelections, iso, key, baseExtraSel);
            const effExtraSelMerged = mergeExtraDaySelectionIds(
              effExtraSel,
              nextExtraSlotAssignments,
              iso,
              key,
            );

            // Macros calculées pour le petit déj (gère les transferts de cartes, pm: et l'analyse des ingrédients)
            const nxtBfCal = effBfMeal
              ? (effBfManualCal || getMealCal(effBfMeal))
              : effBfPm
                ? (effBfManualCal || getCardDisplayCalories(effBfPm, calOverrides[effBfPm.id], isAvailableCb))
                : effBfManualCal;
            const nxtBfPro = effBfMeal
              ? (effBfManualPro || getMealPro(effBfMeal))
              : effBfPm
                ? (effBfManualPro || getCardDisplayProtein(effBfPm, proOverrides[effBfPm.id], isAvailableCb, foodItems, foodMacroIndex))
                : effBfManualPro;
            const nxtBfFiber = effBfMeal
              ? (getMealFiber(effBfMeal, undefined, undefined, undefined, foodItems, foodMacroIndex) ?? 0)
              : effBfPm?.meals
                ? getCardDisplayFiber(effBfPm, undefined, isAvailableCb, foodItems, foodMacroIndex)
                : 0;

            const matinMeals = getMealsForSlot(key, 'matin', iso);
            const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
            const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb, foodItems, foodMacroIndex), 0);
            const matinFiber = matinMeals.reduce((s, pm) => s + getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);

            // Évite le double comptage quand le petit déj sélectionné est déjà une carte planifiée au matin
            // (même logique que la semaine courante : baseBreakfast* = 0 si isAlsoMatin).
            const isBfAlsoInMatin = effBfPm
              ? matinMeals.some((m) => m.id === effBfPm.id) ||
                ((effBfPm.day_of_week === key || effBfPm.day_of_week === iso) && effBfPm.meal_time === 'matin')
              : effBfMeal
                ? matinMeals.some((m) => m.meal_id === effBfMeal.id)
                : false;
            const effectiveNxtBfCal = isBfAlsoInMatin ? 0 : nxtBfCal;
            const effectiveNxtBfPro = isBfAlsoInMatin ? 0 : nxtBfPro;
            const effectiveNxtBfFiber = isBfAlsoInMatin ? 0 : nxtBfFiber;

            const breakfastDropKey = `${iso}-matin`;
            const nextBreakfastAssignedIds =
              nextExtraSlotAssignments[breakfastDropKey] ?? nextExtraSlotAssignments[`${key}-matin`] ?? [];
            const nextBreakfastAssigned = sumDayExtras(nextBreakfastAssignedIds);
            const nextBreakfastTotalCals = effectiveNxtBfCal + matinCals + nextBreakfastAssigned.cal;
            const nextBreakfastTotalPro = effectiveNxtBfPro + matinPro + nextBreakfastAssigned.pro;
            const nextBreakfastTotalFiber = effectiveNxtBfFiber + matinFiber + nextBreakfastAssigned.fiber;
            const isBreakfastDragOver =
              dragOverSlot === breakfastDropKey || dragOverSlot === `${key}-matin`;

            // Indicateur unifié pour savoir si un petit déj est sélectionné (meal: ou pm: ou programmed matin)
            const hasNextBf = !!(effBfMeal || effBfPm || matinMeals.length > 0);
            // Affiche les macros du créneau si repas OU extras déjà posés sur matin
            const showBreakfastMacros =
              !hideDayCalorieTotals &&
              (hasNextBf || nextBreakfastAssignedIds.length > 0) &&
              (nextBreakfastTotalCals > 0 || nextBreakfastTotalPro > 0 || nextBreakfastTotalFiber > 0);

            // Totaux jour : TIMES inclut déjà gouter ; manuels ignorés si cartes présentes (comme les bandes créneau)
            let dayTotal = nextBreakfastTotalCals;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const slotMeals = getMealsForSlot(key, time, iso);
              const hasSlotMeals = slotMeals.length > 0;
              if (!hasSlotMeals) {
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                const baseManualCal = manualSnap?.cal || 0;
                dayTotal += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? baseManualCal;
              }
              if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) dayTotal += DRINK_CALORIES;
              dayTotal += slotMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
            }
            const nextExtraSelMacros = sumDayExtras(effExtraSelMerged);
            dayTotal += effExtraCal + nextExtraSelMacros.cal;

            // Même formule que le bandeau « reste » : objectif max − total jour (extras inclus).
            const remainingNextCal = getRemainingDayCalories(NEXT_DAILY_GOAL, dayTotal);

            let nxtDayPro = nextBreakfastTotalPro;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const slotMeals = getMealsForSlot(key, time, iso);
              const hasSlotMeals = slotMeals.length > 0;
              if (!hasSlotMeals) {
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                const baseManualPro = manualSnap?.prot || 0;
                nxtDayPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? baseManualPro;
              }
              nxtDayPro += slotMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb, foodItems, foodMacroIndex), 0);
            }
            nxtDayPro += effExtraPro + nextExtraSelMacros.pro;

            let nxtDayFiber = nextBreakfastTotalFiber;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const slotMeals = getMealsForSlot(key, time, iso);
              const hasSlotMeals = slotMeals.length > 0;
              if (!hasSlotMeals) {
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                const baseManualFiber = manualSnap?.fiber || 0;
                nxtDayFiber += nextManualFibers[kIso] ?? nextManualFibers[kKey] ?? baseManualFiber;
              }
              nxtDayFiber += slotMeals.reduce((s, pm) => s + getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);
              // Fibres des extras assignés au créneau : déjà dans nextExtraSelMacros (fusion sélections + assignations)
            }
            nxtDayFiber += effExtraFiber + nextExtraSelMacros.fiber;

            const nextAssignedExtraIds = getAssignedExtraIdsForDay(nextExtraSlotAssignments, iso, key);
            const nextUnassignedExtraIds = effExtraSelMerged.filter(
              (id) => !isExtraIdAssignedForDay(id, nextAssignedExtraIds, allSingleIngredientDessertExtras, singleIngredientDessertById),
            );
            const nextUnassignedExtraMacros = sumDayExtras(nextUnassignedExtraIds);
            const hasDisplayableNextWeekExtraSelections = countDisplayableExtraSelections(
              effExtraSel,
              foodItems,
              allSingleIngredientDessertExtras,
              singleIngredientDessertById,
              dessertExtraStockSnapshots,
            ) > 0;

            // Données du créneau Goûter (mêmes clés *-gouter / prefs next_week_* que midi/soir)
            const gouterKIso = `${iso}-gouter`;
            const gouterKKey = `${key}-gouter`;
            const gouterAssignedIds =
              nextExtraSlotAssignments[gouterKIso] ?? nextExtraSlotAssignments[gouterKKey] ?? [];
            const gouterAssigned = sumDayExtras(gouterAssignedIds);
            const gouterMeals = getMealsForSlot(key, "gouter", iso);
            const gouterMealCals = gouterMeals.reduce(
              (sum, pm) => sum + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb),
              0,
            );
            const gouterMealPro = gouterMeals.reduce(
              (sum, pm) => sum + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb, foodItems, foodMacroIndex),
              0,
            );
            const gouterMealFiber = gouterMeals.reduce(
              (sum, pm) => sum + getCardDisplayFiber(pm, undefined, isAvailableCb, foodItems, foodMacroIndex),
              0,
            );
            const hasGouterMeals = gouterMeals.length > 0;
            const gouterManualSnap = (savedSnapshots[`manual-${gouterKIso}`] || savedSnapshots[`manual-${gouterKKey}`]) as
              | { cal?: number; prot?: number; fiber?: number }
              | undefined;
            const gouterManualCal =
              nextManualCalories[gouterKIso] ?? nextManualCalories[gouterKKey] ?? gouterManualSnap?.cal ?? 0;
            const gouterManualPro =
              nextManualProteins[gouterKIso] ?? nextManualProteins[gouterKKey] ?? gouterManualSnap?.prot ?? 0;
            const gouterManualFiber =
              nextManualFibers[gouterKIso] ?? nextManualFibers[gouterKKey] ?? gouterManualSnap?.fiber ?? 0;
            const effectiveGouterManualCal = hasGouterMeals ? 0 : gouterManualCal;
            const effectiveGouterManualPro = hasGouterMeals ? 0 : gouterManualPro;
            const effectiveGouterManualFiber = hasGouterMeals ? 0 : gouterManualFiber;
            const gouterDrink = Boolean(nextDrinkChecks[gouterKIso] || nextDrinkChecks[gouterKKey]);
            const gouterTotalCals =
              effectiveGouterManualCal + gouterAssigned.cal + gouterMealCals + (gouterDrink ? DRINK_CALORIES : 0);
            const gouterTotalPro = effectiveGouterManualPro + gouterAssigned.pro + gouterMealPro;
            const gouterTotalFiber = effectiveGouterManualFiber + gouterAssigned.fiber + gouterMealFiber;

            return (
              <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                  {/* Zone de drop petit-déj / matin : accepte les extras (comme PlanningBreakfastBlock en semaine courante) */}
                  <div
                    data-slot={`${key}-matin`}
                    data-day={iso}
                    data-time="matin"
                    title="Déposer un extra sur le petit-déj"
                    className={`rounded-xl border border-dashed px-2 py-1.5 transition-colors ${
                      isBreakfastDragOver
                        ? "border-primary/60 bg-primary/7 ring-1 ring-primary/20"
                        : "border-border/55 bg-background/10 hover:border-primary/40"
                    }`}
                    onDragOver={(e) => {
                      const canAccept = !!(
                        draggedSelectedExtraId ||
                        e.dataTransfer.types.includes("text/plain")
                      );
                      if (!canAccept) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverSlot(breakfastDropKey);
                    }}
                    onDragLeave={() =>
                      setDragOverSlot((cur) => (cur === breakfastDropKey ? null : cur))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      handleNextWeekDrop(e, iso, "matin");
                    }}
                  >
                    <div className="flex items-center gap-1 flex-wrap">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors truncate max-w-[120px] ${
                            (() => {
                              const count = matinMeals.length + (hasNextBf && !matinMeals.length ? 1 : 0);
                              return count > 0
                                ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50"
                                : "bg-slate-200/80 dark:bg-slate-700/45 text-slate-700 dark:text-slate-300 border border-dashed border-slate-400/50 dark:border-slate-500/50 hover:bg-slate-300/80 dark:hover:bg-slate-600/50";
                            })()
                          }`}
                        >
                          {(() => {
                            const count = matinMeals.length + (hasNextBf && !matinMeals.length ? 1 : 0);
                            if (count > 1) return 'Plusieurs petits déj';
                            if (count === 1) {
                              if (matinMeals.length === 1) return matinMeals[0].meals?.name || '🥐 Petit déj';
                              return effBfMeal ? effBfMeal.name : effBfPm?.meals?.name ? effBfPm.meals.name : '🥐 Petit déj';
                            }
                            return '🥐 Petit déj';
                          })()}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-52 p-2" align="start">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                        <div className="space-y-0.5 max-h-48 overflow-y-auto">
                          <button onClick={() => {
                            const updated = { ...nextBreakfastSelections }; delete updated[iso]; delete updated[key];
                            setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                          }} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">— Aucun</button>
                          {possiblePetitDej.length > 0 && (
                            <>
                              <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Possible</p>
                              {possiblePetitDej.map(pm => {
                                const pmSelId = `pm:${pm.id}`;
                                const isSelected = nextBreakfastSelections[iso] === pmSelId || nextBreakfastSelections[key] === pmSelId;
                                const calDisplay = getMealCal(pm.meals || {}, pm.ingredients_override);
                                const proDisplay = getMealPro(pm.meals || {}, pm.ingredients_override);
                                return (
                                  <button key={pm.id} onClick={() => {
                                    const updated = { ...nextBreakfastSelections };
                                    if (isSelected) { delete updated[iso]; delete updated[key]; } else { updated[iso] = pmSelId; }
                                    setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                                  }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''} flex items-center justify-between`}>
                                    <span className="truncate">{pm.meals?.name} {pm.ingredients_override ? '✏️' : ''}</span>
                                    <span className="inline-flex items-center gap-1.5 ml-1 text-muted-foreground shrink-0 text-[10px]">
                                      <span className="flex items-center gap-0.5">
                                        <Flame className="w-2.5 h-2.5 text-orange-500" />
                                        {calDisplay}
                                      </span>
                                      <span>•</span>
                                      <span className="flex items-center gap-0.5">
                                        <span className="grayscale brightness-125 saturate-50 leading-none">🍗</span>
                                        {proDisplay}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                              <div className="border-t border-border/40 my-1" />
                            </>
                          )}
                          <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Tous</p>
                          {petitDejMeals.map(m => {
                            const mealSelId = `meal:${m.id}`;
                            const isSelected = nextBreakfastSelections[iso] === mealSelId || nextBreakfastSelections[key] === mealSelId;
                            return (
                              <button key={m.id} onClick={() => {
                                const updated = { ...nextBreakfastSelections };
                                if (isSelected) { delete updated[iso]; delete updated[key]; } else { updated[iso] = mealSelId; }
                                setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                              }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''} flex items-center justify-between`}>
                                <span className="truncate">{m.name}</span>
                                <span className="inline-flex items-center gap-1.5 ml-1 text-muted-foreground shrink-0 text-[10px]">
                                  <span className="flex items-center gap-0.5">
                                    <Flame className="w-2.5 h-2.5 text-orange-500" />
                                    {getMealCal(m)}
                                  </span>
                                  <span>•</span>
                                  <span className="flex items-center gap-0.5">
                                    <span className="grayscale brightness-125 saturate-50 leading-none">🍗</span>
                                    {getMealPro(m)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {showBreakfastMacros && (
                      <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-5">
                        {nextBreakfastTotalCals > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Flame className="w-2 h-2 text-orange-500/60" />
                            {Math.round(nextBreakfastTotalCals)}
                          </span>
                        )}
                        {nextBreakfastTotalCals > 0 && (nextBreakfastTotalPro > 0 || nextBreakfastTotalFiber > 0) && (
                          <span className="opacity-30">•</span>
                        )}
                        {nextBreakfastTotalPro > 0 && (
                          <span className="flex items-center gap-0.5">
                            <span className="text-[9px] opacity-60">🍗</span>
                            {Math.round(nextBreakfastTotalPro)}
                          </span>
                        )}
                        {nextBreakfastTotalPro > 0 && nextBreakfastTotalFiber > 0 && (
                          <span className="opacity-30">•</span>
                        )}
                        {nextBreakfastTotalFiber > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Wheat className="w-2 h-2 text-emerald-500/70" />
                            {Math.round(nextBreakfastTotalFiber)}
                          </span>
                        )}
                      </div>
                    )}
                    {!hasNextBf && (
                      <>
                        <PlanningInput storageKey={`next-bf-cal-${iso}`} currentValue={nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal}
                          onSave={(val) => { const u = { ...nextBreakfastManualCalories }; u[iso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: u }); }}
                          placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40" />
                        <PlanningInput storageKey={`next-bf-prot-${iso}`} currentValue={nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro}
                          onSave={(val) => { const u = { ...nextBreakfastManualProteins }; u[iso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: u }); }}
                          placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40" />
                      </>
                    )}
                    </div>
                    <PlanningAssignedExtraChips
                      assignedIds={nextBreakfastAssignedIds}
                      dayIso={iso}
                      dayKey={key}
                      title="Extra assigné au petit déj — glisse pour déplacer"
                      foodItems={foodItems}
                      dessertById={singleIngredientDessertById}
                      dessertCatalog={allSingleIngredientDessertExtras}
                      dessertPossibleCountById={dessertPossibleCountById}
                      chipClassName="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/20 cursor-grab active:cursor-grabbing"
                      wrapperClassName="flex flex-wrap gap-1 mt-1"
                      keyPrefix="next-breakfast-assigned"
                      onDeselect={deselectNextExtraForDay}
                      onDragStartExtra={(extraId, dayIso, dayKey, e) => {
                        setDraggedSelectedExtraId(extraId);
                        setDraggedSelectedExtraOrigin({ iso: dayIso, key: dayKey });
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", extraId);
                      }}
                      onDragEndExtra={() => {
                        setDraggedSelectedExtraId(null);
                        setDraggedSelectedExtraOrigin(null);
                      }}
                    />
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                      <Flame className="h-2.5 w-2.5 text-orange-500" />
                      <span className={getCalorieRangeTotalColorClass(dayTotal, NEXT_DAILY_GOAL_LOW, NEXT_DAILY_GOAL) ?? undefined}>
                        {hideDayCalorieTotals ? "Calories" : Math.round(dayTotal)}
                      </span>
                      {" "}
                      <span className="text-muted-foreground/50 font-normal">/ {formatCalorieGoalTarget(NEXT_DAILY_GOAL_LOW, NEXT_DAILY_GOAL)}</span>
                    </span>
                    {dayTotal > 0 && !hideDayCalorieTotals && !hasCalorieGoalRangeMin(NEXT_DAILY_GOAL_LOW, NEXT_DAILY_GOAL) && (
                      <span className={`text-[10px] font-bold whitespace-nowrap ${NEXT_DAILY_GOAL - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                        {NEXT_DAILY_GOAL - dayTotal > 0 ? `reste ${Math.round(NEXT_DAILY_GOAL - dayTotal)}` : `+${Math.round(dayTotal - NEXT_DAILY_GOAL)}`}
                      </span>
                    )}
                    {nxtDayPro > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                        🍗 {Math.round(nxtDayPro)} <span className="text-blue-400/50 font-normal">/ {NEXT_PROTEIN_GOAL}</span>
                      </span>
                    )}
                    {nxtDayFiber > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                        🌾 {Math.round(nxtDayFiber)} <span className="text-emerald-400/50 font-normal">/ {NEXT_FIBER_GOAL}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                  {MAIN_GRID_TIMES.map(time => {
                    const kIso = `${iso}-${time}`;
                    const kKey = `${key}-${time}`;
                    const slotKey = kIso;
                    const slotId = `${key}-${time}`;
                    const slotMeals = getMealsForSlot(key, time, iso);
                    const slotAssignedIds =
                      nextExtraSlotAssignments[kIso] ?? nextExtraSlotAssignments[kKey] ?? [];
                    const isOver = dragOverSlot === slotKey || dragOverSlot === slotId;
                    const slotCalsMeals = slotMeals.reduce((s, p) => s + getCardDisplayCalories(p, calOverrides[p.id], isAvailableCb), 0);
                    const slotProMeals = slotMeals.reduce((s, p) => s + getCardDisplayProtein(p, proOverrides[p.id], isAvailableCb, foodItems, foodMacroIndex), 0);
                    const slotFiberMeals = slotMeals.reduce((s, p) => s + getCardDisplayFiber(p, undefined, isAvailableCb, foodItems, foodMacroIndex), 0);
                    const slotAssigned = sumDayExtras(slotAssignedIds);
                    const slotDrink = Boolean(nextDrinkChecks[kIso] || nextDrinkChecks[kKey]);
                    const manualCal = nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.cal ?? 0;
                    const manualPro = nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.prot ?? 0;
                    const manualFiber = nextManualFibers[kIso] ?? nextManualFibers[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.fiber ?? 0;
                    // Sans carte : total = inputs manuels + extras (+ boisson).
                    const hasSlotMeals = slotMeals.length > 0;
                    const slotManualCal = hasSlotMeals ? 0 : manualCal;
                    const slotManualPro = hasSlotMeals ? 0 : manualPro;
                    const slotManualFiber = hasSlotMeals ? 0 : manualFiber;
                    const slotCals = slotCalsMeals + slotManualCal + slotAssigned.cal + (slotDrink ? DRINK_CALORIES : 0);
                    const slotPro = slotProMeals + slotManualPro + slotAssigned.pro;
                    const slotFiber = slotFiberMeals + slotManualFiber + slotAssigned.fiber;
                    const showSlotTotals = !hideDayCalorieTotals && (slotMeals.length > 0
                      ? (slotCals > 0 || slotPro > 0 || slotFiber > 0)
                      : (slotCals > 0 || slotPro > 0 || slotFiber > 0));
                    return (
                      <div
                        key={time}
                        data-slot={slotId}
                        data-day={iso}
                        data-time={time}
                        onDragOver={(e) => {
                          const canAccept = !!(draggedSelectedExtraId || e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('pmId'));
                          if (canAccept) e.preventDefault();
                          setDragOverSlot(slotKey);
                        }}
                        onDragLeave={() => setDragOverSlot(null)}
                        onDrop={(e) => { e.preventDefault(); handleNextWeekDrop(e, iso, time); }}
                        className={`min-h-[56px] sm:min-h-[64px] rounded-xl border border-dashed p-1.5 sm:p-2 transition-all ${isOver ? 'bg-primary/16 border-primary/70 scale-[1.02] shadow-lg ring-1 ring-primary/25' : 'border-border/55 bg-background/10'}`}
                      >
                        <div className="flex items-center justify-between mb-0.5 gap-0.5 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                            <button onClick={() => {
                              const u = { ...nextDrinkChecks }; if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) { delete u[kIso]; delete u[kKey]; } else { u[kIso] = true; }
                              setPreference.mutate({ key: 'next_week_drink_checks', value: u });
                            }} className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${slotDrink ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold' : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
                              🥤 {slotDrink ? `+${DRINK_CALORIES}` : ''}
                            </button>
                          </div>
                          {showSlotTotals && (
                            <div className={SLOT_MEAL_TOTAL_CLASS}>
                              {(slotMeals.length > 0 ? slotCals : manualCal) > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Flame className="w-1.5 h-1.5 sm:w-2 sm:h-2 text-orange-500/60" />
                                  {Math.round(slotMeals.length > 0 ? slotCals : manualCal)}
                                </span>
                              )}
                              {(slotMeals.length > 0 ? slotCals : manualCal) > 0 && ((slotMeals.length > 0 ? slotPro : manualPro) > 0 || (slotMeals.length > 0 ? slotFiber : manualFiber) > 0) && (
                                <span className={SLOT_MEAL_TOTAL_SEP_CLASS}>•</span>
                              )}
                              {(slotMeals.length > 0 ? slotPro : manualPro) > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <span className="text-[8px] sm:text-[9px] opacity-60">🍗</span>
                                  {Math.round(slotMeals.length > 0 ? slotPro : manualPro)}
                                </span>
                              )}
                              {(slotMeals.length > 0 ? slotPro : manualPro) > 0 && (slotMeals.length > 0 ? slotFiber : manualFiber) > 0 && (
                                <span className={SLOT_MEAL_TOTAL_SEP_CLASS}>•</span>
                              )}
                              {(slotMeals.length > 0 ? slotFiber : manualFiber) > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Wheat className="w-1.5 h-1.5 sm:w-2 sm:h-2 text-emerald-500/70" />
                                  {Math.round(slotMeals.length > 0 ? slotFiber : manualFiber)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="mt-0.5 space-y-1">
                          {slotMeals.map((pm) => renderMiniCard(pm, false, time === 'midi' || time === 'soir'))}
                          {slotMeals.length === 0 && (
                            <div className="flex flex-col items-start gap-0.5">
                              <PlanningInput storageKey={`next-mc-${iso}-${time}`} currentValue={manualCal}
                                onSave={(val) => { const u = { ...nextManualCalories }; u[kIso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_manual_calories', value: u }); }}
                                placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center" />
                              <PlanningInput storageKey={`next-mp-${iso}-${time}`} currentValue={manualPro}
                                onSave={(val) => { const u = { ...nextManualProteins }; u[kIso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_manual_proteins', value: u }); }}
                                placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                              <PlanningInput storageKey={`next-mf-${iso}-${time}`} currentValue={manualFiber}
                                onSave={(val) => { const u = { ...nextManualFibers }; u[kIso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_manual_fibers', value: u }); }}
                                placeholder="fib" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 placeholder:text-emerald-400/30 focus:outline-none focus:border-emerald-400/40 text-center" />
                            </div>
                          )}
                          {slotAssignedIds.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {groupAssignedExtraIds(slotAssignedIds).map(({ id: extraId, count }, index) => {
                                const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, singleIngredientDessertById);
                                if (!resolved) return null;
                                const { custom, fi } = resolved;
                                return (
                                  <span
                                    key={`next-${time}-assigned-${extraId}-${index}-${count}`}
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedSelectedExtraId(extraId);
                                      setDraggedSelectedExtraOrigin({ iso, key });
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', extraId);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                    }}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25 cursor-grab active:cursor-grabbing"
                                    title={`Extra assigné à ${TIME_LABELS[time] || time} — glisse pour déplacer`}
                                  >
                                    {getAssignedExtraLabel(extraId, count, custom, fi ?? undefined, foodItems, singleIngredientDessertById)}
                                    <button
                                      onClick={() => deselectNextExtraForDay(extraId, iso, key)}
                                      className="opacity-60 hover:opacity-100 font-bold"
                                      title="Retirer des extras du jour"
                                    >×</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Colonne Extra */}
                  {(() => {
                    const nextExtraDropKey = `next-extra-${iso}`;
                    const isNextExtraDragOver = dragOverSlot === nextExtraDropKey;
                    /** Persiste un extra custom (Nom/kcal/prot/fib) dans les sélections next-week du jour. */
                    const createCustomNextWeekExtra = () => {
                      const name = customExtraName.trim();
                      const cal = customExtraCal.trim();
                      if (!name || !cal) return;
                      const prot = customExtraProt.trim() || "0";
                      const fiber = customExtraFiber.trim() || "0";
                      const customId = buildCustomExtraSelectionId(name, cal, prot, fiber);
                      const updated = appendNextWeekExtraSelection(nextExtraSelections, iso, key, customId);
                      setPreference.mutate({ key: "next_week_extra_selections", value: updated });
                      setCustomExtraName("");
                      setCustomExtraCal("");
                      setCustomExtraProt("");
                      setCustomExtraFiber("");
                    };
                    return (
                  <div
                    className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center transition-colors ${isNextExtraDragOver ? "border-orange-400/65 bg-orange-500/8 ring-1 ring-orange-400/25" : "border-orange-300/45 bg-orange-500/3"}`}
                    onDragOver={(e) => {
                      const canAccept = !!(draggedSelectedExtraId || e.dataTransfer.types.includes('text/plain'));
                      if (!canAccept) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverSlot(nextExtraDropKey);
                    }}
                    onDragLeave={() => setDragOverSlot((cur) => (cur === nextExtraDropKey ? null : cur))}
                    onDrop={(e) => {
                      const extraId = draggedSelectedExtraId || e.dataTransfer.getData('text/plain');
                      if (!extraId) return;
                      e.preventDefault();
                      unassignNextExtraFromAllDaySlots(extraId, iso, key);
                      setDraggedSelectedExtraId(null);
                      setDraggedSelectedExtraOrigin(null);
                      setDragOverSlot(null);
                    }}
                    title="Déposer ici pour remettre l'extra dans la catégorie Extras"
                  >
                    <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                    <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                      <PlanningInput storageKey={`next-ec-${iso}`}
                        currentValue={resolveExtraColumnInputDisplayValue(
                          nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal,
                          nextUnassignedExtraMacros.cal,
                          hideDayCalorieTotals,
                        )}
                        onSave={(val) => {
                          const m = resolveExtraColumnManualFromInput(val, nextUnassignedExtraMacros.cal, hideDayCalorieTotals);
                          const u = { ...nextExtraCalories };
                          if (m > 0) u[iso] = m; else { delete u[iso]; }
                          delete u[key];
                          setPreference.mutate({ key: 'next_week_extra_calories', value: u });
                        }}
                        placeholder="kcal" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center" />
                      <PlanningInput storageKey={`next-ep-${iso}`}
                        currentValue={resolveExtraColumnInputDisplayValue(
                          nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro,
                          nextUnassignedExtraMacros.pro,
                          hideDayCalorieTotals,
                        )}
                        onSave={(val) => {
                          const m = resolveExtraColumnManualFromInput(val, nextUnassignedExtraMacros.pro, hideDayCalorieTotals);
                          const u = { ...nextExtraProteins };
                          if (m > 0) u[iso] = m; else { delete u[iso]; }
                          delete u[key];
                          setPreference.mutate({ key: 'next_week_extra_proteins', value: u });
                        }}
                        placeholder="prot" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                      <PlanningInput storageKey={`next-ef-${iso}`}
                        currentValue={resolveExtraColumnInputDisplayValue(
                          effExtraFiber,
                          nextUnassignedExtraMacros.fiber,
                          hideDayCalorieTotals,
                        )}
                        onSave={(val) => {
                          const m = resolveExtraColumnManualFromInput(val, nextUnassignedExtraMacros.fiber, hideDayCalorieTotals);
                          const u = { ...nextExtraFibers };
                          if (m > 0) u[iso] = m; else { delete u[iso]; }
                          delete u[key];
                          setPreference.mutate({ key: 'next_week_extra_fibers', value: u });
                        }}
                        placeholder="fib" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 placeholder:text-emerald-400/30 focus:outline-none focus:border-emerald-400/40 text-center" />
                      <div className="flex items-center gap-1 mt-1">
                        <Popover open={openExtrasDay === `next-${iso}`} onOpenChange={(open) => {
                          setOpenExtrasDay(open ? `next-${iso}` : null);
                          if (open) {
                            setCustomExtraName('');
                            setCustomExtraCal('');
                            setCustomExtraProt('');
                            setCustomExtraFiber('');
                          }
                        }}>
                          <PopoverTrigger asChild>
                            <button className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${hasDisplayableNextWeekExtraSelections ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`} title="Ajouter un Extra">
                              <Plus className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[min(28rem,calc(100vw-1.5rem))] p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl max-h-[56vh]"
                            align="center"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            {/* Formulaire d'ajout custom — même UX que la semaine courante */}
                            <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-white/5">
                              <input
                                type="text"
                                value={customExtraName}
                                onChange={(e) => setCustomExtraName(e.target.value)}
                                readOnly={isTouchDevice}
                                onFocus={(e) => {
                                  if (isTouchDevice) e.currentTarget.readOnly = false;
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && customExtraName.trim() && customExtraCal.trim()) {
                                    createCustomNextWeekExtra();
                                  }
                                }}
                                placeholder="Nom"
                                className="flex-1 min-w-0 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-3 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all shadow-sm"
                              />
                              <div className="relative group/cal shrink-0">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={customExtraCal}
                                  onChange={(e) => setCustomExtraCal(e.target.value)}
                                  readOnly={isTouchDevice}
                                  onFocus={(e) => {
                                    if (isTouchDevice) e.currentTarget.readOnly = false;
                                  }}
                                  placeholder="kcal"
                                  className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-orange-500 placeholder:text-orange-300/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 text-center transition-all shadow-sm"
                                />
                              </div>
                              <div className="relative group/prot shrink-0">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={customExtraProt}
                                  onChange={(e) => setCustomExtraProt(e.target.value)}
                                  readOnly={isTouchDevice}
                                  onFocus={(e) => {
                                    if (isTouchDevice) e.currentTarget.readOnly = false;
                                  }}
                                  placeholder="prot"
                                  className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-blue-400 placeholder:text-blue-400/20 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-center transition-all shadow-sm"
                                />
                              </div>
                              <div className="relative group/fib shrink-0">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={customExtraFiber}
                                  onChange={(e) => setCustomExtraFiber(e.target.value)}
                                  readOnly={isTouchDevice}
                                  onFocus={(e) => {
                                    if (isTouchDevice) e.currentTarget.readOnly = false;
                                  }}
                                  placeholder="fib"
                                  className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-emerald-500 placeholder:text-emerald-400/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-center transition-all shadow-sm"
                                />
                              </div>
                              <button
                                onClick={createCustomNextWeekExtra}
                                disabled={!customExtraName.trim() || !customExtraCal.trim()}
                                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 hover:from-orange-500 hover:to-orange-700 disabled:opacity-30 text-white shadow-lg shadow-orange-500/20 transition-all hover:scale-110 active:scale-95"
                                title="Valider"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Extras disponibles</p>
                              <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                            </div>
                            {(() => {
                              const unassignedRows = groupAssignedExtraIds(nextUnassignedExtraIds)
                                .map(({ id: extraId, count }, index) => {
                                  const row = resolveNextWeekUnassignedExtraRow(
                                    extraId,
                                    foodItems,
                                    singleIngredientDessertById,
                                    allSingleIngredientDessertExtras,
                                    dessertExtraStockSnapshots,
                                  );
                                  if (!row) return null;
                                  const catalogId = resolveDessertCatalogId(
                                    extraId,
                                    allSingleIngredientDessertExtras,
                                    singleIngredientDessertById,
                                    dessertExtraStockSnapshots,
                                  );
                                  const resolvedId = catalogId ?? extraId;
                                  const dessertExtra = singleIngredientDessertById.get(resolvedId);
                                  const isDessertExtra = !!dessertExtra;
                                  const canAddDessert = !isDessertExtra || canAddDessertById.get(resolvedId) === true;
                                  const displayName = row.custom?.name || dessertExtra?.name || row.fi?.name || resolvedId;
                                  const perOccurrence = dessertExtra
                                    ? { cal: dessertExtra.cal, pro: dessertExtra.prot, fiber: dessertExtra.fiber }
                                    : (row.fi
                                      ? resolvePlanningExtraFoodMacros(row.fi, ingredientMacroLibrary)
                                      : {
                                          cal: row.custom?.cal ?? 0,
                                          pro: row.custom?.prot ?? 0,
                                          fiber: row.custom?.fiber ?? 0,
                                        });
                                  const portionMacros = scaleExtraDisplayMacrosByCount(perOccurrence, count);
                                  // Sélection : #N = quantité assignée (stepper) ; catalogue garde le reste ailleurs.
                                  const dessertGrams = dessertExtra
                                    ? extractExtraDisplayQuantity(dessertExtra.mealPayload, foodItems).grams
                                    : null;
                                  const selectedQtySubtitle = row.custom
                                    ? ""
                                    : formatExtraQuantitySubtitle(
                                        isDessertExtra ? dessertGrams : row.fi?.grams,
                                        count,
                                      );
                                  return (
                                    <div
                                      key={`next-pop-sel-${extraId}-${index}`}
                                      draggable
                                      onDragStart={(e) => {
                                        setDraggedSelectedExtraId(extraId);
                                        setDraggedSelectedExtraOrigin({ iso, key });
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData('text/plain', extraId);
                                      }}
                                      onDragEnd={() => {
                                        setDraggedSelectedExtraId(null);
                                        setDraggedSelectedExtraOrigin(null);
                                      }}
                                      className="w-full p-2 rounded-xl border bg-orange-500/10 border-orange-500/20 flex items-start gap-3 cursor-grab active:cursor-grabbing"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-bold text-orange-600 break-words leading-snug">{displayName}</p>
                                        {selectedQtySubtitle && (
                                          <p className="text-[9px] text-muted-foreground/50 font-medium">{selectedQtySubtitle}</p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          onClick={async () => {
                                            try {
                                              await removeOneNextWeekExtraOccurrence(resolvedId, iso, key);
                                            } catch {
                                              toast({
                                                title: "Stock non modifié",
                                                description: "Impossible de retirer cette occurrence.",
                                                variant: "destructive",
                                              });
                                            }
                                          }}
                                          className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold"
                                        >−</button>
                                        <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                        {canAddDessert && (
                                          <button
                                            onClick={async () => {
                                              try {
                                                const ok = await addNextWeekExtraOccurrence(resolvedId, iso, key);
                                                if (!ok) {
                                                  toast({
                                                    title: "Stock insuffisant",
                                                    description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                    variant: "destructive",
                                                  });
                                                }
                                              } catch {
                                                toast({
                                                  title: "Stock insuffisant",
                                                  description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                  variant: "destructive",
                                                });
                                              }
                                            }}
                                            className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold"
                                          >+</button>
                                        )}
                                        {portionMacros.pro > 0 && (
                                          <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">
                                            🍗 {Math.round(portionMacros.pro)}
                                          </div>
                                        )}
                                        {!hideDayCalorieTotals && portionMacros.cal > 0 && (
                                          <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500">
                                            <Flame className="w-2.5 h-2.5" />
                                            {Math.round(portionMacros.cal)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                                .filter(Boolean);
                              if (unassignedRows.length === 0) return null;
                              return (
                              <div className="mb-3 pb-3 border-b border-white/5 space-y-1">
                                <p className="text-[9px] font-semibold text-orange-500 px-1">Extras sélectionnés</p>
                                {unassignedRows}
                              </div>
                              );
                            })()}
                            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                              {(() => {
                                const availableExtras = foodItems.filter(fi => fi.storage_type === 'extras' && !testItemIdSet.has(fi.id));
                                const sortedItems = getSortedFoodItems(
                                  availableExtras,
                                  foodSortModes['extras'] || "manual",
                                  sortDirections['food-extras'] !== false
                                );
                                const unselectedDessertExtras = singleIngredientDessertExtras.filter((d) =>
                                  !isDessertExtraInSelections(effExtraSelMerged, d, allSingleIngredientDessertExtras, singleIngredientDessertById),
                                );
                                const catalogDessertExtras = hideDayCalorieTotals
                                  ? unselectedDessertExtras.filter((d) =>
                                      extraFitsRemainingCalories(d.cal, remainingNextCal),
                                    )
                                  : unselectedDessertExtras;
                                const others = sortedItems.filter(fi => !effExtraSelMerged.includes(fi.id));
                                const { above: catalogAbove } = splitSortedExtrasByDivider(
                                  sortedItems,
                                  extrasDividerAfterId,
                                );
                                const aboveIds = new Set(catalogAbove.map((fi) => fi.id));
                                const othersAboveRaw = others.filter((fi) => aboveIds.has(fi.id));
                                const othersAbove = hideDayCalorieTotals
                                  ? othersAboveRaw.filter((fi) =>
                                      extraFitsRemainingCalories(
                                        resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary).cal,
                                        remainingNextCal,
                                      ),
                                    )
                                  : othersAboveRaw;
                                const catalogFilteredEmpty =
                                  hideDayCalorieTotals &&
                                  (othersAboveRaw.length > 0 || unselectedDessertExtras.length > 0) &&
                                  othersAbove.length === 0 &&
                                  catalogDessertExtras.length === 0;
                                const renderRow = (fi: FoodItem) => {
                                  const assignedCount = effExtraSelMerged.filter(id => id === fi.id).length;
                                  const perOccurrence = resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary);
                                  const macros = scaleExtraDisplayMacrosByCount(perOccurrence, assignedCount > 0 ? assignedCount : 1);
                                  // Catalogue : reste dispo ; si déjà pris, #N = quantité assignée.
                                  const qtySubtitle = formatExtraQuantitySubtitle(
                                    fi.grams,
                                    assignedCount > 0
                                      ? assignedCount
                                      : resolveExtraFoodRemainingCount(fi),
                                  );
                                  return (
                                    <div key={fi.id} className={`w-full p-2 rounded-xl border transition-all group flex items-start gap-3 ${assignedCount > 0 ? 'bg-orange-500/20 border-orange-500/40 shadow-inner' : 'bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20'}`}>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-[11px] font-bold transition-colors break-words leading-snug ${assignedCount > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                        {qtySubtitle && (
                                          <p className="text-[9px] text-muted-foreground/60">{qtySubtitle}</p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {assignedCount > 0 && (<>
                                          <button onClick={() => { const u = { ...nextExtraSelections }; const c = u[iso] || u[key] || []; const idx = c.lastIndexOf(fi.id); if (idx >= 0) u[iso] = [...c.slice(0, idx), ...c.slice(idx + 1)]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold">−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{assignedCount}</span>
                                        </>)}
                                        <button onClick={() => { const u = { ...nextExtraSelections }; u[iso] = [...(u[iso] || u[key] || []), fi.id]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold">+</button>
                                        {macros.pro > 0 && (
                                          <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">
                                            🍗 {macros.pro}
                                          </div>
                                        )}
                                        {!hideDayCalorieTotals && macros.cal > 0 && (
                                          <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500">
                                            <Flame className="w-2.5 h-2.5" />
                                            {macros.cal}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                };
                                return (
                                  <>
                                    {catalogDessertExtras.length > 0 && (
                                      <>
                                        <p className="text-[9px] font-semibold text-orange-500 px-1 pb-1">Desserts & Shakers</p>
                                        {catalogDessertExtras.map((d, index) => {
                                          // Catalogue : #N = reste disponible.
                                          const remainingCount = dessertPossibleCountById.get(d.id) ?? 0;
                                          return (
                                          <div key={`next-unselected-dessert-${d.id}-${index}`} className="w-full p-2 rounded-xl border transition-all group flex items-start gap-3 bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20">
                                            <div className="flex-1 min-w-0">
                                              <p className="text-[11px] font-bold transition-colors break-words leading-snug text-foreground group-hover:text-orange-600">{d.name}</p>
                                              <p className="text-[9px] text-muted-foreground/50 font-medium">
                                                {formatExtraRemainingCountLabel(remainingCount)}
                                              </p>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                              <button
                                                onClick={async () => {
                                                  try {
                                                    const ok = await addNextWeekExtraOccurrence(d.id, iso, key);
                                                    if (!ok) {
                                                      toast({
                                                        title: "Stock insuffisant",
                                                        description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                        variant: "destructive",
                                                      });
                                                    }
                                                  } catch {
                                                    toast({
                                                      title: "Stock insuffisant",
                                                      description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                      variant: "destructive",
                                                    });
                                                  }
                                                }}
                                                className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold"
                                              >+</button>
                                              {d.prot > 0 && <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">🍗 {Math.round(d.prot)}</div>}
                                              {!hideDayCalorieTotals && (
                                                <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500"><Flame className="w-2.5 h-2.5" />{Math.round(d.cal)}</div>
                                              )}
                                            </div>
                                          </div>
                                          );
                                        })}
                                        <Separator className="my-2 opacity-50" />
                                      </>
                                    )}
                                    {othersAbove.map(renderRow)}
                                    {catalogFilteredEmpty && (
                                      <p className="text-[10px] text-muted-foreground/70 italic text-center py-2">
                                        Aucun extra dans le budget restant
                                      </p>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                    );
                  })()}
                </div>
                {/* Bande Goûter sous Midi/Soir/Extra — même comportement que la semaine courante */}
                <PlanningGouterBand
                  dayKey={key}
                  dayIso={iso}
                  isOver={dragOverSlot === gouterKIso || dragOverSlot === gouterKKey}
                  gouterDrink={gouterDrink}
                  hasGouterMeals={hasGouterMeals}
                  hideDayCalorieTotals={hideDayCalorieTotals}
                  gouterManualCal={gouterManualCal}
                  gouterManualPro={gouterManualPro}
                  gouterManualFiber={gouterManualFiber}
                  gouterTotalCals={gouterTotalCals}
                  gouterTotalPro={gouterTotalPro}
                  gouterTotalFiber={gouterTotalFiber}
                  gouterAssignedIds={gouterAssignedIds}
                  foodItems={foodItems}
                  dessertById={singleIngredientDessertById}
                  manualCalStorageKey={`next-mc-${iso}-gouter`}
                  manualProStorageKey={`next-mp-${iso}-gouter`}
                  manualFiberStorageKey={`next-mf-${iso}-gouter`}
                  mealCards={gouterMeals.map((pm) => (
                    <div
                      key={pm.id}
                      className="inline-block mr-1 [&>div]:min-w-[132px] [&>div]:!px-3 [&>div]:!py-1.5 [&>div]:text-center [&>div>div]:items-center"
                    >
                      {renderMiniCard(pm, true)}
                    </div>
                  ))}
                  onDragOver={(e) => {
                    const canAccept = !!(
                      draggedSelectedExtraId ||
                      e.dataTransfer.types.includes("text/plain") ||
                      e.dataTransfer.types.includes("pmId")
                    );
                    if (canAccept) e.preventDefault();
                    setDragOverSlot(gouterKIso);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === gouterKIso ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleNextWeekDrop(e, iso, "gouter");
                  }}
                  onToggleDrink={() => {
                    const updated = { ...nextDrinkChecks };
                    if (updated[gouterKIso] || updated[gouterKKey]) {
                      delete updated[gouterKIso];
                      delete updated[gouterKKey];
                    } else {
                      updated[gouterKIso] = true;
                    }
                    setPreference.mutate({ key: "next_week_drink_checks", value: updated });
                  }}
                  onSaveManualCalories={(val) => {
                    const updated = { ...nextManualCalories };
                    if (val > 0) updated[gouterKIso] = val;
                    else {
                      delete updated[gouterKIso];
                      delete updated[gouterKKey];
                    }
                    setPreference.mutate({ key: "next_week_manual_calories", value: updated });
                  }}
                  onSaveManualProteins={(val) => {
                    const updated = { ...nextManualProteins };
                    if (val > 0) updated[gouterKIso] = val;
                    else {
                      delete updated[gouterKIso];
                      delete updated[gouterKKey];
                    }
                    setPreference.mutate({ key: "next_week_manual_proteins", value: updated });
                  }}
                  onSaveManualFibers={(val) => {
                    const updated = { ...nextManualFibers };
                    if (val > 0) updated[gouterKIso] = val;
                    else {
                      delete updated[gouterKIso];
                      delete updated[gouterKKey];
                    }
                    setPreference.mutate({ key: "next_week_manual_fibers", value: updated });
                  }}
                  onDeselectExtra={deselectNextExtraForDay}
                  onDragStartExtra={(extraId, dayIso, dayKey, e) => {
                    setDraggedSelectedExtraId(extraId);
                    setDraggedSelectedExtraOrigin({ iso: dayIso, key: dayKey });
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", extraId);
                  }}
                  onDragEndExtra={() => {
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                  }}
                />
              </div>
            );
          })}
          {/* Total semaine suivante */}
          {(() => {
            let total = 0;
            let totalPro = 0;
            for (const { key, iso } of weekDates) {
              const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
              const eBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? bfSnap?.mealId;
              const eBfMeal = eBfSel?.startsWith('meal:') ? allMealsById.get(eBfSel.slice(5)) : null;
              if (eBfMeal) { total += parseCalories(eBfMeal.calories); totalPro += parseProtein(eBfMeal.protein); }
              else { total += nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? bfSnap?.cal ?? 0; totalPro += nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? bfSnap?.prot ?? 0; }
              for (const time of TIMES) {
                const kIso = `${iso}-${time}`;
                const kKey = `${key}-${time}`;
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                total += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? manualSnap?.cal ?? 0;
                totalPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? manualSnap?.prot ?? 0;
                if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) total += DRINK_CALORIES;
              }
              const extraSnap = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
              total += nextExtraCalories[iso] ?? nextExtraCalories[key] ?? extraSnap?.cal ?? 0;
              totalPro += nextExtraProteins[iso] ?? nextExtraProteins[key] ?? extraSnap?.prot ?? 0;
              const nextExtraSum = sumDayExtras(nextExtraSelections[iso] ?? nextExtraSelections[key] ?? extraSnap?.itemIds ?? []);
              total += nextExtraSum.cal;
              totalPro += nextExtraSum.pro;
            }
            const avgCal = Math.round(total / 7);
            const nextWeekGoalLow = NEXT_DAILY_GOAL_LOW > 0 ? NEXT_DAILY_GOAL_LOW * DEFAULT_WEEKLY_MULTIPLIER : 0;
            const nextWeekGoalHigh = NEXT_DAILY_GOAL * DEFAULT_WEEKLY_MULTIPLIER;
            return (
              <PlanningWeekTotalsFooter
                title="Total prévu"
                weekTotal={total}
                avgCal={avgCal}
                goalLow={NEXT_DAILY_GOAL_LOW}
                goalHigh={NEXT_DAILY_GOAL}
                displayGoalLow={nextWeekGoalLow}
                displayGoalHigh={nextWeekGoalHigh}
                hideDayCalorieTotals={hideDayCalorieTotals}
                weekDayScale={DEFAULT_WEEKLY_MULTIPLIER}
              />
            );
          })()}
        </div>
  );
}
