import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import {
  computeBackupDayTotalCalories,
  computeRolling7DayCalorieAverage,
  computeRollingCalorieDiagnostics,
  computeRollingDayCalorieAverage,
  ROLLING_WINDOW_7_DAYS,
  ROLLING_WINDOW_14_DAYS,
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

    // Alias = fenêtre 14j : 1 live + 13 historique, moyenne / 14
    expect(result.daysCounted).toBe(14);
    expect(result.average).toBe(Math.round((13 * 2300 + 2100) / 14));
  });

  it("divise toujours par la taille de fenêtre (14j), pas seulement les jours renseignés", () => {
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
    expect(result.average).toBe(Math.round((2000 + 2315) / ROLLING_WINDOW_14_DAYS));
  });

  it("retombe sur une moyenne diluée si seul aujourd'hui a des données", () => {
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
    expect(result.average).toBe(Math.round(2300 / ROLLING_WINDOW_14_DAYS));
  });

  it("préfère la sauvegarde à un historique surévalué pour un jour archivé", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);

    const backupCtx: BackupCalorieDayContext = {
      ...emptyCtx,
      manualCalories: {
        "2026-07-12-soir": 2200,
      },
    };

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2300 : 0),
      currentWeekIsos,
      dailyCalorieHistory: { "2026-07-12": 9000 },
      backupCtx,
      backupWeekRange: { startISO: "2026-07-06", endISO: "2026-07-12" },
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(2);
    expect(result.average).toBe(Math.round((2300 + 2200) / ROLLING_WINDOW_14_DAYS));
  });

  it("ignore l'historique gonflé hors backup", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set(["2026-07-13"]);

    const result = computeRolling7DayCalorieAverage({
      getLiveDayCalories: (_key, iso) => (iso === "2026-07-13" ? 2300 : 0),
      currentWeekIsos,
      dailyCalorieHistory: {
        "2026-07-12": 9000,
        "2026-07-11": 9000,
        "2026-07-10": 9000,
      },
      backupCtx: emptyCtx,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
    });

    expect(result.daysCounted).toBe(1);
    expect(result.average).toBe(Math.round(2300 / ROLLING_WINDOW_14_DAYS));
  });

  it("ne double-compte pas les cartes présentes en ISO et en clé jour", () => {
    const meal = {
      id: "m1",
      name: "Test",
      calories: "1000",
      protein: "10",
      fiber: "0",
      category: "plat",
      ingredients: null,
    } as any;
    const mealsById = new Map([["m1", meal]]);
    const cardIso = {
      id: "c1",
      meal_id: "m1",
      quantity: 1,
      day_of_week: "2026-07-12",
      meal_time: "soir",
      expiration_date: null,
      counter_start_date: null,
      sort_order: 0,
      ingredients_override: null,
    };
    const cardKey = { ...cardIso, id: "c2", day_of_week: "dimanche" };
    const backupCtx: BackupCalorieDayContext = {
      ...emptyCtx,
      cards: [cardIso, cardKey] as any,
      calOverrides: { c1: "1000", c2: "1000" },
    };

    const total = computeBackupDayTotalCalories(
      backupCtx,
      "2026-07-12",
      "dimanche",
      mealsById,
      [],
    );

    expect(total).toBe(1000);
  });

  it("limite la fenêtre à 7 jours quand rollingDays vaut 7", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set([
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
    ]);

    const result7 = computeRollingDayCalorieAverage({
      getLiveDayCalories: (_key, iso) => {
        if (iso === "2026-07-13") return 2300;
        if (iso && iso >= "2026-07-07" && iso <= "2026-07-12") return 2315;
        return 0;
      },
      currentWeekIsos,
      dailyCalorieHistory: {},
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

  it("fait la moyenne sur 14 jours calendaires (historique inclus)", () => {
    const refDate = new Date("2026-07-31T12:00:00");
    const currentWeekIsos = new Set([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);

    const dailyCalorieHistory: Record<string, number> = {};
    // J-5 → J-13 : semaine préc. + 2 jours avant (1800 pour J-12/J-13)
    for (let i = 5; i <= 13; i++) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      const iso = format(d, "yyyy-MM-dd");
      dailyCalorieHistory[iso] = iso <= "2026-07-19" ? 1800 : 2200;
    }

    const result14 = computeRollingDayCalorieAverage({
      getLiveDayCalories: (_key, iso) => {
        if (iso && iso >= "2026-07-27" && iso <= "2026-07-31") return 2100;
        return 0;
      },
      currentWeekIsos,
      dailyCalorieHistory,
      backupCtx: emptyCtx,
      backupWeekRange: null,
      mealsById: new Map(),
      foodItems: [],
      refDate,
      rollingDays: ROLLING_WINDOW_14_DAYS,
    });

    // 5×2100 + 7×2200 + 2×1800 = 29500 ; /14
    expect(result14.daysCounted).toBe(14);
    expect(result14.average).toBe(Math.round(29500 / 14));
  });

  it("identifie la chute de moyenne quand le jour J-7 est sous-évalué", () => {
    const refDate = new Date("2026-07-13T12:00:00");
    const currentWeekIsos = new Set([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
    ]);

    const { daily, windows } = computeRollingCalorieDiagnostics({
      getLiveDayCalories: (_key, iso) => {
        if (iso === "2026-07-13") return 2300;
        if (iso === "2026-07-06") return 1200;
        if (iso && iso >= "2026-07-07" && iso <= "2026-07-12") return 2315;
        return 0;
      },
      currentWeekIsos,
      dailyCalorieHistory: {},
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
