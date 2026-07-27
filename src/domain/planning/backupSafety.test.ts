import { describe, expect, it } from "vitest";
import {
  fillMissingBackupWeekRange,
  isBackupEffectivelyEmpty,
  shouldReplaceBackup,
} from "./backupSafety";
import type { PossibleMealsFullBackup } from "./types";

/** Construit une sauvegarde minimale pour les tests. */
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
    weekStartISO: null,
    weekEndISO: null,
    ...overrides,
  };
}

describe("backupSafety", () => {
  it("considère vide une sauvegarde sans cartes ni saisies", () => {
    expect(isBackupEffectivelyEmpty(emptyBackup())).toBe(true);
    expect(isBackupEffectivelyEmpty(null)).toBe(true);
  });

  it("considère non vide une sauvegarde avec des cartes", () => {
    const backup = emptyBackup({
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-20",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    expect(isBackupEffectivelyEmpty(backup)).toBe(false);
  });

  it("refuse d’écraser une archive non vide par une sauvegarde vide", () => {
    const existing = emptyBackup({
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-20",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    const next = emptyBackup();
    expect(shouldReplaceBackup(existing, next)).toBe(false);
  });

  it("autorise le remplacement quand la nouvelle sauvegarde a du contenu", () => {
    const existing = emptyBackup({
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-13",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    const next = emptyBackup({
      cards: [
        {
          id: "c2",
          meal_id: "m2",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-20",
          meal_time: "soir",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    expect(shouldReplaceBackup(existing, next)).toBe(true);
  });

  it("ne re-date pas une sauvegarde qui a déjà une plage ISO", () => {
    const backup = emptyBackup({
      weekStartISO: "2026-07-13",
      weekEndISO: "2026-07-19",
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-13",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    expect(fillMissingBackupWeekRange(backup)).toBe(backup);
  });

  it("déduit la plage des dates présentes quand elle est absente", () => {
    const backup = emptyBackup({
      cards: [
        {
          id: "c1",
          meal_id: "m1",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-20",
          meal_time: "midi",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
        {
          id: "c2",
          meal_id: "m2",
          quantity: 1,
          expiration_date: null,
          day_of_week: "2026-07-25",
          meal_time: "soir",
          counter_start_date: null,
          sort_order: 0,
          ingredients_override: null,
        },
      ],
    });
    const filled = fillMissingBackupWeekRange(backup);
    expect(filled.weekStartISO).toBe("2026-07-20");
    expect(filled.weekEndISO).toBe("2026-07-25");
  });
});
