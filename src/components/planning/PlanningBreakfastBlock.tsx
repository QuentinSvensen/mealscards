import { useState } from "react";
import { Flame } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PlanningInput } from "@/components/planning/PlanningInput";
import { PlanningSlotMacrosBadge } from "@/components/planning/PlanningSlotMacrosBadge";
import { PlanningAssignedExtraChips } from "@/components/planning/PlanningAssignedExtraChips";
import { BreakfastBreakdownList } from "@/components/planning/BreakfastBreakdownList";
import type { BreakfastBreakdownItem } from "@/domain/planning/breakfastBreakdown";
import {
  getBreakfastButtonLabel,
  getBreakfastMealOnlyBreakdownItems,
} from "@/domain/planning/breakfastBreakdown";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { PlanningSnapshotEntry } from "@/domain/planning/types";
import { formatPlanningSnapshotTitle } from "@/domain/planning/formatPlanningSnapshotTitle";
import { clearWeekdayScopedSnapshots } from "@/domain/planning/weekdaySnapshotUtils";
import { canAcceptPlanningSlotDrag, getPlanningPmIdFromDrop } from "@/lib/planningDnD";

export interface PlanningBreakfastBlockProps {
  dayKey: string;
  dayIso: string;
  isBreakfastDragOver: boolean;
  breakfastDropKey: string;
  liveBreakfastBreakdown: BreakfastBreakdownItem[];
  breakfastTotalCals: number;
  breakfastTotalPro: number;
  breakfastTotalFiber: number;
  hideDayCalorieTotals: boolean;
  breakfastSelections: Record<string, string>;
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  autoConsumeBreakfast: Record<string, boolean>;
  possiblePetitDej: PossibleMeal[];
  petitDejMeals: Meal[];
  weekDates: Array<{ key: string; iso: string; display: string }>;
  matinMeals: PossibleMeal[];
  breakfastAssignedSlotIds: string[];
  foodItems: FoodItem[];
  singleIngredientDessertById: Map<string, { mealPayload: Meal; name?: string }>;
  dessertCatalog?: Array<{ id: string; name: string }>;
  dessertPossibleCountById?: Map<string, number>;
  savedSnapshots: Record<string, PlanningSnapshotEntry>;
  flashedKeys: Record<string, boolean>;
  setFlashedKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  weekOffset: number;
  nextBreakfastSelections: Record<string, string>;
  nextBreakfastManualCalories: Record<string, number>;
  nextBreakfastManualProteins: Record<string, number>;
  jsDayToKey: Record<number, string>;
  draggedSelectedExtraId: string | null;
  /** Carte planning en cours de drag (pour accepter le drop sur le fond du petit-déj). */
  draggedPlanningPmId?: string | null;
  draggedSelectedExtraOrigin: { iso: string; key: string } | null;
  setDragOverSlot: React.Dispatch<React.SetStateAction<string | null>>;
  setDraggedSelectedExtraId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraggedSelectedExtraOrigin: React.Dispatch<React.SetStateAction<{ iso: string; key: string } | null>>;
  moveExtraBetweenDaysToSlot: (
    extraId: string,
    fromIso: string,
    fromKey: string,
    toIso: string,
    toKey: string,
    slot: string,
  ) => void;
  assignExtraToDaySlot: (extraId: string, iso: string, key: string, slot: string) => void;
  /** Dépose une carte Possible sur le créneau matin (même logique que midi/soir). */
  onDropPlanningCard?: (e: React.DragEvent, dayIso: string, time: string) => void;
  getBreakfastForDay: (key: string, iso: string) => Meal | null | undefined;
  /** Ouvre la pop-up détail d’une carte Possible (même UX que midi/soir). */
  openPlanningCardPopup: (pm: PossibleMeal) => void;
  setPopupBreakfast: (v: { meal: any; day: string } | null) => void;
  setBreakfastForDay: (day: string, selId: string | null) => void;
  updatePlanningWithCounters: (pmId: string, day: string | null, time: string | null) => void;
  setPreference: { mutate: (args: { key: string; value: unknown }) => void };
  getMealCal: (meal: any, ingredientsOverride?: any) => number;
  getMealPro: (meal: any, ingredientsOverride?: any) => number;
  deselectExtraForDay: (extraId: string, iso: string, key: string) => void;
}

/**
 * Bloc header petit-déjeuner d'un jour (semaine courante) :
 * popover de sélection, manuels, auto-conso, sync 💾, macros et chips extras.
 */
export function PlanningBreakfastBlock({
  dayKey: key,
  dayIso: iso,
  isBreakfastDragOver,
  breakfastDropKey,
  liveBreakfastBreakdown,
  breakfastTotalCals,
  breakfastTotalPro,
  breakfastTotalFiber,
  hideDayCalorieTotals,
  breakfastSelections,
  breakfastManualCalories,
  breakfastManualProteins,
  autoConsumeBreakfast,
  possiblePetitDej,
  petitDejMeals,
  weekDates,
  matinMeals,
  breakfastAssignedSlotIds,
  foodItems,
  singleIngredientDessertById,
  dessertCatalog,
  dessertPossibleCountById,
  savedSnapshots,
  flashedKeys,
  setFlashedKeys,
  weekOffset,
  nextBreakfastSelections,
  nextBreakfastManualCalories,
  nextBreakfastManualProteins,
  jsDayToKey: JS_DAY_TO_KEY,
  draggedSelectedExtraId,
  draggedPlanningPmId = null,
  draggedSelectedExtraOrigin,
  setDragOverSlot,
  setDraggedSelectedExtraId,
  setDraggedSelectedExtraOrigin,
  moveExtraBetweenDaysToSlot,
  assignExtraToDaySlot,
  onDropPlanningCard,
  getBreakfastForDay,
  openPlanningCardPopup,
  setPopupBreakfast,
  setBreakfastForDay,
  updatePlanningWithCounters,
  setPreference,
  getMealCal,
  getMealPro,
  deselectExtraForDay,
}: PlanningBreakfastBlockProps) {
  const [breakfastPopoverOpen, setBreakfastPopoverOpen] = useState(false);

  /**
   * Ouvre le détail recette du badge petit-déj :
   * carte Possible (matin / sélection pm:) via la pop-up planning, sinon fiche Meal.
   */
  const openBreakfastRecipeDetail = () => {
    setBreakfastPopoverOpen(false);

    if (matinMeals.length === 1 && matinMeals[0]?.meals) {
      openPlanningCardPopup(matinMeals[0]);
      return;
    }

    const selId = iso ? breakfastSelections[iso] : undefined;
    if (selId?.startsWith("pm:")) {
      const pm = possiblePetitDej.find((p) => p.id === selId.slice(3));
      if (pm?.meals) {
        openPlanningCardPopup(pm);
        return;
      }
    }

    const bm = getBreakfastForDay(key, iso);
    if (bm) {
      setPopupBreakfast({ meal: bm, day: iso });
      return;
    }

    if (matinMeals.length > 0 && matinMeals[0]?.meals) {
      openPlanningCardPopup(matinMeals[0]);
    }
  };

  return (
<div
                  data-slot={`${iso}-matin`}
                  data-day={iso}
                  data-time="matin"
                  className={`rounded-xl border border-dashed px-2 py-2 transition-colors ${isBreakfastDragOver ? 'border-primary/60 bg-primary/7 ring-1 ring-primary/20' : 'border-border/55 bg-background/10 hover:border-primary/40'}`}
                  onDragOver={(e) => {
                    if (
                      !canAcceptPlanningSlotDrag(
                        e.dataTransfer,
                        draggedSelectedExtraId,
                        draggedPlanningPmId,
                      )
                    ) {
                      return;
                    }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverSlot(breakfastDropKey);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === breakfastDropKey ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverSlot(null);
                    const pmId = getPlanningPmIdFromDrop(e);
                    if (pmId) {
                      if (onDropPlanningCard) onDropPlanningCard(e, iso, "matin");
                      else updatePlanningWithCounters(pmId, iso, "matin");
                      return;
                    }
                    const extraId = draggedSelectedExtraId || e.dataTransfer.getData('text/plain');
                    if (!extraId) return;
                    const origin = draggedSelectedExtraOrigin;
                    if (origin && origin.iso && origin.iso !== iso) {
                      moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, iso, key, 'matin');
                    } else {
                      assignExtraToDaySlot(extraId, iso, key, 'matin');
                    }
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                  }}
                >
                {/* Sélecteur de petit déj */}
                <div className="flex items-center gap-1 flex-wrap">
                  <Popover open={breakfastPopoverOpen} onOpenChange={setBreakfastPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Double-clic pour voir le détail"
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors truncate max-w-[120px] ${
                          (() => {
                            return liveBreakfastBreakdown.length > 0
                              ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50"
                              : "bg-slate-200/80 dark:bg-slate-700/45 text-slate-700 dark:text-slate-300 border border-dashed border-slate-400/50 dark:border-slate-500/50 hover:bg-slate-300/80 dark:hover:bg-slate-600/50";
                          })()
                        }`}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openBreakfastRecipeDetail();
                        }}
                      >
                        {getBreakfastButtonLabel(liveBreakfastBreakdown)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2" align="start">
                      {getBreakfastMealOnlyBreakdownItems(liveBreakfastBreakdown).length > 1 && (
                        <>
                          <BreakfastBreakdownList
                            items={liveBreakfastBreakdown}
                            totalCal={breakfastTotalCals}
                            totalPro={breakfastTotalPro}
                          />
                          <Separator className="my-2" />
                        </>
                      )}
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        <button onClick={() => setBreakfastForDay(iso, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
                          — Aucun
                        </button>
                        {possiblePetitDej.length > 0 && (
                          <>
                            <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Possible</p>
                            {possiblePetitDej.map(pm => {
                              const displayIng = pm.ingredients_override ?? pm.meals?.ingredients;
                              const calDisplay = getMealCal(pm.meals || {}, pm.ingredients_override);
                              const proDisplay = getMealPro(pm.meals || {}, pm.ingredients_override);
                              const pmSelId = `pm:${pm.id}`;
                              const isMatinSelected = (pm.day_of_week === key || pm.day_of_week === iso) && pm.meal_time === 'matin';
                              const isDropdownSelected = Boolean(iso && breakfastSelections[iso] === pmSelId);
                              const isSelected = isMatinSelected || isDropdownSelected;
                              // Trouver les autres jours où ce petit déjeuner est sélectionné
                              const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === pmSelId || breakfastSelections[wd.key] === pmSelId || (pm.day_of_week === wd.iso && pm.meal_time === 'matin') || (pm.day_of_week === wd.key && pm.meal_time === 'matin')));
                              const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                              return (
                                <button key={pm.id} onClick={() => {
                                  if (isDropdownSelected) setBreakfastForDay(iso, null);
                                  if (isSelected) {
                                    updatePlanningWithCounters(pm.id, null, null);
                                  } else {
                                    updatePlanningWithCounters(pm.id, iso, 'matin');
                                  }
                                }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                                  {pm.meals?.name} {pm.ingredients_override ? '✏️' : ''} {((!hideDayCalorieTotals && calDisplay) || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({!hideDayCalorieTotals && calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{!hideDayCalorieTotals && calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                                  {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                                </button>
                              );
                            })}
                            <div className="border-t border-border/40 my-1" />
                          </>
                        )}
                        <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Tous</p>
                        {petitDejMeals.map(m => {
                          const calDisplay = getMealCal(m);
                          const proDisplay = getMealPro(m);
                          const mealSelId = `meal:${m.id}`;
                          const isSelected = Boolean(iso && breakfastSelections[iso] === mealSelId);
                          const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === mealSelId || breakfastSelections[wd.key] === mealSelId));
                          const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                          return (
                            <button key={m.id} onClick={() => {
                              if (isSelected) setBreakfastForDay(iso, null);
                              else setBreakfastForDay(iso, mealSelId);
                            }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                              {m.name} {((!hideDayCalorieTotals && calDisplay) || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({!hideDayCalorieTotals && calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{!hideDayCalorieTotals && calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                              {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                            </button>
                          );
                        })}
                        {petitDejMeals.length === 0 && possiblePetitDej.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic px-2 py-1">Aucun petit déj</p>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {/* Saisie manuelle de calories quand aucun petit déj n'est sélectionné */}
                  {!getBreakfastForDay(key, iso) && matinMeals.length === 0 && (
                    <>
                      <PlanningInput
                        storageKey={`breakfast-cal-${iso}`}
                        currentValue={(iso && breakfastManualCalories[iso]) || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualCalories };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: updated });
                        }}
                        placeholder="kcal"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40"
                      />
                      <PlanningInput
                        storageKey={`breakfast-prot-${iso}`}
                        currentValue={(iso && breakfastManualProteins[iso]) || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualProteins };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: updated });
                        }}
                        placeholder="prot"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40"
                      />
                    </>
                  )}
                  {/* Interrupteur d'auto-consommation du petit déj */}
                  {getBreakfastForDay(key, iso) && (
                    <button
                      onClick={() => {
                        const updated = { ...autoConsumeBreakfast };
                        if (iso && updated[iso]) delete updated[iso];
                        else if (updated[key]) delete updated[key];
                        else if (iso) updated[iso] = true;
                        else updated[key] = true;
                        setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updated });
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${(iso && autoConsumeBreakfast[iso])
                        ? 'bg-green-500/20 text-green-400 border border-green-400/50'
                        : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(iso && autoConsumeBreakfast[iso]) ? 'Auto-consommation activée — sera déduit à 23h59 ou au prochain lancement' : 'Activer la décompte automatique du petit déj'}
                    >🔄</button>
                  )}
                  {!(matinMeals.length > 0 || (iso && breakfastSelections[iso]?.startsWith('pm:'))) && (
                    <button
                      onClick={() => {
                        const snapKey = `breakfast-${iso}`;
                        const cal = (iso && breakfastManualCalories[iso]) || 0;
                        const prot = (iso && breakfastManualProteins[iso]) || 0;
                        const breakfast = getBreakfastForDay(key, iso);
                        const mealId = (iso && breakfastSelections[iso]) || undefined;
                        const cleaned = clearWeekdayScopedSnapshots(savedSnapshots, "breakfast", iso, key, JS_DAY_TO_KEY);
                        const updated = { ...cleaned, [snapKey]: { cal, prot, savedAt: Date.now(), name: breakfast?.name, mealId } };
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Synchronisation unidirectionnelle vers la semaine prochaine (Actuelle -> Suivante)
                        if (weekOffset === 0) {
                          if (mealId) {
                            const nxtBf = { ...nextBreakfastSelections };
                            nxtBf[key] = mealId;
                            setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          }
                          if (cal > 0) {
                            const nxtCal = { ...nextBreakfastManualCalories };
                            nxtCal[key] = cal;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          }
                          if (prot > 0) {
                            const nxtPro = { ...nextBreakfastManualProteins };
                            nxtPro[key] = prot;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                          }
                        }

                        setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                        setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                      }}
                      onDoubleClick={() => {
                        const updated = clearWeekdayScopedSnapshots(savedSnapshots, "breakfast", iso, key, JS_DAY_TO_KEY);
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Nettoyer la sync de la semaine prochaine si oubliée
                        if (weekOffset === 0) {
                          const nxtBf = { ...nextBreakfastSelections }; delete nxtBf[key]; delete nxtBf[iso];
                          setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          const nxtCal = { ...nextBreakfastManualCalories }; delete nxtCal[key]; delete nxtCal[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          const nxtPro = { ...nextBreakfastManualProteins }; delete nxtPro[key]; delete nxtPro[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                        }
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`breakfast-${iso}`]
                        ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                        : savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(() => {
                        const snap = savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`];
                        return formatPlanningSnapshotTitle(snap, { nameFallback: true });
                      })()}
                    >💾</button>
                  )}
                <PlanningSlotMacrosBadge
                  calories={breakfastTotalCals}
                  proteins={breakfastTotalPro}
                  fibers={breakfastTotalFiber}
                  hidden={hideDayCalorieTotals}
                  fiberAsWheatIcon
                  size="header"
                  className="ml-1 sm:ml-2"
                />
                </div>
                <PlanningAssignedExtraChips
                  assignedIds={breakfastAssignedSlotIds}
                  dayIso={iso}
                  dayKey={key}
                  title="Extra assigné au petit déj — glisse pour déplacer"
                  foodItems={foodItems}
                  dessertById={singleIngredientDessertById}
                  dessertCatalog={dessertCatalog}
                  dessertPossibleCountById={dessertPossibleCountById}
                  chipClassName="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/20 cursor-grab active:cursor-grabbing"
                  wrapperClassName="flex flex-wrap gap-1 mt-1"
                  keyPrefix="breakfast-assigned"
                  onDeselect={deselectExtraForDay}
                  onDragStartExtra={(extraId, dayIso, dayKey, e) => {
                    setDraggedSelectedExtraId(extraId);
                    setDraggedSelectedExtraOrigin({ iso: dayIso, key: dayKey });
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', extraId);
                  }}
                  onDragEndExtra={() => {
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                  }}
                />
                </div>
  );
}
