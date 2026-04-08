import type { PlanningPrefMap, PostResetGoalValues } from "./types";
import { asPositiveInt } from "./jsonCoerce";

/**
 * Après reset : la semaine suivante peut promouvoir les objectifs de la semaine courante ;
 * puis les deux alignements (courant + suivant) reçoivent la même valeur cible.
 */
export function resolvePostResetGoals(prefMap: PlanningPrefMap): PostResetGoalValues {
  const nCal = asPositiveInt(prefMap["next_week_daily_goal"]);
  const nPro = asPositiveInt(prefMap["next_week_protein_goal"]);
  let newCal = asPositiveInt(prefMap["planning_daily_goal"]);
  let newPro = asPositiveInt(prefMap["planning_protein_goal"]);
  if (nCal !== undefined) newCal = nCal;
  if (nPro !== undefined) newPro = nPro;

  const out: PostResetGoalValues = {};
  if (newCal !== undefined && newCal > 0) {
    out.planning_daily_goal = newCal;
    out.next_week_daily_goal = newCal;
  }
  if (newPro !== undefined && newPro > 0) {
    out.planning_protein_goal = newPro;
    out.next_week_protein_goal = newPro;
  }
  return out;
}
