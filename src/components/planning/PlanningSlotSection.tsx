import type { ReactNode } from "react";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { PlanningInput } from "@/components/planning/PlanningInput";
import { PlanningAssignedExtraChips } from "@/components/planning/PlanningAssignedExtraChips";
import { PlanningSlotMacrosBadge } from "@/components/planning/PlanningSlotMacrosBadge";
import { DRINK_CALORIES, TIME_LABELS } from "@/components/planning/planningSlotStyles";

export interface PlanningSlotSectionProps {
  dayKey: string;
  dayIso: string;
  time: string;
  isOver: boolean;
  slotDrink: boolean;
  hideDayCalorieTotals: boolean;
  hasSlotMeals: boolean;
  slotCalories: number;
  slotProteins: number;
  slotFibers: number;
  manualCalories: number;
  manualProteins: number;
  manualFibers: number;
  slotAssignedIds: string[];
  foodItems: FoodItem[];
  dessertById: Map<string, { mealPayload: Meal; name?: string }>;
  snapshotFlashed: boolean;
  snapshotSaved: boolean;
  snapshotTitle: string;
  /** Mini-cartes déjà rendues (évite de capturer renderMiniCard dans ce composant). */
  mealCards: ReactNode;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onToggleDrink: () => void;
  onSaveManualCalories: (val: number) => void;
  onSaveManualProteins: (val: number) => void;
  onSaveManualFibers: (val: number) => void;
  onSaveSnapshot: () => void;
  onClearSnapshot: () => void;
  onDeselectExtra: (extraId: string, iso: string, key: string) => void;
  onDragStartExtra: (extraId: string, iso: string, key: string, e: React.DragEvent) => void;
  onDragEndExtra: () => void;
}

/**
 * Cellule réutilisable d’un créneau principal (midi / soir) :
 * drop DnD, boisson, saisie manuelle, cartes repas, extras assignés et totaux.
 */
export function PlanningSlotSection({
  dayKey,
  dayIso,
  time,
  isOver,
  slotDrink,
  hideDayCalorieTotals,
  hasSlotMeals,
  slotCalories,
  slotProteins,
  slotFibers,
  manualCalories,
  manualProteins,
  manualFibers,
  slotAssignedIds,
  foodItems,
  dessertById,
  snapshotFlashed,
  snapshotSaved,
  snapshotTitle,
  mealCards,
  onDragOver,
  onDragLeave,
  onDrop,
  onToggleDrink,
  onSaveManualCalories,
  onSaveManualProteins,
  onSaveManualFibers,
  onSaveSnapshot,
  onClearSnapshot,
  onDeselectExtra,
  onDragStartExtra,
  onDragEndExtra,
}: PlanningSlotSectionProps) {
  const timeLabel = TIME_LABELS[time] || time;

  return (
    <div
      data-slot
      data-day={dayIso}
      data-time={time}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`min-w-0 min-h-[56px] sm:min-h-[64px] rounded-xl border border-dashed p-1.5 sm:p-2 transition-colors ${isOver ? "border-primary/60 bg-primary/7 ring-1 ring-primary/20" : "border-border/55 bg-background/10 hover:border-primary/40"}`}
    >
      <div className="flex items-center justify-between gap-0.5 mb-0.5 min-w-0">
        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 shrink">
          <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            {timeLabel}
          </span>
          <button
            type="button"
            onClick={onToggleDrink}
            className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${slotDrink
              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold"
              : "bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60"
              }`}
            title={`+ Boisson sucrée (+${DRINK_CALORIES} cal)`}
          >
            🥤 {slotDrink ? `+${DRINK_CALORIES}` : ""}
          </button>
        </div>
        <PlanningSlotMacrosBadge
          calories={slotCalories}
          proteins={slotProteins}
          fibers={slotFibers}
          hidden={hideDayCalorieTotals}
        />
      </div>
      <div className="mt-0.5 space-y-1">
        {!hasSlotMeals ? (
          <div className="flex flex-col items-start gap-0.5">
            <PlanningInput
              storageKey={`manual-${dayIso}-${time}`}
              currentValue={manualCalories}
              onSave={onSaveManualCalories}
              placeholder="kcal"
              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
            />
            <PlanningInput
              storageKey={`manual-prot-${dayIso}-${time}`}
              currentValue={manualProteins}
              onSave={onSaveManualProteins}
              placeholder="prot"
              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
            />
            <PlanningInput
              storageKey={`manual-fiber-${dayIso}-${time}`}
              currentValue={manualFibers}
              onSave={onSaveManualFibers}
              placeholder="fib"
              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 placeholder:text-emerald-400/30 focus:outline-none focus:border-emerald-400/40 text-center"
            />
            <div className="w-14 flex justify-center">
              <button
                type="button"
                onClick={onSaveSnapshot}
                onDoubleClick={onClearSnapshot}
                className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${snapshotFlashed
                  ? "bg-green-500/30 text-green-400 border border-green-400/50"
                  : snapshotSaved
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent"
                  }`}
                title={snapshotTitle}
              >
                💾
              </button>
            </div>
          </div>
        ) : (
          mealCards
        )}
        <PlanningAssignedExtraChips
          assignedIds={slotAssignedIds}
          dayIso={dayIso}
          dayKey={dayKey}
          title={`Extra assigné à ${timeLabel} — glisse pour déplacer`}
          foodItems={foodItems}
          dessertById={dessertById}
          keyPrefix={`${time}-assigned`}
          onDeselect={onDeselectExtra}
          onDragStartExtra={onDragStartExtra}
          onDragEndExtra={onDragEndExtra}
        />
      </div>
    </div>
  );
}
