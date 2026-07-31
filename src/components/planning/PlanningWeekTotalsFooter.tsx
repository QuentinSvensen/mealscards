import { Flame } from "lucide-react";
import {
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
} from "@/domain/planning/calorieGoalRange";

export interface PlanningWeekTotalsFooterProps {
  /** Libellé gauche (ex. « Total semaine », « Total prévu »). */
  title: string;
  weekTotal: number;
  /** Bornes utilisées pour la couleur (souvent objectif journalier × scale). */
  goalLow: number;
  goalHigh: number;
  hideDayCalorieTotals: boolean;
  /** Multiplicateur pour la couleur du total (7 = semaine). */
  weekDayScale?: number;
  /** Bornes affichées après « / » (défaut = goalLow/goalHigh). */
  displayGoalLow?: number;
  displayGoalHigh?: number;
  /** Moyenne principale affichée à droite (jusqu’à aujourd’hui ou /7j). */
  avgCal: number;
  /** Suffixe entre parenthèses après la moyenne principale (ex. « 3j ») — omis si absent. */
  avgDaysLabel?: string;
  /** Moyenne glissante sur 14 jours (semaine courante uniquement). */
  rolling14DayAvg?: number;
  /**
   * Si true, le goal High seul est affiché (ex. backup : `/ {goalHigh}` sans fourchette).
   * Sinon utilise formatCalorieGoalTarget(goalLow, goalHigh).
   */
  goalAsSingleHigh?: boolean;
}

/**
 * Pied de totaux caloriques d’une vue planning (semaine courante, backup ou suivante).
 */
export function PlanningWeekTotalsFooter({
  title,
  weekTotal,
  goalLow,
  goalHigh,
  hideDayCalorieTotals,
  weekDayScale = 1,
  displayGoalLow,
  displayGoalHigh,
  avgCal,
  avgDaysLabel,
  rolling14DayAvg,
  goalAsSingleHigh = false,
}: PlanningWeekTotalsFooterProps) {
  /** Couleur d’un total/moyenne masqué : vert dans la fourchette, rouge au-dessus, blanc en dessous. */
  const maskedCalColor = (value: number, low: number, high: number, dayScale = 1) =>
    getCalorieRangeTotalColorClass(value, low, high, dayScale) ?? "text-white";
  const weekTotalColor = maskedCalColor(weekTotal, goalLow, goalHigh, weekDayScale);
  const avgColor = maskedCalColor(avgCal, goalLow, goalHigh);
  const avg14Color =
    rolling14DayAvg != null ? maskedCalColor(rolling14DayAvg, goalLow, goalHigh) : undefined;
  const labelLow = displayGoalLow ?? goalLow;
  const labelHigh = displayGoalHigh ?? goalHigh;
  const goalLabel = goalAsSingleHigh
    ? String(labelHigh)
    : formatCalorieGoalTarget(labelLow, labelHigh);

  return (
    <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-foreground">{title}</span>
        {rolling14DayAvg != null && (
          <span className="text-xs text-muted-foreground font-medium">
            Moy.{" "}
            {hideDayCalorieTotals ? (
              <span className={avg14Color}>Calories</span>
            ) : (
              rolling14DayAvg
            )}{" "}
            kcal/j{" "}
            <span className="text-muted-foreground/40">(14j)</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap ml-auto">
        <span className="text-xs text-muted-foreground font-medium">
          Moy. semaine{" "}
          {hideDayCalorieTotals ? <span className={avgColor}>Calories</span> : avgCal}{" "}
          kcal/j
          {avgDaysLabel != null && avgDaysLabel !== "" && (
            <>
              {" "}
              <span className="text-muted-foreground/40">({avgDaysLabel})</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
          <Flame className="h-4 w-4" />
          {hideDayCalorieTotals ? (
            <span className={weekTotalColor}>Calories</span>
          ) : (
            Math.round(weekTotal)
          )}{" "}
          <span className="text-muted-foreground/50 font-normal text-xs">/ {goalLabel}</span>
        </span>
      </div>
    </div>
  );
}
