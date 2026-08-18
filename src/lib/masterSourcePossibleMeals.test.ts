import { describe, it, expect } from "vitest";
import { addMasterSourcePmIds, isMasterSourcePossibleMeal, isPossibleMealStockExempt } from "@/lib/masterSourcePossibleMeals";

describe("masterSourcePossibleMeals", () => {
  it("addMasterSourcePmIds fusionne sans doublons", () => {
    const next = addMasterSourcePmIds(new Set(["a"]), ["b", "a", "c"]);
    expect(Array.from(next)).toEqual(["a", "b", "c"]);
  });

  it("isMasterSourcePossibleMeal lit Set et array", () => {
    expect(isMasterSourcePossibleMeal("x", new Set(["x"]))).toBe(true);
    expect(isMasterSourcePossibleMeal("x", ["y", "x"])).toBe(true);
    expect(isMasterSourcePossibleMeal("x", ["y"])).toBe(false);
  });

  it("isPossibleMealStockExempt : Recettes testées même hors liste Tous", () => {
    expect(
      isPossibleMealStockExempt(
        { id: "pm-pot", meal_id: "meal-pot" },
        new Set(),
        { ninjaTestPmIds: [], ninjaTestedMealIds: ["meal-pot"] },
      ),
    ).toBe(true);
  });

  it("isPossibleMealStockExempt : Tests → Possible même hors liste Tous", () => {
    expect(
      isPossibleMealStockExempt(
        { id: "pm-test", meal_id: "meal-x" },
        [],
        { ninjaTestPmIds: ["pm-test"], ninjaTestedMealIds: [] },
      ),
    ).toBe(true);
  });

  it("isPossibleMealStockExempt : carte stock normale", () => {
    expect(
      isPossibleMealStockExempt(
        { id: "pm-stock", meal_id: "meal-y" },
        new Set(["other"]),
        { ninjaTestPmIds: [], ninjaTestedMealIds: [] },
      ),
    ).toBe(false);
  });
});
