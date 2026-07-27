import { describe, expect, it } from "vitest";
import type { PossibleMealsFullBackup } from "./types";
import { assertResetCanProceed, buildPlanningResetReport } from "./resetReport";

const emptyBackup = { cards: [] } as unknown as PossibleMealsFullBackup;
const filledBackup = {
  cards: [{ id: "1", day_of_week: "2026-07-20" }],
  weekStartISO: "2026-07-20",
  weekEndISO: "2026-07-26",
  extraCalories: { "2026-07-22": 213 },
  manualCalories: { "2026-07-22-midi": 500 },
} as unknown as PossibleMealsFullBackup;

describe("resetReport", () => {
  it("bloque un reset qui archiverait une semaine vide alors qu’une archive existe", () => {
    expect(() => assertResetCanProceed(filledBackup, emptyBackup)).toThrow(/Reset annulé/);
  });

  it("laisse passer un reset dont l’archive contient des données", () => {
    expect(() => assertResetCanProceed(filledBackup, filledBackup)).not.toThrow();
  });

  it("laisse passer le premier reset même sans données", () => {
    expect(() => assertResetCanProceed(null, emptyBackup)).not.toThrow();
  });

  it("résume le contenu archivé", () => {
    const report = buildPlanningResetReport(filledBackup, "manual_button", true, "2026-07-27T06:00:00.000Z");
    expect(report).toEqual({
      at: "2026-07-27T06:00:00.000Z",
      source: "manual_button",
      archivedWeekStartISO: "2026-07-20",
      archivedWeekEndISO: "2026-07-26",
      archivedCards: 1,
      archivedExtraKeys: 1,
      archivedManualKeys: 1,
      backupReplaced: true,
    });
  });
});
