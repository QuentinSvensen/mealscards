import { describe, expect, it } from "vitest";
import { embedPlanningSnapshotsInBackup } from "./embedPlanningSnapshotsInBackup";
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
    daily_goal: 2200,
    protein_goal: 120,
    daily_goal_low: 2000,
    weekStartISO: "2026-07-20",
    weekEndISO: "2026-07-26",
    ...overrides,
  };
}

describe("embedPlanningSnapshotsInBackup", () => {
  it("copie les snapshots extra et créneaux manuels dans le backup", () => {
    const backup = emptyBackup();
    const week = [{ key: "mercredi" as const, iso: "2026-07-23", display: "MERCREDI 23/07" }];
    const snapshots = {
      "extra-2026-07-23": { cal: 213, prot: 2, fiber: 1 },
      "manual-2026-07-23-midi": { cal: 900, prot: 35 },
    };
    const out = embedPlanningSnapshotsInBackup(backup, snapshots, week);
    expect(out.extraCalories["2026-07-23"]).toBe(213);
    expect(out.extraProteins["2026-07-23"]).toBe(2);
    expect(out.extraFibers["2026-07-23"]).toBe(1);
    expect(out.manualCalories["2026-07-23-midi"]).toBe(900);
    expect(out.manualProteins["2026-07-23-midi"]).toBe(35);
    expect(out.savedSnapshots?.["extra-2026-07-23"]).toEqual(snapshots["extra-2026-07-23"]);
  });

  it("ne remplace pas une pref live déjà présente", () => {
    const backup = emptyBackup({
      extraCalories: { "2026-07-23": 50 },
    });
    const week = [{ key: "mercredi" as const, iso: "2026-07-23", display: "MERCREDI 23/07" }];
    const out = embedPlanningSnapshotsInBackup(backup, {
      "extra-2026-07-23": { cal: 213 },
    }, week);
    expect(out.extraCalories["2026-07-23"]).toBe(50);
  });
});
