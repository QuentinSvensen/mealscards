import { describe, it, expect } from "vitest";
import { addMasterSourcePmIds, isMasterSourcePossibleMeal } from "@/lib/masterSourcePossibleMeals";

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
});
