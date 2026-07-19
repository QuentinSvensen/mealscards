import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import { buildFoodDessertExtraId } from "@/lib/foodDessertUtils";
import {
  aggregateExtraSelectionMacros,
  mergeExtraDaySelectionIds,
  pickPlanningDayValue,
  pickPlanningSlotValue,
  scaleExtraDisplayMacrosByCount,
} from "./planningExtraMacros";

function makeFoodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: "item-1",
    name: "Test",
    storage_type: "frigo",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as FoodItem;
}

describe("planningExtraMacros", () => {
  it("lit une préférence par ISO puis par clé jour", () => {
    const record = { vendredi: ["extra-a"], "2026-07-17": ["extra-b"] };
    expect(pickPlanningDayValue(record, "2026-07-17", "vendredi")).toEqual(["extra-b"]);
    expect(pickPlanningDayValue(record, undefined, "vendredi")).toEqual(["extra-a"]);
  });

  it("lit une préférence de créneau par ISO puis par clé jour", () => {
    const record = { "jeudi-midi": 800, "2026-07-10-midi": 900 };
    expect(pickPlanningSlotValue(record, "2026-07-10", "jeudi", "midi")).toBe(900);
    expect(pickPlanningSlotValue(record, undefined, "jeudi", "midi")).toBe(800);
  });

  it("compte les macros d'un dessert food-dessert via le catalogue quand le stock est épuisé", () => {
    const dessertExtraId = buildFoodDessertExtraId("deleted-id");
    const catalog = new Map([
      [dessertExtraId, { cal: 117, prot: 1, fiber: 1 }],
    ]);

    const macros = aggregateExtraSelectionMacros(
      [dessertExtraId],
      [],
      [],
      catalog,
      {},
    );

    expect(macros).toEqual({ cal: 117, pro: 1, fiber: 1 });
  });

  it("inclut la fibre d'un extra custom (0 si segment absent)", () => {
    expect(aggregateExtraSelectionMacros(["custom::Barre::200::10::4"], [], [], new Map(), {})).toEqual({
      cal: 200,
      pro: 10,
      fiber: 4,
    });
    expect(aggregateExtraSelectionMacros(["custom::Barre::200::10"], [], [], new Map(), {})).toEqual({
      cal: 200,
      pro: 10,
      fiber: 0,
    });
  });

  it("inclut les extras assignés à un créneau même s'ils manquent dans les sélections", () => {
    const merged = mergeExtraDaySelectionIds(
      [],
      { "2026-07-17-soir": [buildFoodDessertExtraId("deleted-id")] },
      "2026-07-17",
      "vendredi",
    );
    expect(merged).toEqual([buildFoodDessertExtraId("deleted-id")]);
  });

  it("multiplie les macros affichées par le nombre d'occurrences", () => {
    expect(scaleExtraDisplayMacrosByCount({ cal: 81, pro: 1, fiber: 0 }, 3)).toEqual({
      cal: 243,
      pro: 3,
      fiber: 0,
    });
    expect(scaleExtraDisplayMacrosByCount({ cal: 81, pro: 1, fiber: 0 }, 2)).toEqual({
      cal: 162,
      pro: 2,
      fiber: 0,
    });
  });
});
