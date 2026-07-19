import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  buildDessertExtraId,
  formatExtraAssignedCountLabel,
  formatExtraQuantitySubtitle,
  formatExtraRemainingCountLabel,
  formatPlacedExtraLabel,
  getAssignedExtraLabel,
  groupAssignedExtraIds,
  multiplyDisplayGrams,
  normalizeExtraDisplayName,
  parseCustomExtraId,
  pickDayExtraSelections,
  resolveDessertCatalogId,
  resolveExtraFoodRemainingCount,
} from "./extraDisplay";

describe("extraDisplay", () => {
  it("décode et encode un extra personnalisé", () => {
    expect(parseCustomExtraId("custom::Yaourt::120::8")).toEqual({
      name: "Yaourt",
      cal: 120,
      prot: 8,
    });
    expect(parseCustomExtraId("food-dessert::abc")).toBeNull();
    expect(buildDessertExtraId("Yaourt", 120.4, 7.6)).toBe("custom::Yaourt::120::8");
  });

  it("normalise les noms d'extras pour la comparaison", () => {
    expect(normalizeExtraDisplayName("  Yaourt Nature ")).toBe("yaourt nature");
  });

  it("résout un id custom vers le catalogue dessert par nom", () => {
    const catalog = [{ id: "d1", name: "Yaourt" }];
    const byId = new Map([["d1", { name: "Yaourt" }]]);
    expect(resolveDessertCatalogId("custom::Yaourt::100::5", catalog, byId)).toBe("d1");
    expect(resolveDessertCatalogId("d1", catalog, byId)).toBe("d1");
    expect(resolveDessertCatalogId("unknown", catalog, byId)).toBeNull();
  });

  it("regroupe les extras assignés en conservant l'ordre", () => {
    expect(groupAssignedExtraIds(["a", "b", "a", "c"])).toEqual([
      { id: "a", count: 2 },
      { id: "b", count: 1 },
      { id: "c", count: 1 },
    ]);
  });

  it("formate les libellés et multiplie les grammes affichables", () => {
    expect(formatPlacedExtraLabel("Pomme", "120", 2)).toBe("120g #2 Pomme");
    expect(formatPlacedExtraLabel("Pomme", "120", Infinity)).toBe("120g ∞ Pomme");
    expect(multiplyDisplayGrams("50g", 3)).toBe("150g");
    expect(multiplyDisplayGrams("1,5", 2)).toBe("3");
  });

  it("affiche le reste catalogue (#N) et ∞ sans préfixe #", () => {
    expect(formatExtraRemainingCountLabel(2)).toBe("#2");
    expect(formatExtraRemainingCountLabel(Infinity)).toBe("∞");
    expect(formatExtraAssignedCountLabel(1)).toBe("#1");
    expect(formatExtraAssignedCountLabel(2)).toBe("#2");
    expect(formatExtraQuantitySubtitle("120", 2)).toBe("120g · #2");
    expect(formatExtraQuantitySubtitle("120", Infinity)).toBe("120g · ∞");
    expect(formatExtraQuantitySubtitle("120", 1)).toBe("120g · #1");
  });

  it("résout le reste d'une fiche aliment (quantity / is_infinite)", () => {
    expect(resolveExtraFoodRemainingCount({ quantity: 2, is_infinite: false })).toBe(2);
    expect(resolveExtraFoodRemainingCount({ quantity: null, is_infinite: true })).toBe(Infinity);
    expect(resolveExtraFoodRemainingCount({ quantity: null, is_infinite: false })).toBeNull();
  });

  it("affiche #N = quantité assignée (stepper), pas le stock restant", () => {
    const fi = {
      id: "sundae-1",
      name: "Sundae",
      grams: "150",
      quantity: 2,
      is_infinite: false,
      storage_type: "extras",
    } as FoodItem;
    // Stepper à 1, stock encore à 2 → label sélectionné #1 (pris), pas #2.
    expect(getAssignedExtraLabel("sundae-1", 1, null, fi, [fi], new Map())).toBe("150g #1 Sundae");
    // Stepper à 2 → grammes ×2 et #2.
    expect(getAssignedExtraLabel("sundae-1", 2, null, fi, [fi], new Map())).toBe("300g #2 Sundae");
  });

  it("utilise la quantité assignée pour un dessert sans fiche aliment", () => {
    const meal = {
      id: "d1",
      name: "Sundae",
      ingredients: "[[{\"name\":\"Sundae\",\"qty\":0,\"count\":2,\"optional\":false}]]",
    } as Meal;
    const dessertById = new Map([["d1", { mealPayload: meal }]]);
    // Stepper à 1 → #1 (pas le count recette ni le reste catalogue).
    expect(getAssignedExtraLabel("d1", 1, { name: "Sundae" }, undefined, [], dessertById)).toBe("#1 Sundae");
    expect(getAssignedExtraLabel("d1", 2, { name: "Sundae" }, undefined, [], dessertById)).toBe("#2 Sundae");
  });

  it("lit les sélections extras avec priorité ISO puis clé jour", () => {
    expect(
      pickDayExtraSelections(
        { "2026-05-28": ["a"], lundi: ["b"] },
        "2026-05-28",
        "lundi",
        ["fallback"],
      ),
    ).toEqual(["a"]);
    expect(
      pickDayExtraSelections({ lundi: ["b"] }, "2026-05-28", "lundi", ["fallback"]),
    ).toEqual(["b"]);
    expect(
      pickDayExtraSelections({}, "2026-05-28", "lundi", ["fallback"]),
    ).toEqual(["fallback"]);
  });
});
