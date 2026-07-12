import { describe, it, expect } from "vitest";
import {
  computeRolling7DayCalorieAverage,
  type BackupCalorieDayContext,
} from "./rollingCalorieAverage";

describe("computeRolling7DayCalorieAverage", () => {
  const emptyCtx: BackupCalorieDayContext = {
    cards: [],
    manualCalories: {},
    manualProteins: {},
    extraCalories: {},
    extraProteins: {},
    extraSelections: {},
    extraSlotAssignments: {},
    breakfastManualCalories: {},
    breakfastManualProteins: {},
    breakfastSelections: {},
    drinkChecks: {},
    calOverrides: {},
    proOverrides: {},
  };

  it("utilise la sauvegarde pour les jours hors semaine courante", () => {
    const refDate = new Date("2026-07-06T12:00:00");
    const currentWeekIsos = new Set([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    const backupIsos = Array.from({ length: 13 }, (_, i) => {
      const d = new Date(refDate);
      d.setDate(d.getDate() - (i + 1));
      return d.toISOString().slice(0, 10);
    });
    const backupCtx: BackupCalorieDayContext = {
      ...emptyCtx,
      manualCalories: Object.fromEntries(
        backupIsos.map((iso) => [`${iso}-soir`, 2300]),
      ),
    };

    const avg = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (key, iso) => (iso === "2026-07-06" ? 2300 : 0),
      currentWeekIsos,
      backupCtx,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    // 13 jours backup à 2300 + aujourd'hui 2300 = 2300/j
    expect(avg).toBe(2300);
  });

  it("retombe sur le live si la sauvegarde est absente", () => {
    const refDate = new Date("2026-07-06T12:00:00");
    const currentWeekIsos = new Set(["2026-07-06"]);

    const avg = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-06" ? 2300 : 0),
      currentWeekIsos,
      backupCtx: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(avg).toBe(Math.round(2300 / 14));
  });
});
