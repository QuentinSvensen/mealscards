import { describe, expect, it } from "vitest";
import { formatPlanningSnapshotTitle } from "./formatPlanningSnapshotTitle";

describe("formatPlanningSnapshotTitle", () => {
  it("invite à sauvegarder quand aucun snapshot", () => {
    expect(formatPlanningSnapshotTitle(undefined)).toContain("Sauvegarder");
  });

  it("affiche le nom si nameFallback", () => {
    expect(formatPlanningSnapshotTitle({ name: "Porridge", cal: 200 }, { nameFallback: true })).toBe(
      "Sauvegardé: Porridge (Double-clic pour oublier)",
    );
  });

  it("affiche macros et itemCount", () => {
    expect(
      formatPlanningSnapshotTitle({ cal: 100, prot: 10, fiber: 5 }, { itemCount: 2 }),
    ).toBe("Sauvegardé: 100 kcal / 10 prot / 5 fib, 2 items (Double-clic pour oublier)");
  });
});
