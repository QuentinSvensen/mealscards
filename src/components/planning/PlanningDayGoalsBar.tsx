import { Flame } from "lucide-react";
import {
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
  hasCalorieGoalRangeMin,
} from "@/domain/planning/calorieGoalRange";

export interface PlanningDayGoalsBarProps {
  dayCalories: number;
  dayProtein: number;
  dayFiber: number;
  dailyGoal: number;
  dailyGoalLow: number;
  dailyProteinGoal: number;
  dailyFiberGoal: number;
  hideDayCalorieTotals: boolean;
  editingGoal: boolean;
  goalInput: string;
  editingProteinGoal: boolean;
  proteinGoalInput: string;
  editingFiberGoal: boolean;
  fiberGoalInput: string;
  onStartEditGoal: () => void;
  onGoalInputChange: (value: string) => void;
  onGoalBlur: () => void;
  onGoalCancel: () => void;
  onStartEditProteinGoal: () => void;
  onProteinGoalInputChange: (value: string) => void;
  onProteinGoalBlur: () => void;
  onProteinGoalCancel: () => void;
  onStartEditFiberGoal: () => void;
  onFiberGoalInputChange: (value: string) => void;
  onFiberGoalBlur: () => void;
  onFiberGoalCancel: () => void;
}

/**
 * Bandeau d’objectifs du jour (kcal / protéines / fibres) avec édition inline.
 * État d’édition partagé au niveau WeeklyPlanning (un seul jour édité à la fois).
 */
export function PlanningDayGoalsBar({
  dayCalories,
  dayProtein,
  dayFiber,
  dailyGoal,
  dailyGoalLow,
  dailyProteinGoal,
  dailyFiberGoal,
  hideDayCalorieTotals,
  editingGoal,
  goalInput,
  editingProteinGoal,
  proteinGoalInput,
  editingFiberGoal,
  fiberGoalInput,
  onStartEditGoal,
  onGoalInputChange,
  onGoalBlur,
  onGoalCancel,
  onStartEditProteinGoal,
  onProteinGoalInputChange,
  onProteinGoalBlur,
  onProteinGoalCancel,
  onStartEditFiberGoal,
  onFiberGoalInputChange,
  onFiberGoalBlur,
  onFiberGoalCancel,
}: PlanningDayGoalsBarProps) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
      <button
        type="button"
        onClick={onStartEditGoal}
        className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-muted/80 transition-colors cursor-pointer"
        title="Cliquer pour modifier l'objectif"
      >
        <Flame className="h-2.5 w-2.5 text-orange-500" />
        <span className={getCalorieRangeTotalColorClass(dayCalories, dailyGoalLow, dailyGoal) ?? undefined}>
          {hideDayCalorieTotals ? "Calories" : Math.round(dayCalories)}
        </span>
        {" "}
        <span className="text-muted-foreground/50 font-normal">/ {formatCalorieGoalTarget(dailyGoalLow, dailyGoal)}</span>
      </button>
      {editingGoal && (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={goalInput}
            onChange={(e) => onGoalInputChange(e.target.value)}
            onBlur={onGoalBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onGoalCancel();
            }}
            className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-[9px] text-muted-foreground">kcal/j</span>
        </div>
      )}
      {!editingGoal && !hideDayCalorieTotals && dayCalories > 0 && !hasCalorieGoalRangeMin(dailyGoalLow, dailyGoal) && (
        <span className={`text-[10px] font-bold whitespace-nowrap ${dailyGoal - dayCalories > 0 ? "text-muted-foreground/60" : "text-orange-500"}`}>
          {dailyGoal - dayCalories > 0 ? `reste ${Math.round(dailyGoal - dayCalories)}` : `+${Math.round(dayCalories - dailyGoal)}`}
        </span>
      )}
      {dayProtein > 0 && (
        <button
          type="button"
          onClick={onStartEditProteinGoal}
          className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-blue-500/20 transition-colors cursor-pointer"
          title="Cliquer pour modifier l'objectif protéines"
        >
          🍗 {Math.round(dayProtein)} <span className="text-blue-400/50 font-normal">/ {dailyProteinGoal}</span>
        </button>
      )}
      {!editingProteinGoal && dayProtein > 0 && (
        <span className={`text-[10px] font-bold whitespace-nowrap ${dailyProteinGoal - dayProtein > 0 ? "text-blue-400/60" : "text-blue-500"}`}>
          {dailyProteinGoal - dayProtein > 0 ? `reste ${Math.round(dailyProteinGoal - dayProtein)}` : `+${Math.round(dayProtein - dailyProteinGoal)}`}
        </span>
      )}
      {editingProteinGoal && (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            value={proteinGoalInput}
            onChange={(e) => onProteinGoalInputChange(e.target.value)}
            onBlur={onProteinGoalBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onProteinGoalCancel();
            }}
            className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-[9px] text-muted-foreground">🍗/j</span>
        </div>
      )}
      <button
        type="button"
        onClick={onStartEditFiberGoal}
        className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-emerald-500/20 transition-colors cursor-pointer"
        title="Cliquer pour modifier l'objectif fibres"
      >
        🌾 {Math.round(dayFiber)} <span className="text-emerald-400/50 font-normal">/ {dailyFiberGoal}</span>
      </button>
      {editingFiberGoal && (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            value={fiberGoalInput}
            onChange={(e) => onFiberGoalInputChange(e.target.value)}
            onBlur={onFiberGoalBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onFiberGoalCancel();
            }}
            className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-[9px] text-muted-foreground">🌾/j</span>
        </div>
      )}
    </div>
  );
}
