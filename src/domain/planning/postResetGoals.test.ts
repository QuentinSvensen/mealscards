import { describe, expect, it } from "vitest";
import { resolvePostResetGoals } from "./postResetGoals";

describe("resolvePostResetGoals", () => {
  it("promouvoit la borne min positive de Suiv. sur la semaine courante", () => {
    const out = resolvePostResetGoals({
      planning_daily_goal: 2300,
      planning_daily_goal_low: 2000,
      next_week_daily_goal: 2300,
      next_week_daily_goal_low: 2100,
    });
    expect(out.planning_daily_goal_low).toBe(2100);
    expect(out.next_week_daily_goal_low).toBe(2100);
  });

  it("n’écrase pas une borne min positive par un 0 accidentel de Suiv.", () => {
    const out = resolvePostResetGoals({
      planning_daily_goal: 2300,
      planning_daily_goal_low: 2000,
      next_week_daily_goal: 2300,
      next_week_daily_goal_low: 0,
    });
    expect(out.planning_daily_goal_low).toBe(2000);
    expect(out.next_week_daily_goal_low).toBe(2000);
  });

  it("accepte la désactivation de la fourchette quand les deux côtés sont à 0", () => {
    const out = resolvePostResetGoals({
      planning_daily_goal: 2300,
      planning_daily_goal_low: 0,
      next_week_daily_goal: 2300,
      next_week_daily_goal_low: 0,
    });
    expect(out.planning_daily_goal_low).toBe(0);
    expect(out.next_week_daily_goal_low).toBe(0);
  });

  it("archive correctement daily_goal_low via les valeurs résolues", () => {
    const out = resolvePostResetGoals({
      planning_daily_goal: 2300,
      planning_daily_goal_low: 2000,
    });
    expect(out.planning_daily_goal).toBe(2300);
    expect(out.planning_daily_goal_low).toBe(2000);
  });
});
