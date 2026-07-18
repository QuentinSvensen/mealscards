import type { PlanningPrefMap, PostResetGoalValues } from "./types";
import { asPositiveInt } from "./jsonCoerce";

/**
 * Après reset : la semaine suivante peut promouvoir les objectifs de la semaine courante ;
 * puis les deux alignements (courant + suivant) reçoivent la même valeur cible.
 * Couvre aussi fourchette basse (kcal) et objectif fibres.
 */
export function resolvePostResetGoals(prefMap: PlanningPrefMap): PostResetGoalValues {
  let newCal: number | undefined;
  const rawPlanCal = prefMap["planning_daily_goal"];
  if (typeof rawPlanCal === "number" && rawPlanCal > 0) newCal = rawPlanCal;
  const nCal = asPositiveInt(prefMap["next_week_daily_goal"]);
  if (nCal !== undefined) newCal = nCal;

  let newCalLow: number | undefined;
  const rawPlanCalLow = prefMap["planning_daily_goal_low"];
  if (typeof rawPlanCalLow === "number" && rawPlanCalLow >= 0) newCalLow = rawPlanCalLow;
  const nCalLow = asPositiveInt(prefMap["next_week_daily_goal_low"]);
  if (nCalLow !== undefined) newCalLow = nCalLow;
  // 0 est une valeur valide (fourchette désactivée) : la promouvoir si next_week est explicitement 0.
  if (prefMap["next_week_daily_goal_low"] === 0) newCalLow = 0;

  let newPro: number | undefined;
  const rawPlanPro = prefMap["planning_protein_goal"];
  if (typeof rawPlanPro === "number" && rawPlanPro > 0) newPro = rawPlanPro;
  const nPro = asPositiveInt(prefMap["next_week_protein_goal"]);
  if (nPro !== undefined) newPro = nPro;

  let newFiber: number | undefined;
  const rawPlanFiber = prefMap["planning_fiber_goal"];
  if (typeof rawPlanFiber === "number" && rawPlanFiber > 0) newFiber = rawPlanFiber;
  const nFiber = asPositiveInt(prefMap["next_week_fiber_goal"]);
  if (nFiber !== undefined) newFiber = nFiber;

  const out: PostResetGoalValues = {};
  if (newCal && newCal > 0) {
    out.planning_daily_goal = newCal;
    out.next_week_daily_goal = newCal;
  }
  if (newCalLow !== undefined && newCalLow >= 0) {
    const clampedLow = newCal && newCal > 0 ? Math.min(newCalLow, newCal) : newCalLow;
    out.planning_daily_goal_low = clampedLow;
    out.next_week_daily_goal_low = clampedLow;
  }
  if (newPro && newPro > 0) {
    out.planning_protein_goal = newPro;
    out.next_week_protein_goal = newPro;
  }
  if (newFiber && newFiber > 0) {
    out.planning_fiber_goal = newFiber;
    out.next_week_fiber_goal = newFiber;
  }
  return out;
}
