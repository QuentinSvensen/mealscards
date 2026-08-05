import { Flame, Wheat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BreakfastBreakdownList } from "@/components/planning/BreakfastBreakdownList";
import { PlanningWeekTotalsFooter } from "@/components/planning/PlanningWeekTotalsFooter";
import { DRINK_CALORIES, TIME_LABELS } from "@/components/planning/planningSlotStyles";
import { MAIN_GRID_TIMES } from "@/hooks/useMeals";
import {
  buildBackupBreakfastBreakdownItems,
  getBreakfastButtonLabel,
  getBreakfastMealOnlyBreakdownItems,
  isBackupBreakfastPmAlreadyInMatinSlot,
} from "@/domain/planning/breakfastBreakdown";
import { mergeBackupCardOverrides } from "@/domain/planning/mergeBackupOverrides";
import {
  filterBackupCardsForDisplayDay,
  collectBackupDayKeyVariants,
  pickBackupDayNumber,
  pickBackupDayString,
  pickBackupDayStringArray,
  pickBackupSlotBoolean,
  pickBackupSlotNumber,
  pickBackupSlotStringArray,
  prepareBackupForDisplayWeek,
  resolveArchivedIsoForDisplay,
} from "@/domain/planning/backupWeekAlignment";
import type { PlanningSnapshotEntry, PossibleMealsFullBackup } from "@/domain/planning/types";
import type { PossibleMeal } from "@/types/meals";
import { applySnapshotsToBackupForDisplay } from "@/domain/planning/embedPlanningSnapshotsInBackup";
import {
  mergeRecoveredAndBackupCards,
  recoverPreviousWeekCardsFromLive,
} from "@/domain/planning/recoverPreviousWeekCards";
import { resolveManualSlotMacros } from "@/domain/planning/resolveManualSlotMacros";
import {
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
  getRemainingDayCalories,
  hasCalorieGoalRangeMin,
} from "@/domain/planning/calorieGoalRange";
import {
  getCardDisplayCalories,
  getCardDisplayFiber,
  getCardDisplayProtein,
} from "@/hooks/useCalorieBalance";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { getMealColor } from "@/lib/ingredientUtils";
import { getCategoryEmoji } from "@/components/planning/PlanningMiniCard";
import { scaleExtraDisplayMacrosByCount } from "@/lib/planningExtraMacros";
import {
  groupAssignedExtraIds,
  resolveAssignedExtraForDisplay,
  getAssignedExtraLabel,
  getUnassignedExtraSelectionIds,
  resolveExtraColumnInputDisplayValue,
  resolvePlanningExtraFoodMacros,
} from "@/domain/planning/extraDisplay";
import { parseFoodDessertExtraId } from "@/lib/foodDessertUtils";

export interface PlanningBackupWeekViewProps {
  weekDates: Array<{ key: string; iso: string; display: string }>;
  getPreference: <T>(key: string, fallback: T) => T;
  calOverrides: Record<string, any>;
  proOverrides: Record<string, any>;
  allMealsById: Map<string, Meal>;
  openBackupPlanningCardPopup: (card: any, calOverride?: any, proOverride?: any) => void;
  handleBackupCardOpen: (cardKey: string, open: () => void) => void;
  resolveBackupCardMeal: (card: any) => Meal | null;
  setPopupBreakfast: (v: { meal: any; day: string } | null) => void;
  foodItems: FoodItem[];
  foodMacroIndex: any;
  isAvailableCb: (name: string) => boolean;
  singleIngredientDessertById: Map<string, any>;
  ingredientMacroLibrary: IngredientMacroLibraryItem[] | null | undefined;
  sumDayExtras: (ids: string[]) => { cal: number; pro: number; fiber: number };
  hideDayCalorieTotals: boolean;
  backupTotals: {
    archivedDailyGoal: number;
    archivedDailyGoalLow: number;
    archivedProteinGoal: number;
    archivedFiberGoal: number;
  };
  openExtrasDay: string | null;
  setOpenExtrasDay: React.Dispatch<React.SetStateAction<string | null>>;
  parseCalories: (cal: string | null | undefined) => number;
  parseProtein: (prot: string | null | undefined) => number;
  savedSnapshots: Record<string, PlanningSnapshotEntry>;
  /** Cartes encore en base : servent à récupérer la semaine précédente réelle. */
  possibleMeals: PossibleMeal[];
}

/**
 * Vue lecture seule de la dernière sauvegarde hebdomadaire (weekOffset <= -1).
 */
export function PlanningBackupWeekView({
  weekDates,
  getPreference,
  calOverrides,
  proOverrides,
  allMealsById,
  openBackupPlanningCardPopup,
  handleBackupCardOpen,
  resolveBackupCardMeal,
  setPopupBreakfast,
  foodItems,
  foodMacroIndex,
  isAvailableCb,
  singleIngredientDessertById,
  ingredientMacroLibrary,
  sumDayExtras,
  hideDayCalorieTotals,
  backupTotals,
  openExtrasDay,
  setOpenExtrasDay,
  parseCalories,
  parseProtein,
  savedSnapshots,
  possibleMeals,
}: PlanningBackupWeekViewProps) {
const backupRaw = getPreference<any>('possible_meals_backup', null);
          const recoveredCards = recoverPreviousWeekCardsFromLive(possibleMeals, weekDates);
          if (!backupRaw && recoveredCards.length === 0) return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6 text-center">
              <p className="text-sm text-muted-foreground italic">Aucune sauvegarde disponible</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Une sauvegarde est créée automatiquement lors du reset</p>
            </div>
          );
          const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
          const backupParsed: PossibleMealsFullBackup = isNF
            ? (backupRaw as PossibleMealsFullBackup)
            : {
                cards: Array.isArray(backupRaw) ? backupRaw : [],
                manualCalories: {},
                manualProteins: {},
                manualFibers: {},
                extraCalories: {},
                extraProteins: {},
                extraFibers: {},
                extraSelections: {},
                extraSlotAssignments: {},
                breakfastManualCalories: {},
                breakfastManualProteins: {},
                breakfastSelections: {},
                drinkChecks: {},
                calOverrides: {},
                proOverrides: {},
                daily_goal: null,
                protein_goal: null,
              };
          const backupWithSnapshots = applySnapshotsToBackupForDisplay(
            backupParsed,
            savedSnapshots,
            weekDates,
          );
          const { backup: backupFull, displayToArchivedIso } = prepareBackupForDisplayWeek(
            backupWithSnapshots,
            weekDates,
          );
          const embeddedSnapshots = backupFull.savedSnapshots ?? {};
          const cards: any[] = mergeRecoveredAndBackupCards(
            recoveredCards,
            backupFull.cards ?? [],
            weekDates,
          );

          const resolveBackupDayIso = (displayIso: string): string =>
            resolveArchivedIsoForDisplay(displayIso, displayToArchivedIso);

          const bMC = backupFull.manualCalories || {};
          const bMP = backupFull.manualProteins || {};
          const bMF = backupFull.manualFibers || {};
          const bEC = backupFull.extraCalories || {};
          const bEP = backupFull.extraProteins || {};
          const bEF = backupFull.extraFibers || {};
          const bES = backupFull.extraSelections || {};
          const bESA = backupFull.extraSlotAssignments || {};
          const bBC = backupFull.breakfastManualCalories || {};
          const bBP = backupFull.breakfastManualProteins || {};
          const bBS = backupFull.breakfastSelections || {};
          const bDC = backupFull.drinkChecks || {};
          const bCO = mergeBackupCardOverrides(
            backupFull.calOverrides,
            calOverrides,
            cards.map((c: { id: string }) => c.id),
          );
          const bPO = mergeBackupCardOverrides(
            backupFull.proOverrides,
            proOverrides,
            cards.map((c: { id: string }) => c.id),
          );

          const renderBackupCards = (slotCards: any[]) => slotCards.map((c: any, i: number) => {
            const m = resolveBackupCardMeal(c);
            if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
            const openBackupPopup = () => openBackupPlanningCardPopup(c, bCO[c.id], bPO[c.id]);
            const cardKey = `${c.id}-${i}`;
            const fullPm = { ...c, meals: m };
            const overrideCal = bCO[c.id];
            const overridePro = bPO[c.id];
            // Macros affichées comme sur la semaine courante (prot/fibres même si « Masquer calories »)
            const rawCal = getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
            const rawPro = getCardDisplayProtein(fullPm, overridePro, isAvailableCb, foodItems, foodMacroIndex);
            const rawFiber = getCardDisplayFiber(fullPm, undefined, isAvailableCb, foodItems, foodMacroIndex);
            const displayCal =
              !hideDayCalorieTotals && rawCal > 0 ? String(Math.round(rawCal)) : null;
            const displayPro = rawPro > 0 ? String(Math.round(rawPro)) : null;
            const displayFiber = rawFiber > 0 ? String(Math.round(rawFiber)) : null;
            const hasMacros = Boolean(displayCal || displayPro || displayFiber);
            return (
              <div
                key={i}
                onDoubleClick={openBackupPopup}
                onClick={() => handleBackupCardOpen(cardKey, openBackupPopup)}
                className="w-full min-w-0 overflow-hidden rounded-xl px-2 py-1 text-white text-[9px] sm:text-[10px] font-semibold flex flex-col gap-0.5 cursor-pointer transition-all hover:scale-[1.01]"
                style={{ backgroundColor: getMealColor(m.ingredients?.trim() ? m.ingredients : c.ingredients_override, m.name) }}
                title="Double-clic pour voir le détail"
              >
                <span className="block min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] [word-break:break-word] leading-tight">
                  {getCategoryEmoji(m.category)} {m.name}
                </span>
                {hasMacros && (
                  <div className="flex flex-wrap items-center justify-end gap-0.5 min-w-0 max-w-full">
                    {displayCal && (
                      <span className="text-[9px] sm:text-[10px] font-bold text-white px-1 sm:px-1.5 py-px rounded-full flex items-center gap-0.5 shrink-0 bg-black/30" title="Calories">
                        <Flame className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
                        {displayCal}
                      </span>
                    )}
                    {displayPro && (
                      <span className="text-[9px] sm:text-[10px] font-bold text-white px-1 sm:px-1.5 py-px rounded-full flex items-center justify-center shrink-0 bg-black/30" title="Protéines">
                        🍗 {displayPro}
                      </span>
                    )}
                    {displayFiber && (
                      <span className="text-[9px] sm:text-[10px] font-bold text-white px-1 sm:px-1.5 py-px rounded-full flex items-center justify-center shrink-0 bg-black/30" title="Fibres">
                        <Wheat className="h-2 w-2 sm:h-2.5 sm:w-2.5 mr-0.5" />
                        {displayFiber}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          });

          const dailyTotals: number[] = [];
          const dailyProteins: number[] = [];
          const dailyFibers: number[] = [];

          return (
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">📋 Lecture seule — Dernière sauvegarde avant reset</p>
              </div>
              {weekDates.map(({ key, iso, display }) => {
                const bIso = resolveBackupDayIso(iso);
                const bKey = key;
                const dayVariants = collectBackupDayKeyVariants(iso, key, bIso);
                const dayCards = filterBackupCardsForDisplayDay(cards, iso, key, bIso);
                const midiCards = dayCards.filter((c: any) => c.meal_time === 'midi');
                const soirCards = dayCards.filter((c: any) => c.meal_time === 'soir');
                const matinCards = dayCards.filter((c: any) => c.meal_time === 'matin');
                const gouterCards = dayCards.filter((c: any) => c.meal_time === 'gouter');

                // Current totals will be calculated below from slot values

                let bfSlotCal = 0, bfSlotPro = 0, bfSlotFiber = 0;
                let midiSlotCal = 0, midiSlotPro = 0, midiSlotFiber = 0;
                let soirSlotCal = 0, soirSlotPro = 0, soirSlotFiber = 0;
                let gouterSlotCal = 0, gouterSlotPro = 0, gouterSlotFiber = 0;

                const processCards = (slotCards: any[]) => {
                  let cals = 0, pros = 0, fibers = 0;
                  for (const c of slotCards) {
                    const m = resolveBackupCardMeal(c);
                    if (!m) continue;
                    const overrideCal = bCO[c.id];
                    const overridePro = bPO[c.id];
                    const fullPm = { ...c, meals: m };
                    cals += getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
                    pros += getCardDisplayProtein(fullPm, overridePro, isAvailableCb, foodItems, foodMacroIndex);
                    fibers += getCardDisplayFiber(fullPm, undefined, isAvailableCb, foodItems, foodMacroIndex);
                  }
                  return { cals, pros, fibers };
                };

                const bfSel = pickBackupDayString(bBS, dayVariants);
                if (bfSel?.startsWith('meal:')) {
                  const m = allMealsById.get(bfSel.slice(5)) ?? null;
                  if (m) { bfSlotCal += parseCalories(m.calories); bfSlotPro += parseProtein(m.protein); }
                } else if (bfSel?.startsWith('pm:')) {
                  const pm = cards.find(c => c.id === bfSel.slice(3));
                  if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, bIso, bKey, matinCards)) {
                    const m = resolveBackupCardMeal(pm);
                    const fullPm = m ? { ...pm, meals: m } : pm;
                    bfSlotCal += getCardDisplayCalories(fullPm, bCO[pm.id], isAvailableCb);
                    bfSlotPro += getCardDisplayProtein(fullPm, bPO[pm.id], isAvailableCb, foodItems, foodMacroIndex);
                    bfSlotFiber += getCardDisplayFiber(fullPm, undefined, isAvailableCb, foodItems, foodMacroIndex);
                  }
                } else {
                  bfSlotCal += pickBackupDayNumber(bBC, dayVariants);
                  bfSlotPro += pickBackupDayNumber(bBP, dayVariants);
                }

                const matinAssignedIds = pickBackupSlotStringArray(bESA, "matin", dayVariants);
                const midiAssignedIds = pickBackupSlotStringArray(bESA, "midi", dayVariants);
                const soirAssignedIds = pickBackupSlotStringArray(bESA, "soir", dayVariants);
                const gouterAssignedIds = pickBackupSlotStringArray(bESA, "gouter", dayVariants);
                const matinAssigned = sumDayExtras(matinAssignedIds);
                const midiAssigned = sumDayExtras(midiAssignedIds);
                const soirAssigned = sumDayExtras(soirAssignedIds);
                const gouterAssigned = sumDayExtras(gouterAssignedIds);

                const resMatin = processCards(matinCards);
                bfSlotCal += resMatin.cals + matinAssigned.cal;
                bfSlotPro += resMatin.pros + matinAssigned.pro;
                bfSlotFiber += resMatin.fibers + matinAssigned.fiber;

                const resMidi = processCards(midiCards);
                midiSlotCal = resMidi.cals + midiAssigned.cal;
                midiSlotPro = resMidi.pros + midiAssigned.pro;
                midiSlotFiber = resMidi.fibers + midiAssigned.fiber;
                if (midiCards.length === 0) {
                  const midiManual = resolveManualSlotMacros(
                    { calories: bMC, proteins: bMP, fibers: bMF },
                    embeddedSnapshots,
                    iso,
                    key,
                    "midi",
                  );
                  midiSlotCal += midiManual.cal;
                  midiSlotPro += midiManual.prot;
                  midiSlotFiber += midiManual.fiber;
                }
                if (pickBackupSlotBoolean(bDC, "midi", dayVariants)) midiSlotCal += DRINK_CALORIES;

                const resSoir = processCards(soirCards);
                soirSlotCal = resSoir.cals + soirAssigned.cal;
                soirSlotPro = resSoir.pros + soirAssigned.pro;
                soirSlotFiber = resSoir.fibers + soirAssigned.fiber;
                if (soirCards.length === 0) {
                  const soirManual = resolveManualSlotMacros(
                    { calories: bMC, proteins: bMP, fibers: bMF },
                    embeddedSnapshots,
                    iso,
                    key,
                    "soir",
                  );
                  soirSlotCal += soirManual.cal;
                  soirSlotPro += soirManual.prot;
                  soirSlotFiber += soirManual.fiber;
                }
                if (pickBackupSlotBoolean(bDC, "soir", dayVariants)) soirSlotCal += DRINK_CALORIES;

                const resGouter = processCards(gouterCards);
                gouterSlotCal = resGouter.cals + gouterAssigned.cal;
                gouterSlotPro = resGouter.pros + gouterAssigned.pro;
                gouterSlotFiber = resGouter.fibers + gouterAssigned.fiber;
                if (gouterCards.length === 0) {
                  const gouterManual = resolveManualSlotMacros(
                    { calories: bMC, proteins: bMP, fibers: bMF },
                    embeddedSnapshots,
                    iso,
                    key,
                    "gouter",
                  );
                  gouterSlotCal += gouterManual.cal;
                  gouterSlotPro += gouterManual.prot;
                  gouterSlotFiber += gouterManual.fiber;
                }
                if (pickBackupSlotBoolean(bDC, "gouter", dayVariants)) gouterSlotCal += DRINK_CALORIES;

                let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal + gouterSlotCal;
                let dayPro = bfSlotPro + midiSlotPro + soirSlotPro + gouterSlotPro;
                let dayFiber = bfSlotFiber + midiSlotFiber + soirSlotFiber + gouterSlotFiber;

                const backupExtraIds = pickBackupDayStringArray(bES, dayVariants);
                dayTotal += pickBackupDayNumber(bEC, dayVariants);
                dayPro += pickBackupDayNumber(bEP, dayVariants);
                dayFiber += pickBackupDayNumber(bEF, dayVariants);
                const backupExtraSum = sumDayExtras(backupExtraIds);
                const backupAssignedExtraCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                const backupAssignedExtraPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                const backupAssignedExtraFiber =
                  matinAssigned.fiber + midiAssigned.fiber + soirAssigned.fiber + gouterAssigned.fiber;
                const backupUnassignedExtraCal = Math.max(0, backupExtraSum.cal - backupAssignedExtraCal);
                const backupUnassignedExtraPro = Math.max(0, backupExtraSum.pro - backupAssignedExtraPro);
                const backupUnassignedExtraFiber = Math.max(0, backupExtraSum.fiber - backupAssignedExtraFiber);
                dayTotal += backupUnassignedExtraCal;
                dayPro += backupUnassignedExtraPro;
                dayFiber += backupUnassignedExtraFiber;

                dailyTotals.push(dayTotal);
                dailyProteins.push(dayPro);
                dailyFibers.push(dayFiber);
                const backupBreakfastCard = matinCards.length === 1
                  ? matinCards[0]
                  : bfSel?.startsWith('pm:')
                    ? cards.find((c: any) => c.id === bfSel.slice(3))
                    : null;
                const backupBreakfastMeal = backupBreakfastCard
                  ? resolveBackupCardMeal(backupBreakfastCard)
                  : bfSel?.startsWith('meal:')
                    ? allMealsById.get(bfSel.slice(5)) ?? null
                    : null;
                const openBackupBreakfastPopup = () => {
                  if (backupBreakfastCard) {
                    openBackupPlanningCardPopup(backupBreakfastCard, bCO[backupBreakfastCard.id], bPO[backupBreakfastCard.id]);
                    return;
                  }
                  if (backupBreakfastMeal) setPopupBreakfast({ meal: backupBreakfastMeal, day: iso });
                };

                return (
                  <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                      <div className="flex items-center gap-1">
                        {(() => {
                          const bfSelLabel = bfSel;
                          const breakfastBreakdownItems = buildBackupBreakfastBreakdownItems({
                            key: bKey,
                            iso,
                            matinCards,
                            bfSel: bfSelLabel,
                            cards,
                            breakfastManualCalories: bBC,
                            breakfastManualProteins: bBP,
                            calOverrides: bCO,
                            proOverrides: bPO,
                            matinAssignedIds,
                            mealsById: allMealsById,
                            foodItems,
                            isAvailable: isAvailableCb,
                            foodMacroIndex,
                          });
                          const breakfastLabel = getBreakfastButtonLabel(breakfastBreakdownItems);
                          const mealOnlyBreakdown = getBreakfastMealOnlyBreakdownItems(breakfastBreakdownItems);

                          if (mealOnlyBreakdown.length > 1) {
                            return (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full font-semibold cursor-pointer hover:bg-muted/80"
                                    title="Voir le détail des petits déjeuners"
                                  >
                                    {breakfastLabel}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56 p-2" align="start">
                                  <BreakfastBreakdownList
                                    items={breakfastBreakdownItems}
                                    totalCal={bfSlotCal}
                                    totalPro={bfSlotPro}
                                  />
                                </PopoverContent>
                              </Popover>
                            );
                          }

                          return (
                            <span
                              onDoubleClick={backupBreakfastMeal ? openBackupBreakfastPopup : undefined}
                              onClick={() => {
                                if (backupBreakfastMeal) handleBackupCardOpen(`bf-${iso}`, openBackupBreakfastPopup);
                              }}
                              className={`text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full font-semibold ${backupBreakfastMeal ? 'cursor-pointer hover:bg-muted/80' : ''}`}
                              title={backupBreakfastMeal ? "Double-clic pour voir le détail" : undefined}
                            >
                              {breakfastLabel}
                            </span>
                          );
                        })()}
                        {(bfSlotCal > 0 || bfSlotPro > 0) && !hideDayCalorieTotals && (
                          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-5">
                            {bfSlotCal > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Flame className="w-2 h-2 text-orange-500/60" />
                                {Math.round(bfSlotCal)}
                              </span>
                            )}
                            {bfSlotCal > 0 && bfSlotPro > 0 && <span className="opacity-30">•</span>}
                            {bfSlotPro > 0 && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] opacity-60">🍗</span>
                                {Math.round(bfSlotPro)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-1" />
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                        <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                          <Flame className="h-2.5 w-2.5 text-orange-500" />
                          <span className={getCalorieRangeTotalColorClass(dayTotal, backupTotals.archivedDailyGoalLow, backupTotals.archivedDailyGoal) ?? undefined}>
                            {hideDayCalorieTotals ? "Calories" : Math.round(dayTotal)}
                          </span>
                          {" "}
                          <span className="text-muted-foreground/50 font-normal">/ {formatCalorieGoalTarget(backupTotals.archivedDailyGoalLow, backupTotals.archivedDailyGoal)}</span>
                        </span>
                        {dayTotal > 0 && !hideDayCalorieTotals && !hasCalorieGoalRangeMin(backupTotals.archivedDailyGoalLow, backupTotals.archivedDailyGoal) && (
                          <span className={`text-[10px] font-bold whitespace-nowrap ${getRemainingDayCalories(backupTotals.archivedDailyGoal, dayTotal) > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                            {getRemainingDayCalories(backupTotals.archivedDailyGoal, dayTotal) > 0 ? `reste ${Math.round(getRemainingDayCalories(backupTotals.archivedDailyGoal, dayTotal))}` : `+${Math.round(dayTotal - backupTotals.archivedDailyGoal)}`}
                          </span>
                        )}
                        {dayPro > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                            🍗 {Math.round(dayPro)} <span className="text-blue-400/50 font-normal">/ {backupTotals.archivedProteinGoal}</span>
                          </span>
                        )}
                        {dayPro > 0 && (
                          <span className={`text-[10px] font-bold whitespace-nowrap ${backupTotals.archivedProteinGoal - dayPro > 0 ? 'text-blue-400/60' : 'text-blue-500'}`}>
                            {backupTotals.archivedProteinGoal - dayPro > 0 ? `reste ${Math.round(backupTotals.archivedProteinGoal - dayPro)}` : `+${Math.round(dayPro - backupTotals.archivedProteinGoal)}`}
                          </span>
                        )}
                        {dayFiber > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                            <Wheat className="h-2.5 w-2.5" />
                            {Math.round(dayFiber)} <span className="text-emerald-400/50 font-normal">/ {backupTotals.archivedFiberGoal}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 sm:gap-3">
                      {MAIN_GRID_TIMES.map(time => {
                        const slotCards = dayCards.filter((c: any) => c.meal_time === time);
                        const hasDrink = pickBackupSlotBoolean(bDC, time, dayVariants);
                        return (
                          <div key={time} className="min-w-0 min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-border/55 bg-background/10 p-1 sm:p-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                                {hasDrink && (
                                  <span className="flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">🥤 +{DRINK_CALORIES}</span>
                                )}
                              </div>
                              {(() => {
                                const sCal = time === 'midi' ? midiSlotCal : soirSlotCal;
                                const sPro = time === 'midi' ? midiSlotPro : soirSlotPro;
                                if (hideDayCalorieTotals || (sCal <= 0 && sPro <= 0)) return null;
                                return (
                                  <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-4 sm:h-5">
                                    {sCal > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <Flame className="w-2 h-2 text-orange-500/60" />
                                        {Math.round(sCal)}
                                      </span>
                                    )}
                                    {sCal > 0 && sPro > 0 && <span className="opacity-30">•</span>}
                                    {sPro > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <span className="text-[9px] opacity-60">🍗</span>
                                        {Math.round(sPro)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="mt-0.5 space-y-1">
                              {slotCards.length === 0 ? (
                                <div className="flex flex-col items-start gap-0.5 opacity-60">
                                  {(() => {
                                    const slotManual = resolveManualSlotMacros(
                                      { calories: bMC, proteins: bMP, fibers: bMF },
                                      embeddedSnapshots,
                                      iso,
                                      key,
                                      time,
                                    );
                                    return (
                                      <>
                                        <div className="text-[10px] text-muted-foreground px-1">{slotManual.cal} kcal</div>
                                        <div className="text-[10px] text-blue-400 px-1">{slotManual.prot} prot</div>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                                renderBackupCards(slotCards)
                              )}
                              {(() => {
                                const slotAssignedIds =
                                  time === "midi" ? midiAssignedIds : soirAssignedIds;
                                if (slotAssignedIds.length === 0) return null;
                                return (
                                  <div className="flex flex-wrap gap-1">
                                    {groupAssignedExtraIds(slotAssignedIds).map(({ id: extraId, count }, index) => {
                                      const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, singleIngredientDessertById);
                                      if (!resolved) return null;
                                      const { custom, fi } = resolved;
                                      return (
                                        <span
                                          key={`backup-${time}-assigned-${extraId}-${index}-${count}`}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25"
                                        >
                                          {getAssignedExtraLabel(extraId, count, custom, fi ?? undefined, foodItems, singleIngredientDessertById)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                      {/* Extra column — clic pour voir les extras non déplacés (lecture seule) */}
                      <Popover
                        open={openExtrasDay === `backup-${iso}`}
                        onOpenChange={(open) => setOpenExtrasDay(open ? `backup-${iso}` : null)}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/45 bg-orange-500/3 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center cursor-pointer hover:bg-orange-500/10 transition-colors"
                            title="Voir les extras non déplacés"
                          >
                            <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                            <div className="flex flex-col items-center gap-1 mt-1 w-full opacity-60">
                              {(() => {
                                const sel = sumDayExtras(backupExtraIds);
                                const assignedCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                                const assignedPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                                const assignedFiber = matinAssigned.fiber + midiAssigned.fiber + soirAssigned.fiber + gouterAssigned.fiber;
                                const extraCal = Math.max(0, sel.cal - assignedCal);
                                const extraPro = Math.max(0, sel.pro - assignedPro);
                                const extraFiber = Math.max(0, sel.fiber - assignedFiber);
                                const manualExtraCal = pickBackupDayNumber(bEC, dayVariants);
                                const manualExtraPro = pickBackupDayNumber(bEP, dayVariants);
                                const manualExtraFib = pickBackupDayNumber(bEF, dayVariants);
                                const displayCal = resolveExtraColumnInputDisplayValue(
                                  manualExtraCal,
                                  extraCal,
                                  hideDayCalorieTotals,
                                );
                                const displayPro = resolveExtraColumnInputDisplayValue(
                                  manualExtraPro,
                                  extraPro,
                                  hideDayCalorieTotals,
                                );
                                const displayFib = resolveExtraColumnInputDisplayValue(
                                  manualExtraFib,
                                  extraFiber,
                                  hideDayCalorieTotals,
                                );
                                return (
                                  <>
                                    <div className="text-[10px] text-orange-400 font-bold w-full text-center">
                                      {displayCal > 0 ? Math.round(displayCal) : ""}
                                    </div>
                                    <div className="text-[10px] text-blue-400 font-bold w-full text-center">
                                      {displayPro > 0 ? Math.round(displayPro) : ""}
                                    </div>
                                    <div className="text-[10px] text-emerald-400 font-bold w-full text-center">
                                      {displayFib > 0 ? Math.round(displayFib) : ""}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[min(28rem,calc(100vw-1.5rem))] p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl max-h-[56vh]"
                          align="center"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                        >
                          {(() => {
                            const backupUnassignedIds = getUnassignedExtraSelectionIds(bES, bESA, iso, key);
                            const manualCal = pickBackupDayNumber(bEC, dayVariants);
                            const manualPro = pickBackupDayNumber(bEP, dayVariants);
                            const manualFib = pickBackupDayNumber(bEF, dayVariants);
                            const hasVisibleManual =
                              manualFib > 0 ||
                              manualPro > 0 ||
                              (!hideDayCalorieTotals && manualCal > 0);
                            const hasUnassigned = backupUnassignedIds.length > 0;

                            if (!hasUnassigned && !hasVisibleManual) {
                              return (
                                <p className="text-[10px] text-muted-foreground italic text-center py-3">
                                  Aucun extra non déplacé
                                </p>
                              );
                            }

                            return (
                              <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1 custom-scrollbar">
                                {hasUnassigned && (
                                  <>
                                    <p className="text-[9px] font-semibold text-orange-500 px-1 pb-1">Extras non déplacés</p>
                                    {groupAssignedExtraIds(backupUnassignedIds).map(({ id: extraId, count }, index) => {
                                      const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, singleIngredientDessertById);
                                      if (!resolved) return null;
                                      const { custom, fi } = resolved;
                                      const dessertExtra = singleIngredientDessertById.get(extraId);
                                      const isFoodDessert = !!parseFoodDessertExtraId(extraId);
                                      const perOccurrence = custom
                                        ? { cal: custom.cal, pro: custom.prot, fiber: custom.fiber || dessertExtra?.fiber || 0 }
                                        : fi
                                          ? resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary, { asDessertFood: isFoodDessert })
                                          : { cal: 0, pro: 0, fiber: 0 };
                                      const portionMacros = scaleExtraDisplayMacrosByCount(perOccurrence, count);
                                      const prot = portionMacros.pro;
                                      const cal = portionMacros.cal;
                                      const fiber = portionMacros.fiber;
                                      const label = getAssignedExtraLabel(
                                        extraId,
                                        count,
                                        custom,
                                        fi ?? undefined,
                                        foodItems,
                                        singleIngredientDessertById,
                                      );
                                      return (
                                        <div
                                          key={`backup-extra-sel-${extraId}-${index}`}
                                          className="w-full my-0.5 p-2.5 rounded-2xl border flex items-center gap-3 bg-orange-500/10 border-orange-500/20"
                                        >
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-black break-words leading-snug text-orange-600">{label}</p>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0">
                                            <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                            {prot > 0 && (
                                              <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">
                                                🍗 {prot}
                                              </div>
                                            )}
                                            {fiber > 0 && (
                                              <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-emerald-500 border border-emerald-500/20">
                                                <Wheat className="w-2.5 h-2.5" />{Math.round(fiber)}
                                              </div>
                                            )}
                                            {!hideDayCalorieTotals && cal > 0 && (
                                              <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20">
                                                <Flame className="w-2.5 h-2.5" />{cal}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                                {hasVisibleManual && (
                                  <p className="text-[10px] text-muted-foreground px-1 pt-1 border-t border-white/5">
                                    <span className="font-semibold text-foreground/80">Ajout manuel : </span>
                                    {!hideDayCalorieTotals && manualCal > 0 && (
                                      <span className="text-orange-500 font-bold">{Math.round(manualCal)} kcal</span>
                                    )}
                                    {!hideDayCalorieTotals && manualCal > 0 && manualPro > 0 && (
                                      <span className="text-muted-foreground/50"> · </span>
                                    )}
                                    {manualPro > 0 && (
                                      <span className="text-blue-400 font-bold">{Math.round(manualPro)} prot</span>
                                    )}
                                    {(manualFib > 0) && (manualPro > 0 || (!hideDayCalorieTotals && manualCal > 0)) && (
                                      <span className="text-muted-foreground/50"> · </span>
                                    )}
                                    {manualFib > 0 && (
                                      <span className="text-emerald-400 font-bold">{Math.round(manualFib)} fib</span>
                                    )}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="mt-1.5 min-h-[34px] rounded-xl border border-dashed border-orange-300/45 bg-orange-500/3 p-0.5 sm:p-1 flex items-center">
                      <div className="flex items-center gap-1 sm:gap-2 flex-wrap w-full">
                        <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Goûter</span>
                        {pickBackupSlotBoolean(bDC, "gouter", dayVariants) && (
                          <span className="flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">🥤 +{DRINK_CALORIES}</span>
                        )}
                        {gouterCards.length === 0 && (
                          (() => {
                            const gouterManual = resolveManualSlotMacros(
                              { calories: bMC, proteins: bMP, fibers: bMF },
                              embeddedSnapshots,
                              iso,
                              key,
                              "gouter",
                            );
                            return (
                              <>
                                <div className="text-[10px] text-muted-foreground px-1 opacity-60">{gouterManual.cal} kcal</div>
                                <div className="text-[10px] text-blue-400 px-1 opacity-60">{gouterManual.prot} prot</div>
                              </>
                            );
                          })()
                        )}
                        {gouterCards.length > 0 && (
                          <div className="w-1/3 min-w-0 max-w-[33%] shrink-0">
                            {renderBackupCards(gouterCards)}
                          </div>
                        )}
                        {gouterAssignedIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {groupAssignedExtraIds(gouterAssignedIds).map(({ id: extraId, count }, index) => {
                              const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, singleIngredientDessertById);
                              if (!resolved) return null;
                              const { custom, fi } = resolved;
                              return (
                                <span
                                  key={`backup-gouter-assigned-${extraId}-${index}-${count}`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25"
                                >
                                  {getAssignedExtraLabel(extraId, count, custom, fi ?? undefined, foodItems, singleIngredientDessertById)}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {(gouterSlotCal > 0 || gouterSlotPro > 0) && !hideDayCalorieTotals && (
                          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm">
                            {gouterSlotCal > 0 && <span className="flex items-center gap-0.5"><Flame className="w-2 h-2 text-orange-500/60" />{Math.round(gouterSlotCal)}</span>}
                            {gouterSlotCal > 0 && gouterSlotPro > 0 && <span className="opacity-30">•</span>}
                            {gouterSlotPro > 0 && <span className="flex items-center gap-0.5"><span className="text-[9px] opacity-60">🍗</span>{Math.round(gouterSlotPro)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total calorique de la semaine (Backup) */}
              {(() => {
                const weekTotalCals = dailyTotals.reduce((a, b) => a + b, 0);
                const processedDays = dailyTotals.length;
                const avgCal = processedDays > 0 ? Math.round(weekTotalCals / processedDays) : 0;
                const weekGoalHigh = backupTotals.archivedDailyGoal * 7;
                const weekGoalLow = backupTotals.archivedDailyGoalLow > 0 ? backupTotals.archivedDailyGoalLow * 7 : 0;
                return (
                  <PlanningWeekTotalsFooter
                    title="Total semaine"
                    weekTotal={weekTotalCals}
                    avgCal={avgCal}
                    avgDaysLabel={`${processedDays}j`}
                    goalLow={backupTotals.archivedDailyGoalLow}
                    goalHigh={backupTotals.archivedDailyGoal}
                    displayGoalLow={weekGoalLow > 0 ? weekGoalLow : undefined}
                    displayGoalHigh={weekGoalHigh}
                    hideDayCalorieTotals={hideDayCalorieTotals}
                    weekDayScale={7}
                  />
                );
              })()}
            </div>
          );
}
