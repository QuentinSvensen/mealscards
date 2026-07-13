import { describe, it, expect } from "vitest";
import {
  computeRolling7DayCalorieAverage,
  computeRollingCalorieDiagnostics,
  computeRollingDayCalorieAverage,
  ROLLING_WINDOW_7_DAYS,
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

  it("utilise l'historique pour les jours hors semaine courante", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);

    const dailyCalorieHistory: Record<string, number> = {};
    for (let i = 1; i <= 13; i++) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      dailyCalorieHistory[d.toISOString().slice(0, 10)] = 2300;
    }

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2100 : 0),
      currentWeekIsos,
      dailyCalorieHistory,
      backupCtx: emptyCtx,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(14);
    expect(result.average).toBe(Math.round((13 * 2300 + 2100) / 14));
  });

  it("utilise la sauvegarde uniquement pour sa plage ISO", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);

    const backupCtx: BackupCalorieDayContext = {
      ...emptyCtx,
      manualCalories: {
        "2026-07-12-soir": 2315,
        "2026-07-05-soir": 9999,
      },
    };

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2000 : 5000),
      currentWeekIsos,
      dailyCalorieHistory: {},
      backupCtx,
      backupWeekRange: { startISO: "2026-07-06", endISO: "2026-07-12" },
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(2);
    expect(result.average).toBe(Math.round((2000 + 2315) / 2));
  });

  it("retombe sur zéro si ni historique ni sauvegarde ne couvrent le jour", () => {
    const refDate = new Date("2026-07-06T12:00:00");
    const currentWeekIsos = new Set(["2026-07-06"]);

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: () => 2300,
      currentWeekIsos,
      dailyCalorieHistory: {},
      backupCtx: null,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(1);
    expect(result.average).toBe(2300);
  });

  it("utilise l'historique avant la sauvegarde pour un jour archivé", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);

    const backupCtx: BackupCalorieDayContext = {
      ...emptyCtx,
      extraSelections: {
        "2026-07-12": ["custom::Vacherin::117::1"],
      },
    };

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2300 : 0),
      currentWeekIsos,
      dailyCalorieHistory: { "2026-07-12": 2305 },
      backupCtx,
      backupWeekRange: { startISO: "2026-07-06", endISO: "2026-07-12" },
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(2);
    expect(result.average).toBe(Math.round((2300 + 2305) / 2));
  });

  it("limite la fenêtre à 7 jours quand rollingDays vaut 7", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);

    const dailyCalorieHistory: Record<string, number> = {};
    for (let i = 1; i <= 6; i++) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      dailyCalorieHistory[d.toISOString().slice(0, 10)] = 2315;
    }
    dailyCalorieHistory["2026-06-29"] = 1500;

    const result7 = computeRollingDayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2300 : 0),
      currentWeekIsos,
      dailyCalorieHistory,
      backupCtx: emptyCtx,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
      rollingDays: ROLLING_WINDOW_7_DAYS,
    });

    expect(result7.daysCounted).toBe(7);
    expect(result7.average).toBe(Math.round((6 * 2315 + 2300) / 7));
  });

  it("identifie la chute de moyenne quand le jour J-7 est sous-évalué", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);
    const dailyCalorieHistory: Record<string, number> = {};
    for (let i = 1; i <= 6; i++) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      dailyCalorieHistory[d.toISOString().slice(0, 10)] = 2315;
    }
    dailyCalorieHistory["2026-07-06"] = 1200;

    const { daily, windows } = computeRollingCalorieDiagnostics({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2300 : 0),
      currentWeekIsos,
      dailyCalorieHistory,
      backupCtx: emptyCtx,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(windows.find((w) => w.windowDays === 7)?.average).toBe(Math.round((6 * 2315 + 2300) / 7));
    expect(windows.find((w) => w.windowDays === 8)?.average).toBeLessThan(
      windows.find((w) => w.windowDays === 7)!.average,
    );
    expect(daily.find((d) => d.offset === 7)?.calories).toBe(1200);
  });
});
