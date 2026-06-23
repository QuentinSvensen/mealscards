import { describe, expect, it } from "vitest";
import { computeNutritionScoreV7, getMealNutritionScore } from "@/lib/nutritionScore";

describe("computeNutritionScoreV7", () => {
  it("retourne 100 pour une densité protéique parfaite sans fibres", () => {
    expect(computeNutritionScoreV7(500, 50, 0)).toBe(100);
  });

  it("ajoute un bonus fibres sans pénaliser l'absence de fibres", () => {
    expect(computeNutritionScoreV7(500, 50, 5)).toBe(100);
    expect(computeNutritionScoreV7(869, 71, 1)).toBe(83);
  });

  it("retourne null si calories ou protéines manquantes", () => {
    expect(computeNutritionScoreV7(null, 40, 5)).toBeNull();
    expect(computeNutritionScoreV7(500, null, 5)).toBeNull();
  });
});

describe("getMealNutritionScore", () => {
  it("ignore les catégories hors Plat / Petit déj", () => {
    expect(
      getMealNutritionScore({
        category: "dessert",
        calories: "500",
        protein: "50",
        fiber: "5",
      }),
    ).toBeNull();
  });

  it("calcule depuis les macros directes pour un petit déj sans ingrédients", () => {
    expect(
      getMealNutritionScore({
        category: "petit_dejeuner",
        calories: "345",
        protein: "43",
        fiber: "7",
      }),
    ).toBe(100);
  });
});
