import type { ReactNode } from "react";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { PlanningInput } from "@/components/planning/PlanningInput";
import { PlanningAssignedExtraChips } from "@/components/planning/PlanningAssignedExtraChips";
import { PlanningSlotMacrosBadge } from "@/components/planning/PlanningSlotMacrosBadge";
import { DRINK_CALORIES } from "@/components/planning/planningSlotStyles";

export interface PlanningGouterBandProps {
  dayKey: string;
  dayIso: string;
  isOver: boolean;
  gouterDrink: boolean;
  hasGouterMeals: boolean;
  hideDayCalorieTotals: boolean;
  gouterManualCal: number;
  gouterManualPro: number;
  gouterManualFiber: number;
  gouterTotalCals: number;
  gouterTotalPro: number;
  gouterTotalFiber: number;
  gouterAssignedIds: string[];
  foodItems: FoodItem[];
  dessertById: Map<string, { mealPayload: Meal; name?: string }>;
  dessertCatalog?: Array<{ id: string; name: string }>;
  dessertPossibleCountById?: Map<string, number>;
  /** Cartes goûter déjà rendues (compact). */
  mealCards: ReactNode;
  /** Clés PlanningInput (défaut semaine courante ; préfixe next-* pour semaine suivante). */
  manualCalStorageKey?: string;
  manualProStorageKey?: string;
  manualFiberStorageKey?: string;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onToggleDrink: () => void;
  onSaveManualCalories: (val: number) => void;
  onSaveManualProteins: (val: number) => void;
  onSaveManualFibers: (val: number) => void;
  onDeselectExtra: (extraId: string, iso: string, key: string) => void;
  onDragStartExtra: (extraId: string, iso: string, key: string, e: React.DragEvent) => void;
  onDragEndExtra: () => void;
}

/**
 * Bande horizontale « Goûter » sous la grille midi/soir :
 * boisson, saisie manuelle, cartes compactes, extras et totaux.
 */
export function PlanningGouterBand({
  dayKey,
  dayIso,
  isOver,
  gouterDrink,
  hasGouterMeals,
  hideDayCalorieTotals,
  gouterManualCal,
  gouterManualPro,
  gouterManualFiber,
  gouterTotalCals,
  gouterTotalPro,
  gouterTotalFiber,
  gouterAssignedIds,
  foodItems,
  dessertById,
  dessertCatalog,
  dessertPossibleCountById,
  mealCards,
  manualCalStorageKey,
  manualProStorageKey,
  manualFiberStorageKey,
  onDragOver,
  onDragLeave,
  onDrop,
  onToggleDrink,
  onSaveManualCalories,
  onSaveManualProteins,
  onSaveManualFibers,
  onDeselectExtra,
  onDragStartExtra,
  onDragEndExtra,
}: PlanningGouterBandProps) {
  const calKey = manualCalStorageKey ?? `manual-${dayIso}-gouter`;
  const proKey = manualProStorageKey ?? `manual-prot-${dayIso}-gouter`;
  const fiberKey = manualFiberStorageKey ?? `manual-fiber-${dayIso}-gouter`;

  return (
    <div
      data-slot
      data-day={dayIso}
      data-time="gouter"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`mt-1.5 min-h-[48px] sm:min-h-[52px] rounded-xl border border-dashed p-1.5 sm:p-2 transition-colors flex items-stretch ${isOver ? "border-orange-400/65 bg-orange-500/8 ring-1 ring-orange-400/25" : "border-orange-300/45 bg-orange-500/3 hover:border-orange-400/45"}`}
    >
      <div className="flex items-center gap-1 sm:gap-2 flex-wrap w-full min-h-[32px]">
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Goûter</span>
          <button
            type="button"
            onClick={onToggleDrink}
            className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${gouterDrink ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold" : "bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60"}`}
            title={`+ Boisson sucrée (+${DRINK_CALORIES} cal)`}
          >
            🥤 {gouterDrink ? `+${DRINK_CALORIES}` : ""}
          </button>
          {!hasGouterMeals && (
            <>
              <PlanningInput
                storageKey={calKey}
                currentValue={gouterManualCal}
                onSave={onSaveManualCalories}
                placeholder="kcal"
                className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
              />
              <PlanningInput
                storageKey={proKey}
                currentValue={gouterManualPro}
                onSave={onSaveManualProteins}
                placeholder="prot"
                className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
              />
              <PlanningInput
                storageKey={fiberKey}
                currentValue={gouterManualFiber}
                onSave={onSaveManualFibers}
                placeholder="fib"
                className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 placeholder:text-emerald-400/30 focus:outline-none focus:border-emerald-400/40 text-center"
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap min-w-0">
          {mealCards}
          <PlanningAssignedExtraChips
            assignedIds={gouterAssignedIds}
            dayIso={dayIso}
            dayKey={dayKey}
            title="Extra assigné à Goûter — glisse pour déplacer"
            foodItems={foodItems}
            dessertById={dessertById}
            dessertCatalog={dessertCatalog}
            dessertPossibleCountById={dessertPossibleCountById}
            wrapperClassName="flex flex-wrap gap-1"
            keyPrefix="gouter-assigned"
            onDeselect={onDeselectExtra}
            onDragStartExtra={onDragStartExtra}
            onDragEndExtra={onDragEndExtra}
          />
          <PlanningSlotMacrosBadge
            calories={gouterTotalCals}
            proteins={gouterTotalPro}
            fibers={gouterTotalFiber}
            hidden={hideDayCalorieTotals}
            fiberAsWheatIcon
          />
        </div>
      </div>
    </div>
  );
}
