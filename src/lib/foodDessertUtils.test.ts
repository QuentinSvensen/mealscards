import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import { buildStockMap } from "@/lib/stockUtils";
import {
  buildFoodDessertExtraId,
  buildFoodDessertExtras,
  buildFoodDessertMealPayload,
  getFoodDessertStockCount,
  parseFoodDessertExtraId,
} from "./foodDessertUtils";

function makeFoodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: "glace-1",
    name: "Glace",
    storage_type: "frigo",
    grams: null,
    quantity: 4,
    calories: "120",
    protein: "3",
    fiber: "0",
    expiration_date: null,
    sort_order: 0,
    created_at: "",
    is_meal: false,
    is_infinite: false,
    counter_start_date: null,
    counter_days: null,
    ...overrides,
  } as FoodItem;
}

describe("foodDessertUtils", () => {
  it("construit un id d'extra planning stable pour un aliment dessert", () => {
    expect(buildFoodDessertExtraId("abc")).toBe("food-dessert::abc");
    expect(parseFoodDessertExtraId("food-dessert::abc")).toBe("abc");
    expect(parseFoodDessertExtraId("custom::x::1::2")).toBeNull();
  });

  it("expose les macros par unité et un payload à un ingrédient pour la déduction stock", () => {
    const fi = makeFoodItem();
    const payload = buildFoodDessertMealPayload(fi);

    expect(payload.ingredients).toBe("1 Glace");
    expect(payload.calories).toBe("120");
    expect(payload.protein).toBe("3");

    const [extra] = buildFoodDessertExtras([fi], [fi.id]);
    expect(extra.id).toBe(buildFoodDessertExtraId(fi.id));
    expect(extra.name).toBe("Glace");
    expect(extra.cal).toBe(120);
    expect(extra.prot).toBe(3);
  });

  it("compte le stock restant via getMealMultiple sur le payload dessert", () => {
    const fi = makeFoodItem();
    const stockMap = buildStockMap([fi]);
    expect(getFoodDessertStockCount(fi, stockMap)).toBe(4);
  });
});
