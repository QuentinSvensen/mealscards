import type { PlanningPrefMap, PostResetGoalValues } from "./types";
import { asPositiveInt } from "./jsonCoerce";

/**
 * Après reset : la semaine suivante peut promouvoir les objectifs de la semaine courante ;
 * puis les deux alignements (courant + suivant) reçoivent la même valeur cible.
 */
export function resolvePostResetGoals(prefMap: PlanningPrefMap): PostResetGoalValues {
  let newCal: number | undefined;
  const rawPlanCal = prefMap["planning_daily_goal"];
  if (typeof rawPlanCal === "number" && rawPlanCal > 0) newCal = rawPlanCal;
  const nCal = asPositiveInt(prefMap["next_week_daily_goal"]);
  if (nCal !== undefined) newCal = nCal;

  let newPro: number | undefined;
  const rawPlanPro = prefMap["planning_protein_goal"];
  if (typeof rawPlanPro === "number" && rawPlanPro > 0) newPro = rawPlanPro;
  const nPro = asPositiveInt(prefMap["next_week_protein_goal"]);
  if (nPro !== undefined) newPro = nPro;

  const out: PostResetGoalValues = {};
  if (newCal && newCal > 0) {
    out.planning_daily_goal = newCal;
    out.next_week_daily_goal = newCal;
  }
  if (newPro && newPro > 0) {
    out.planning_protein_goal = newPro;
    out.next_week_protein_goal = newPro;
  }
  return out;
}
