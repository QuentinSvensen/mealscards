import { describe, expect, it } from "vitest";
import {
  parseWeeklyGoalsHistory,
  readWeeklyGoals,
  upsertWeeklyGoals,
} from "./weeklyGoalsHistory";

describe("weeklyGoalsHistory", () => {
  it("parse un historique valide et ignore les entrées incomplètes", () => {
    const history = parseWeeklyGoalsHistory({
      "2026-07-20": { dailyGoal: 2200, dailyGoalLow: 2000, proteinGoal: 120, fiberGoal: 30 },
      "2026-07-13": { dailyGoal: 0 },
      "2026-07-06": "nope",
    });
    expect(Object.keys(history)).toEqual(["2026-07-20"]);
    expect(readWeeklyGoals(history, "2026-07-20")).toEqual({
      dailyGoal: 2200,
      dailyGoalLow: 2000,
      proteinGoal: 120,
      fiberGoal: 30,
    });
  });

  it("retourne null quand les objectifs sont inchangés", () => {
    const entry = { dailyGoal: 2200, dailyGoalLow: 2000, proteinGoal: 120, fiberGoal: 30 };
    const history = { "2026-07-20": entry };
    expect(upsertWeeklyGoals(history, "2026-07-20", { ...entry })).toBeNull();
  });

  it("enregistre une nouvelle semaine", () => {
    const updated = upsertWeeklyGoals({}, "2026-07-20", {
      dailyGoal: 2200,
      dailyGoalLow: 2000,
      proteinGoal: 120,
      fiberGoal: 30,
    });
    expect(updated?.["2026-07-20"].dailyGoalLow).toBe(2000);
  });

  it("refuse une semaine sans objectif calorique", () => {
    expect(
      upsertWeeklyGoals({}, "2026-07-20", {
        dailyGoal: 0,
        dailyGoalLow: 0,
        proteinGoal: 0,
        fiberGoal: 0,
      }),
    ).toBeNull();
  });
});
