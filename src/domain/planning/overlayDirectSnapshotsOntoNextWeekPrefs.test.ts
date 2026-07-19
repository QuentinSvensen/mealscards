import { describe, expect, it } from "vitest";
import { overlayDirectSnapshotsOntoNextWeekPrefs } from "./overlayDirectSnapshotsOntoNextWeekPrefs";

const nextWeek = [
  { key: "lundi", iso: "2026-07-20", display: "" },
  { key: "mardi", iso: "2026-07-21", display: "" },
] as const;

describe("overlayDirectSnapshotsOntoNextWeekPrefs", () => {
  it("injecte extras / manuels / petit-déj des snapshots directs quand next_week_* est vide", () => {
    const out = overlayDirectSnapshotsOntoNextWeekPrefs(
      {
        breakfastSelections: {},
        breakfastManualCalories: {},
        breakfastManualProteins: {},
        manualCalories: {},
        manualProteins: {},
        manualFibers: {},
        extraCalories: {},
        extraProteins: {},
        extraFibers: {},
        extraSelections: {},
      },
      {
        "extra-2026-07-20": { cal: 43, prot: 1, itemIds: ["food-a"] },
        "manual-2026-07-20-midi": { cal: 500, prot: 40 },
        "breakfast-lundi": { cal: 120, prot: 8, mealId: "meal:pdej" },
      },
      [...nextWeek],
    );

    expect(out.extraCalories["2026-07-20"]).toBe(43);
    expect(out.extraProteins["2026-07-20"]).toBe(1);
    expect(out.extraSelections["2026-07-20"]).toEqual(["food-a"]);
    expect(out.manualCalories["2026-07-20-midi"]).toBe(500);
    expect(out.breakfastSelections["2026-07-20"]).toBe("meal:pdej");
    expect(out.breakfastManualCalories["2026-07-20"]).toBe(120);
  });

  it("ne remplace pas une pref next_week déjà présente (même à 0)", () => {
    const out = overlayDirectSnapshotsOntoNextWeekPrefs(
      {
        breakfastSelections: {},
        breakfastManualCalories: {},
        breakfastManualProteins: {},
        manualCalories: {},
        manualProteins: {},
        manualFibers: {},
        extraCalories: { "2026-07-20": 0 },
        extraProteins: {},
        extraFibers: {},
        extraSelections: { "2026-07-20": [] },
      },
      {
        "extra-2026-07-20": { cal: 43, prot: 1, itemIds: ["food-a"] },
      },
      [...nextWeek],
    );

    expect(out.extraCalories["2026-07-20"]).toBe(0);
    expect(out.extraSelections["2026-07-20"]).toEqual([]);
  });

  it("ignore les snapshots d’anciennes ISO du même jour de semaine", () => {
    const out = overlayDirectSnapshotsOntoNextWeekPrefs(
      {
        breakfastSelections: {},
        breakfastManualCalories: {},
        breakfastManualProteins: {},
        manualCalories: {},
        manualProteins: {},
        manualFibers: {},
        extraCalories: {},
        extraProteins: {},
        extraFibers: {},
        extraSelections: {},
      },
      {
        // Lundi de la semaine courante — ne doit pas fuiter sur lun. 20
        "extra-2026-07-13": { cal: 99, prot: 9, itemIds: ["old"] },
      },
      [...nextWeek],
    );

    expect(out.extraCalories["2026-07-20"]).toBeUndefined();
    expect(out.extraSelections["2026-07-20"]).toBeUndefined();
  });
});
