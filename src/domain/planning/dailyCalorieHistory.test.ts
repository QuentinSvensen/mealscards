import { describe, expect, it } from "vitest";
import {
  backfillDailyCalorieHistoryFromBackup,
  ensurePreviousWeekCalorieHistory,
  mergeDailyCalorieHistory,
  resolveBackupWeekRange,
} from "./dailyCalorieHistory";
import type { PossibleMealsFullBackup } from "./types";
import type { BackupCalorieDayContext } from "./rollingCalorieAverage";

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

describe("dailyCalorieHistory", () => {
  it("fusionne l'historique sans écraser les jours déjà renseignés par défaut", () => {
    const merged = mergeDailyCalorieHistory(
      { "2026-07-06": 2350 },
      { "2026-07-06": 1800, "2026-07-07": 2315 },
    );
    expect(merged["2026-07-06"]).toBe(2350);
    expect(merged["2026-07-07"]).toBe(2315);
  });

  it("écrase l'historique avec la valeur recalculée quand overwrite est demandé", () => {
    const merged = mergeDailyCalorieHistory(
      { "2026-07-06": 9000 },
      { "2026-07-06": 2305 },
      { overwrite: true },
    );
    expect(merged["2026-07-06"]).toBe(2305);
  });

  it("résout la plage ISO explicite d'une sauvegarde", () => {
    const backup: PossibleMealsFullBackup = {
      cards: [],
      manualCalories: {},
      manualProteins: {},
      manualFibers: {},
      extraCalories: {},
      extraProteins: {},
      extraFibers: {},
      extraSelections: {},
      extraSlotAssignments: {},
      breakfastManualCalories: {},
      breakfastManualProteins: {},
      breakfastSelections: {},
      drinkChecks: {},
      calOverrides: {},
      proOverrides: {},
      daily_goal: null,
      protein_goal: null,
      weekStartISO: "2026-07-06",
      weekEndISO: "2026-07-12",
    };
    expect(resolveBackupWeekRange(backup)).toEqual({
      startISO: "2026-07-06",
      endISO: "2026-07-12",
    });
  });

  it("recalcule la semaine archivée et remplace l'historique (même surévalué)", () => {
    const backup: PossibleMealsFullBackup = {
      cards: [],
      manualCalories: { "2026-07-12-soir": 2305 },
      manualProteins: {},
      manualFibers: {},
      extraCalories: {},
      extraProteins: {},
      extraFibers: {},
      extraSelections: {},
      extraSlotAssignments: {},
      breakfastManualCalories: {},
      breakfastManualProteins: {},
      breakfastSelections: {},
      drinkChecks: {},
      calOverrides: {},
      proOverrides: {},
      daily_goal: null,
      protein_goal: null,
      weekStartISO: "2026-07-12",
      weekEndISO: "2026-07-12",
    };

    const filled = backfillDailyCalorieHistoryFromBackup(
      { "2026-07-12": 9000 },
      backup,
      { ...emptyCtx, manualCalories: backup.manualCalories },
      new Map(),
      [],
      [],
      {},
      [],
    );

    expect(filled["2026-07-12"]).toBe(2305);
  });

  it("archive toute la semaine précédente depuis la sauvegarde", () => {
    const backup: PossibleMealsFullBackup = {
      cards: [],
      manualCalories: {
        "2026-07-06-midi": 2300,
        "2026-07-07-midi": 2310,
        "2026-07-08-midi": 2305,
        "2026-07-09-midi": 2315,
        "2026-07-10-midi": 2300,
        "2026-07-11-midi": 2305,
        "2026-07-12-midi": 2305,
      },
      manualProteins: {},
      manualFibers: {},
      extraCalories: {},
      extraProteins: {},
      extraFibers: {},
      extraSelections: {},
      extraSlotAssignments: {},
      breakfastManualCalories: {},
      breakfastManualProteins: {},
      breakfastSelections: {},
      drinkChecks: {},
      calOverrides: {},
      proOverrides: {},
      daily_goal: null,
      weekStartISO: "2026-07-06",
      weekEndISO: "2026-07-12",
    };

    const previousWeekDates = [
      { iso: "2026-07-06", key: "lundi" as const, display: "" },
      { iso: "2026-07-07", key: "mardi" as const, display: "" },
      { iso: "2026-07-08", key: "mercredi" as const, display: "" },
      { iso: "2026-07-09", key: "jeudi" as const, display: "" },
      { iso: "2026-07-10", key: "vendredi" as const, display: "" },
      { iso: "2026-07-11", key: "samedi" as const, display: "" },
      { iso: "2026-07-12", key: "dimanche" as const, display: "" },
    ];

    const archived = ensurePreviousWeekCalorieHistory(
      { "2026-07-06": 1970, "2026-07-07": 1970 },
      backup,
      { ...emptyCtx, manualCalories: backup.manualCalories },
      previousWeekDates,
      new Map(),
      [],
      [],
      {},
      [],
    );

    expect(archived["2026-07-06"]).toBe(2300);
    expect(archived["2026-07-12"]).toBe(2305);
  });
});
