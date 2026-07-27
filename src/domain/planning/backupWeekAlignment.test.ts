import { describe, expect, it } from "vitest";
import {
  buildDisplayToArchivedIsoMap,
  filterBackupCardsForDisplayDay,
  prepareBackupForDisplayWeek,
  realignBackupCardsToWeekStart,
  reconcileBackupWeekRange,
  resolveArchivedPlanningGoals,
} from "./backupWeekAlignment";
import type { PossibleMealsFullBackup } from "./types";

function emptyBackup(overrides: Partial<PossibleMealsFullBackup> = {}): PossibleMealsFullBackup {
  return {
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
    daily_goal: 2300,
    protein_goal: 120,
    daily_goal_low: 2000,
    weekStartISO: "2026-07-20",
    weekEndISO: "2026-07-26",
    ...overrides,
  };
}

describe("backupWeekAlignment", () => {
  it("réaligne les cartes ISO hors plage vers la semaine weekStartISO", () => {
    const backup = emptyBackup({
      weekStartISO: "2026-07-20",
      weekEndISO: "2026-07-26",
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-14",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
          meal_name: "Test",
        },
      ],
    });
    const aligned = realignBackupCardsToWeekStart(backup);
    expect(aligned.cards[0].day_of_week).toBe("2026-07-21");
  });

  it("corrige une plage ISO incohérente avec le contenu", () => {
    const backup = emptyBackup({
      weekStartISO: "2026-07-20",
      weekEndISO: "2026-07-26",
      manualCalories: { "2026-07-14-midi": 900 },
    });
    const reconciled = reconcileBackupWeekRange(backup);
    expect(reconciled.weekStartISO).toBe("2026-07-14");
    expect(reconciled.weekEndISO).toBe("2026-07-14");
  });

  it("mappe la semaine affichée vers les ISO archivés par index lun→dim", () => {
    const backup = emptyBackup({
      weekStartISO: "2026-07-14",
      weekEndISO: "2026-07-20",
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-14",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    const displayWeek = [
      { key: "lundi" as const, iso: "2026-07-20", display: "LUNDI 20/07" },
      { key: "mardi" as const, iso: "2026-07-21", display: "MARDI 21/07" },
    ];
    const map = buildDisplayToArchivedIsoMap(displayWeek, backup);
    expect(map["2026-07-20"]).toBe("2026-07-14");
    expect(map["2026-07-21"]).toBe("2026-07-15");
    const dayCards = filterBackupCardsForDisplayDay(
      backup.cards,
      "2026-07-20",
      "lundi",
      map["2026-07-20"],
    );
    expect(dayCards).toHaveLength(1);
  });

  it("remappe les extras et saisies manuelles sur les ISO de la semaine affichée", () => {
    const backup = emptyBackup({
      weekStartISO: "2026-07-14",
      weekEndISO: "2026-07-20",
      extraCalories: { "2026-07-14": 213 },
      extraProteins: { "2026-07-14": 2 },
      extraFibers: { "2026-07-14": 1 },
      manualCalories: { "lundi-midi": 900 },
    });
    const displayWeek = [
      { key: "lundi" as const, iso: "2026-07-20", display: "LUNDI 20/07" },
    ];
    const { backup: prepared } = prepareBackupForDisplayWeek(backup, displayWeek);
    expect(prepared.extraCalories["2026-07-20"]).toBe(213);
    expect(prepared.extraProteins["2026-07-20"]).toBe(2);
    expect(prepared.extraFibers["2026-07-20"]).toBe(1);
    expect(prepared.manualCalories["2026-07-20-midi"]).toBe(900);
  });

  it("retombe sur les objectifs courants si la fourchette archivée est incomplète", () => {
    const backup = emptyBackup({
      daily_goal: 2300,
      daily_goal_low: 0,
    });
    const goals = resolveArchivedPlanningGoals(backup, 2200, 2000, 120, 30, 2750);
    expect(goals.archivedDailyGoalLow).toBe(2000);
    expect(goals.archivedDailyGoal).toBe(2200);
  });
});
