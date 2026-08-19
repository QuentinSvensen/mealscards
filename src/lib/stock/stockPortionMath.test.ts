import { describe, expect, it } from "vitest";
import { getFoodItemTotalGrams } from "@/lib/ingredientUtils";
import type { FoodItem } from "@/types/food";
import {
  applyGramsDeltaToFoodItem,
  gramsToRestoreTowardSnapshot,
} from "./stockPortionMath";

function food(grams: string | null, quantity: number | null): Pick<FoodItem, "grams" | "quantity"> {
  return { grams, quantity };
}

describe("applyGramsDeltaToFoodItem", () => {
  it("déduit 200g d’un paquet 400g sans quantité : reste 400|200 (badge 400g)", () => {
    const next = applyGramsDeltaToFoodItem(food("400", null), -200);
    expect(next).toEqual({ quantity: null, grams: "400|200" });
    expect(getFoodItemTotalGrams(next as FoodItem)).toBe(200);
  });

  it("rend 200g sur 400|200 : revient à 400g (pas 600g dans le badge)", () => {
    const next = applyGramsDeltaToFoodItem(food("400|200", null), 200);
    expect(next).toEqual({ quantity: null, grams: "400" });
    expect(getFoodItemTotalGrams(next as FoodItem)).toBe(400);
  });

  it("rend 200g sur 3×400g entamé (400|200) : revient à 3×400g", () => {
    const next = applyGramsDeltaToFoodItem(food("400|200", 3), 200);
    expect(next).toEqual({ quantity: 3, grams: "400" });
    expect(getFoodItemTotalGrams(next as FoodItem)).toBe(1200);
  });

  it("n’écrit pas le total dans grams (évite 400+800 → badge 1200g)", () => {
    const next = applyGramsDeltaToFoodItem(food("400|200", null), 200);
    expect(next).not.toEqual({ quantity: null, grams: "600" });
    expect(next).not.toEqual({ quantity: null, grams: "1200" });
  });
});

describe("gramsToRestoreTowardSnapshot", () => {
  it("n’ajoute rien si le stock est déjà au niveau du snapshot (déduction non visible)", () => {
    const snap = food("400", null);
    const current = food("400", null);
    expect(gramsToRestoreTowardSnapshot(current, snap, 800)).toBe(0);
  });

  it("plafonne au snapshot : 400|200 + 800g demandés → seulement 200g", () => {
    const snap = food("400", null);
    const current = food("400|200", null);
    expect(gramsToRestoreTowardSnapshot(current, snap, 800)).toBe(200);
  });

  it("rend exactement la portion si elle ne dépasse pas le snapshot", () => {
    const snap = food("400", 3);
    const current = food("400|200", 3);
    expect(gramsToRestoreTowardSnapshot(current, snap, 200)).toBe(200);
  });
});
