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
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
  getRemainingDayCalories,
  hasCalorieGoalRangeMin,
} from "@/domain/planning/calorieGoalRange";
import {
  getCardDisplayCalories,
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
  backupTotals: { archivedDailyGoal: number; archivedDailyGoalLow: number; archivedProteinGoal: number };
  openExtrasDay: string | null;
  setOpenExtrasDay: React.Dispatch<React.SetStateAction<string | null>>;
  parseCalories: (cal: string | null | undefined) => number;
  parseProtein: (prot: string | null | undefined) => number;
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
}: PlanningBackupWeekViewProps) {
const backupRaw = getPreference<any>('possible_meals_backup', null);
          if (!backupRaw) return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6 text-center">
              <p className="text-sm text-muted-foreground italic">Aucune sauvegarde disponible</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Une sauvegarde est créée automatiquement lors du reset</p>
            </div>
          );
          const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
          const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);

          // Construit le mapping index-jour (lun=0…dim=6) → ISO de la semaine archivée,
          // pour afficher les cartes même si les ISO du backup diffèrent de la semaine affichée.
          const backupDayIndexToIso: Record<number, string> = {};
          if (isNF && backupRaw.weekStartISO) {
            const start = new Date(`${backupRaw.weekStartISO}T12:00:00`);
            for (let i = 0; i < 7; i++) {
              const d = new Date(start);
              d.setDate(d.getDate() + i);
              const iso = d.toISOString().split('T')[0];
              const dow = d.getDay(); // 0=dim
              const idx = dow === 0 ? 6 : dow - 1; // lun=0…dim=6
              backupDayIndexToIso[idx] = iso;
            }
          }

          // Retourne l'ISO archivé correspondant au jour affiché (par index ou par clé/ISO direct).
          const resolveBackupDayIso = (displayIso: string, displayKey: string): string => {
            // Chercher d'abord une correspondance directe (même semaine de backup)
            const directMatch = cards.some((c: any) => c.day_of_week === displayIso || c.day_of_week === displayKey);
            if (directMatch) return displayIso;
            // Sinon, mapper par position dans la semaine
            const d = new Date(`${displayIso}T12:00:00`);
            const dow = d.getDay();
            const idx = dow === 0 ? 6 : dow - 1;
            return backupDayIndexToIso[idx] ?? displayIso;
          };
          const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
          const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
          const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
          const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
          const bES = isNF ? (backupRaw.extraSelections || {}) : {};
          const bESA = isNF ? (backupRaw.extraSlotAssignments || {}) : {};
          const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
          const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
          const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
          const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
          const bCO = isNF
            ? mergeBackupCardOverrides(backupRaw.calOverrides, calOverrides, cards.map((c: { id: string }) => c.id))
            : {};
          const bPO = isNF
            ? mergeBackupCardOverrides(backupRaw.proOverrides, proOverrides, cards.map((c: { id: string }) => c.id))
            : {};

          const renderBackupCards = (slotCards: any[]) => slotCards.map((c: any, i: number) => {
            const m = allMealsById.get(c.meal_id);
            if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
            const openBackupPopup = () => openBackupPlanningCardPopup(c, bCO[c.id], bPO[c.id]);
            const cardKey = `${c.id}-${i}`;
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
                {bCO[c.id] && !hideDayCalorieTotals && <span className="self-end opacity-80 shrink-0 leading-none">🔥{bCO[c.id]}</span>}
                {bPO[c.id] && <span className="self-end opacity-80 shrink-0 leading-none">🍗{bPO[c.id]}</span>}
              </div>
            );
          });

          const dailyTotals: number[] = [];
          const dailyProteins: number[] = [];

          return (
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">📋 Lecture seule — Dernière sauvegarde avant reset</p>
              </div>
              {weekDates.map(({ key, iso, display }) => {
                // bIso = ISO du jour dans la semaine archivée (peut différer de iso si reset entre-temps)
                const bIso = resolveBackupDayIso(iso, key);
                const bKey = key; // la clé jour (lundi, mardi…) reste la même
                const dayCards = cards.filter((c: any) => c.day_of_week === bIso || c.day_of_week === bKey);
                const midiCards = dayCards.filter((c: any) => c.meal_time === 'midi');
                const soirCards = dayCards.filter((c: any) => c.meal_time === 'soir');
                const matinCards = dayCards.filter((c: any) => c.meal_time === 'matin');
                const gouterCards = dayCards.filter((c: any) => c.meal_time === 'gouter');

                // Current totals will be calculated below from slot values

                let bfSlotCal = 0, bfSlotPro = 0;
                let midiSlotCal = 0, midiSlotPro = 0;
                let soirSlotCal = 0, soirSlotPro = 0;
                let gouterSlotCal = 0, gouterSlotPro = 0;

                // Calcul du petit déjeuner
                const bfSel = bBS[bIso] || bBS[bKey];
                if (bfSel?.startsWith('meal:')) {
                  const m = allMealsById.get(bfSel.slice(5));
                  if (m) { bfSlotCal += parseCalories(m.calories); bfSlotPro += parseProtein(m.protein); }
                } else if (bfSel?.startsWith('pm:')) {
                  const pm = cards.find(c => c.id === bfSel.slice(3));
                  if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, bIso, bKey, matinCards)) {
                    const m = allMealsById.get(pm.meal_id);
                    const fullPm = m ? { ...pm, meals: m } : pm;
                    bfSlotCal += getCardDisplayCalories(fullPm, bCO[pm.id], isAvailableCb);
                    bfSlotPro += getCardDisplayProtein(fullPm, bPO[pm.id], isAvailableCb, foodItems, foodMacroIndex);
                  }
                } else {
                  bfSlotCal += (bBC[bIso] || bBC[bKey] || 0);
                  const bfManualPro = isNF ? (backupRaw.breakfastManualProteins?.[bIso] || backupRaw.breakfastManualProteins?.[bKey] || 0) : 0;
                  bfSlotPro += bfManualPro;
                }

                // Calculs des cartes et des créneaux (slots)
                const processCards = (slotCards: any[]) => {
                  let cals = 0, pros = 0;
                  for (const c of slotCards) {
                    const m = allMealsById.get(c.meal_id);
                    if (!m) continue;
                    const overrideCal = bCO[c.id];
                    const overridePro = bPO[c.id];
                    const fullPm = { ...c, meals: m };
                    cals += getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
                    pros += getCardDisplayProtein(fullPm, overridePro, isAvailableCb, foodItems, foodMacroIndex);
                  }
                  return { cals, pros };
                };

                const matinAssignedIds = bESA[`${bIso}-matin`] ?? bESA[`${bKey}-matin`] ?? [];
                const midiAssignedIds = bESA[`${bIso}-midi`] ?? bESA[`${bKey}-midi`] ?? [];
                const soirAssignedIds = bESA[`${bIso}-soir`] ?? bESA[`${bKey}-soir`] ?? [];
                const gouterAssignedIds = bESA[`${bIso}-gouter`] ?? bESA[`${bKey}-gouter`] ?? [];
                const matinAssigned = sumDayExtras(matinAssignedIds);
                const midiAssigned = sumDayExtras(midiAssignedIds);
                const soirAssigned = sumDayExtras(soirAssignedIds);
                const gouterAssigned = sumDayExtras(gouterAssignedIds);

                const resMatin = processCards(matinCards);
                bfSlotCal += resMatin.cals + matinAssigned.cal;
                bfSlotPro += resMatin.pros + matinAssigned.pro;

                const resMidi = processCards(midiCards);
                midiSlotCal = resMidi.cals + midiAssigned.cal;
                midiSlotPro = resMidi.pros + midiAssigned.pro;
                if (midiCards.length === 0) { midiSlotCal += (bMC[`${bIso}-midi`] || bMC[`${bKey}-midi`] || 0); midiSlotPro += (bMP[`${bIso}-midi`] || bMP[`${bKey}-midi`] || 0); }
                if (bDC[`${bIso}-midi`] || bDC[`${bKey}-midi`]) midiSlotCal += DRINK_CALORIES;

                const resSoir = processCards(soirCards);
                soirSlotCal = resSoir.cals + soirAssigned.cal;
                soirSlotPro = resSoir.pros + soirAssigned.pro;
                if (soirCards.length === 0) { soirSlotCal += (bMC[`${bIso}-soir`] || bMC[`${bKey}-soir`] || 0); soirSlotPro += (bMP[`${bIso}-soir`] || bMP[`${bKey}-soir`] || 0); }
                if (bDC[`${bIso}-soir`] || bDC[`${bKey}-soir`]) soirSlotCal += DRINK_CALORIES;

                const resGouter = processCards(gouterCards);
                gouterSlotCal = resGouter.cals + gouterAssigned.cal;
                gouterSlotPro = resGouter.pros + gouterAssigned.pro;
                if (gouterCards.length === 0) {
                  gouterSlotCal += (bMC[`${bIso}-gouter`] || bMC[`${bKey}-gouter`] || 0);
                  gouterSlotPro += (bMP[`${bIso}-gouter`] || bMP[`${bKey}-gouter`] || 0);
                }
                if (bDC[`${bIso}-gouter`] || bDC[`${bKey}-gouter`]) gouterSlotCal += DRINK_CALORIES;

                let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal + gouterSlotCal;
                let dayPro = bfSlotPro + midiSlotPro + soirSlotPro + gouterSlotPro;

                // Extras (sauvegarde : mêmes ids que le planning courant, y compris extras saisis à la main)
                dayTotal += (bEC[bIso] || bEC[bKey] || 0);
                dayPro += (bEP[bIso] || bEP[bKey] || 0);
                const backupExtraSum = sumDayExtras(bES[bIso] || bES[bKey]);
                const backupAssignedExtraCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                const backupAssignedExtraPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                const backupUnassignedExtraCal = Math.max(0, backupExtraSum.cal - backupAssignedExtraCal);
                const backupUnassignedExtraPro = Math.max(0, backupExtraSum.pro - backupAssignedExtraPro);
                dayTotal += backupUnassignedExtraCal;
                dayPro += backupUnassignedExtraPro;

                // Le calcul des boissons est déjà inclus dans les totaux des créneaux (slots)

                dailyTotals.push(dayTotal);
                dailyProteins.push(dayPro);
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
                          const bfSelLabel = bBS[bIso] || bBS[bKey];
                          const breakfastBreakdownItems = buildBackupBreakfastBreakdownItems({
                            key: bKey,
                            iso: bIso,
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
                      </div>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 sm:gap-3">
                      {MAIN_GRID_TIMES.map(time => {
                        const slotCards = dayCards.filter((c: any) => c.meal_time === time);
                        const kIso = `${iso}-${time}`;
                        const kKey = `${key}-${time}`;
                        return (
                          <div key={time} className="min-w-0 min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-border/55 bg-background/10 p-1 sm:p-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                                {(bDC[kIso] || bDC[kKey]) && (
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
                                  <div className="text-[10px] text-muted-foreground px-1">{bMC[kIso] || bMC[kKey] || 0} kcal</div>
                                  <div className="text-[10px] text-blue-400 px-1">{bMP[kIso] || bMP[kKey] || 0} prot</div>
                                </div>
                              ) : (
                                renderBackupCards(slotCards)
                              )}
                              {(() => {
                                const slotAssignedIds = time === "midi" ? midiAssignedIds : soirAssignedIds;
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
                                const sel = sumDayExtras(bES[bIso] || bES[bKey]);
                                const matinAssigned = sumDayExtras(bESA[`${bIso}-matin`] ?? bESA[`${bKey}-matin`] ?? []);
                                const midiAssigned = sumDayExtras(bESA[`${bIso}-midi`] ?? bESA[`${bKey}-midi`] ?? []);
                                const soirAssigned = sumDayExtras(bESA[`${bIso}-soir`] ?? bESA[`${bKey}-soir`] ?? []);
                                const gouterAssigned = sumDayExtras(bESA[`${bIso}-gouter`] ?? bESA[`${bKey}-gouter`] ?? []);
                                const assignedCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                                const assignedPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                                const extraCal = Math.max(0, sel.cal - assignedCal);
                                const extraPro = Math.max(0, sel.pro - assignedPro);
                                // Sous « Masquer calories » : n'afficher que les macros manuelles (pas l'auto chips).
                                const displayCal = resolveExtraColumnInputDisplayValue(
                                  bEC[bIso] || bEC[bKey] || 0,
                                  extraCal,
                                  hideDayCalorieTotals,
                                );
                                const displayPro = resolveExtraColumnInputDisplayValue(
                                  bEP[bIso] || bEP[bKey] || 0,
                                  extraPro,
                                  hideDayCalorieTotals,
                                );
                                return (
                                  <>
                                    <div className="text-[10px] text-orange-400 font-bold">
                                      {displayCal > 0 ? Math.round(displayCal) : ""}
                                    </div>
                                    <div className="text-[10px] text-blue-400 font-bold">
                                      {displayPro > 0 ? Math.round(displayPro) : ""}
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
                            const backupUnassignedIds = getUnassignedExtraSelectionIds(bES, bESA, bIso, bKey);
                            const manualCal = bEC[bIso] || bEC[bKey] || 0;
                            const manualPro = bEP[bIso] || bEP[bKey] || 0;
                            const hasVisibleManual = manualPro > 0 || (!hideDayCalorieTotals && manualCal > 0);
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
                        {(bDC[`${bIso}-gouter`] || bDC[`${bKey}-gouter`]) && (
                          <span className="flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">🥤 +{DRINK_CALORIES}</span>
                        )}
                        {gouterCards.length === 0 && (
                          <>
                            <div className="text-[10px] text-muted-foreground px-1 opacity-60">{bMC[`${bIso}-gouter`] || bMC[`${bKey}-gouter`] || 0} kcal</div>
                            <div className="text-[10px] text-blue-400 px-1 opacity-60">{bMP[`${bIso}-gouter`] || bMP[`${bKey}-gouter`] || 0} prot</div>
                          </>
                        )}
                        {renderBackupCards(gouterCards)}
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
