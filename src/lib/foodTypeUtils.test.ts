import { describe, expect, it } from "vitest";
import {
  cycleFoodType,
  listFoodItemsMatchingIngredientKey,
  lookupFoodTypeMemory,
  resolveIngredientFoodType,
} from "@/lib/foodTypeUtils";

describe("foodTypeUtils", () => {
  it("cycleFoodType enchaîne aucun → féculent → viande → aucun", () => {
    expect(cycleFoodType(null)).toBe("feculent");
    expect(cycleFoodType("feculent")).toBe("viande");
    expect(cycleFoodType("viande")).toBe(null);
  });

  it("resolveIngredientFoodType privilégie le stock Aliments puis la bibliothèque", () => {
    expect(
      resolveIngredientFoodType(
        "poulet",
        [{ name: "Poulet", food_type: "viande" }],
        [{ name: "Poulet", food_type: "feculent" }],
      ),
    ).toBe("viande");

    expect(
      resolveIngredientFoodType(
        "poulet",
        [{ name: "Poulet", food_type: null }],
        [{ name: "Poulet", food_type: "viande" }],
      ),
    ).toBe(null);

    expect(
      resolveIngredientFoodType(
        "poulet",
        [],
        [{ name: "Poulet", food_type: "viande" }],
      ),
    ).toBe("viande");
  });

  it("lookupFoodTypeMemory retrouve un type par nom normalisé", () => {
    expect(lookupFoodTypeMemory("Poulets", [{ name: "Poulet", food_type: "viande" }])).toBe("viande");
    expect(lookupFoodTypeMemory("Riz basmati", [{ name: "Poulet", food_type: "viande" }])).toBeUndefined();
  });

  it("listFoodItemsMatchingIngredientKey filtre par clé normalisée", () => {
    const items = [
      { id: "1", name: "Poulet", food_type: "viande" as const },
      { id: "2", name: "Riz", food_type: "feculent" as const },
    ];
    expect(listFoodItemsMatchingIngredientKey("poulet", items)).toEqual([items[0]]);
  });
});
