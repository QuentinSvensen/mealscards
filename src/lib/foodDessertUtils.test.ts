import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import { buildStockMap } from "@/lib/stockUtils";
import {
  buildFoodDessertExtraId,
  buildFoodDessertExtras,
  buildFoodDessertMealPayload,
  getFoodDessertStockCount,
  parseFoodDessertExtraId,
  resolveFoodDessertPortionMacros,
  resolveSingleIngredientMealDessertMacros,
  reconcileDessertFoodPreferences,
  shouldMarkNewFoodAsDessert,
  foodNameMatchesDessertMemory,
  deduplicateDessertExtraCatalog,
  stripDessertCatalogDuplicatesForSelections,
  supplementFoodDessertExtrasFromSnapshots,
  findSnapshotFoodItemForDessertExtra,
  buildFoodDessertExtraEntry,
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

  it("retombe sur le référentiel Macro ingrédients quand la fiche aliment n'a pas de macros", () => {
    const fi = makeFoodItem({
      id: "vacherin-1",
      name: "Vacherin vanille framboise Picard",
      calories: null,
      protein: null,
      fiber: null,
      quantity: 1,
    });
    const macroLibrary = [{
      key: "vacherin vanille framboise picard",
      displayName: "Vacherin vanille framboise Picard",
      calories: "117",
      protein: "1,4",
      fiber: "0,7",
    }];

    expect(resolveFoodDessertPortionMacros(fi, macroLibrary)).toEqual({
      cal: 117,
      pro: 1,
      fiber: 1,
    });

    const [extra] = buildFoodDessertExtras([fi], [fi.id], macroLibrary);
    expect(extra.cal).toBe(117);
    expect(extra.prot).toBe(1);
  });

  it("privilégie la base Quantité même si un grammage est présent sur la fiche aliment", () => {
    const fi = makeFoodItem({
      id: "vacherin-2",
      name: "Vacherin vanille framboise Picard",
      calories: null,
      protein: null,
      fiber: null,
      quantity: 1,
      grams: "80",
    });
    const macroLibrary = [{
      key: "vacherin vanille framboise picard",
      displayName: "Vacherin vanille framboise Picard",
      calories: "117",
      protein: "1,4",
      fiber: "0,7",
    }];

    expect(resolveFoodDessertPortionMacros(fi, macroLibrary)).toEqual({
      cal: 117,
      pro: 1,
      fiber: 1,
    });
  });

  it("retombe sur le référentiel Macro pour un dessert recette sans macros affichées", () => {
    const foodItems = [makeFoodItem({
      id: "vacherin-3",
      name: "Vacherin vanille framboise Picard",
      calories: null,
      protein: null,
      fiber: null,
      quantity: 1,
    })];
    const macroLibrary = [{
      key: "vacherin vanille framboise picard",
      displayName: "Vacherin vanille framboise Picard",
      calories: "117",
      protein: "1,4",
      fiber: "0,7",
    }];

    expect(resolveSingleIngredientMealDessertMacros(
      { ingredients: "1 Vacherin vanille framboise Picard" },
      foodItems,
      macroLibrary,
    )).toEqual({
      cal: 117,
      pro: 1,
      fiber: 1,
    });
  });

  it("réactive le mode dessert après recréation d'une fiche au même nom", () => {
    const oldItem = makeFoodItem({
      id: "old-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    });
    const newItem = makeFoodItem({
      id: "new-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    });

    const reconciled = reconcileDessertFoodPreferences(
      [newItem],
      ["old-vacherin"],
      ["vacherin vanille framboise picard"],
    );

    expect(reconciled.dessertIds).toEqual(["new-vacherin"]);
    expect(shouldMarkNewFoodAsDessert("Vacherin vanille framboise Picard", reconciled.nameKeys)).toBe(true);
  });

  it("réactive le dessert via le premier mot du nom (Vacherin)", () => {
    expect(foodNameMatchesDessertMemory(
      "Vacherin vanille framboise Picard",
      ["vacherin"],
    )).toBe(true);
    expect(shouldMarkNewFoodAsDessert("Vacherin", ["vacherin vanille framboise picard"])).toBe(true);
  });

  it("retrouve le dessert via snapshot planning après suppression du stock", () => {
    const vacherin = makeFoodItem({
      id: "old-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    });
    const newItem = makeFoodItem({
      id: "new-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 2,
    });
    const dessertExtraId = buildFoodDessertExtraId("old-vacherin");

    const reconciled = reconcileDessertFoodPreferences(
      [newItem],
      ["old-vacherin"],
      [],
      { mardi: { [dessertExtraId]: [[vacherin]] } },
    );

    expect(reconciled.dessertIds).toEqual(["new-vacherin"]);
    expect(reconciled.nameKeys).toContain("vacherin vanille framboise picard");
  });

  it("privilégie l'id sélectionné lors de la déduplication catalogue", () => {
    const live = makeFoodItem({
      id: "new-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    });
    const ghost = buildFoodDessertExtraEntry(makeFoodItem({
      id: "old-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    }));
    const liveExtra = buildFoodDessertExtraEntry(live);

    const deduped = deduplicateDessertExtraCatalog(
      [ghost, liveExtra],
      [live],
      [buildFoodDessertExtraId("old-vacherin")],
    );

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe(buildFoodDessertExtraId("old-vacherin"));
  });

  it("retire un doublon custom quand le food-dessert sélectionné partage le même nom", () => {
    const dessertExtraId = buildFoodDessertExtraId("old-vacherin");
    const foodDessert = buildFoodDessertExtraEntry(makeFoodItem({
      id: "old-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    }));
    const customDuplicate = {
      id: "custom::Vacherin vanille framboise Picard::117::1",
      name: "Vacherin vanille framboise Picard",
    };

    const stripped = stripDessertCatalogDuplicatesForSelections(
      [customDuplicate, foodDessert],
      [dessertExtraId],
    );

    expect(stripped).toHaveLength(1);
    expect(stripped[0].id).toBe(dessertExtraId);
  });

  it("conserve l'entrée snapshot sélectionnée même si une fiche repas dessert porte le même nom", () => {
    const vacherin = makeFoodItem({
      id: "old-vacherin",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
    });
    const dessertExtraId = buildFoodDessertExtraId("old-vacherin");
    const customDuplicate = {
      id: "custom::Vacherin vanille framboise Picard::117::1",
      name: "Vacherin vanille framboise Picard",
      cal: 117,
      prot: 1,
      fiber: 1,
      mealPayload: { name: "Vacherin vanille framboise Picard", ingredients: "1 Vacherin vanille framboise Picard" } as any,
      foodItemId: "old-vacherin",
      sortExpiry: null,
    };

    const supplemented = supplementFoodDessertExtrasFromSnapshots(
      [customDuplicate],
      { mardi: { [dessertExtraId]: [[vacherin]] } },
      [],
      [dessertExtraId],
    );

    expect(supplemented.some((entry) => entry.id === dessertExtraId)).toBe(true);
    expect(supplemented.some((entry) => entry.id === customDuplicate.id)).toBe(false);
  });

  it("conserve un dessert sélectionné dans le catalogue après consommation du dernier stock", () => {
    const vacherin = makeFoodItem({
      id: "vacherin-deleted",
      name: "Vacherin vanille framboise Picard",
      quantity: 1,
      calories: "117",
      protein: "1,4",
    });
    const dessertExtraId = buildFoodDessertExtraId("vacherin-deleted");
    const liveExtras = buildFoodDessertExtras([], ["vacherin-deleted"]);
    expect(liveExtras).toHaveLength(0);

    const supplemented = supplementFoodDessertExtrasFromSnapshots(
      liveExtras,
      { mardi: { [dessertExtraId]: [[vacherin]] } },
      [],
      [dessertExtraId],
    );

    expect(supplemented).toHaveLength(1);
    expect(supplemented[0].name).toBe("Vacherin vanille framboise Picard");
    expect(supplemented[0].cal).toBe(117);
    expect(findSnapshotFoodItemForDessertExtra({ mardi: { [dessertExtraId]: [[vacherin]] } }, dessertExtraId)?.id)
      .toBe("vacherin-deleted");
    expect(buildFoodDessertExtraEntry(vacherin).id).toBe(dessertExtraId);
  });
});
