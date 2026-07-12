import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import {
  attachPortionDeduction,
  mergeDeductionSnapshotMaps,
  remapDessertFoodPreferenceIds,
  remapMorningMealPreferenceIds,
  wasDessertFoodSnapshot,
  wasMorningMealSnapshot,
} from "./stockDeductionSnapshot";

function makeFoodItem(overrides: Partial<FoodItem> & { id: string; name: string }): FoodItem {
  return {
    id: overrides.id,
    name: overrides.name,
    grams: "70",
    calories: "366",
    protein: "29",
    fiber: "16",
    expiration_date: null,
    counter_start_date: null,
    sort_order: 0,
    created_at: "2026-01-01",
    is_meal: true,
    is_infinite: false,
    is_dry: false,
    is_indivisible: true,
    no_counter: false,
    storage_type: "frigo",
    quantity: 1,
    food_type: null,
    ...overrides,
  };
}

describe("stockDeductionSnapshot", () => {
  it("conserve le flag repas matin dans le snapshot de déduction", () => {
    const fi = makeFoodItem({ id: "old-id", name: "Barre Optimum Caramel" });
    const snap = attachPortionDeduction(fi, { grams: 70, quantity: 0 }, { wasMorningMeal: true });
    expect(wasMorningMealSnapshot(snap)).toBe(true);
  });

  it("réattribue la préférence repas matin vers la nouvelle fiche aliment", () => {
    const snap = attachPortionDeduction(
      makeFoodItem({ id: "old-id", name: "Barre Optimum Caramel" }),
      { grams: 70, quantity: 0 },
      { wasMorningMeal: true },
    );
    const restored = [makeFoodItem({ id: "new-id", name: "Barre Optimum Caramel" })];
    const next = remapMorningMealPreferenceIds([snap], restored, ["old-id"]);
    expect(next).toEqual(["new-id"]);
  });

  it("conserve le flag dessert dans le snapshot de déduction", () => {
    const snap = attachPortionDeduction(
      makeFoodItem({ id: "old-id", name: "Vacherin vanille framboise Picard" }),
      { grams: 0, quantity: 1 },
      { wasDessertFood: true },
    );
    expect(wasDessertFoodSnapshot(snap)).toBe(true);
  });

  it("réattribue la préférence dessert vers la nouvelle fiche aliment", () => {
    const snap = attachPortionDeduction(
      makeFoodItem({ id: "old-id", name: "Vacherin vanille framboise Picard" }),
      { grams: 0, quantity: 1 },
      { wasDessertFood: true },
    );
    const restored = [makeFoodItem({ id: "new-id", name: "Vacherin vanille framboise Picard", is_meal: false })];
    const next = remapDessertFoodPreferenceIds([snap], restored, ["old-id"]);
    expect(next).toEqual(["new-id"]);
  });

  it("fusionne snapshots persistés et locaux sans perdre les entrées anciennes", () => {
    const persisted = {
      "pm-hier": [makeFoodItem({ id: "tenders-1", name: "Tenders", counter_start_date: "2026-07-08T10:00:00.000Z" })],
    };
    const local = {
      "pm-aujourdhui": [makeFoodItem({ id: "poulet-1", name: "Poulet" })],
    };
    const merged = mergeDeductionSnapshotMaps(persisted, local);
    expect(Object.keys(merged).sort()).toEqual(["pm-aujourdhui", "pm-hier"]);
    expect(merged["pm-hier"][0].counter_start_date).toBe("2026-07-08T10:00:00.000Z");
  });
});
