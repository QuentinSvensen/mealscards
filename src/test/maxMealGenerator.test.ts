import { describe, expect, it } from "vitest";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import {
  isShortcutStandalonePlat,
  isMorningMealPlat,
  groupGeneratedMealRows,
  formatGeneratedMealQuantityBadge,
  sumGroupedMealPortions,
  isPreferredMaxMealChoice,
  resolveStandalonePortionCount,
} from "@/components/MaxMealGenerator";
import type { StockInfo } from "@/lib/stockUtils";

const base = (overrides: Partial<Meal>): Meal =>
  ({
    id: "1",
    name: "Test",
    category: "plat",
    ingredients: "",
    calories: null,
    protein: null,
    fiber: null,
    grams: null,
    is_available: true,
    is_favorite: false,
    sort_order: 0,
    created_at: "",
    user_id: "",
    ...overrides,
  }) as Meal;

describe("isShortcutStandalonePlat", () => {
  it("exclut un plat à un seul ingrédient homonyme", () => {
    expect(isShortcutStandalonePlat(base({ name: "Fuet", ingredients: "50g Fuet" }))).toBe(
      true,
    );
    expect(
      isShortcutStandalonePlat(base({ name: "Gaufrette", ingredients: "300g Gaufrette" })),
    ).toBe(true);
  });

  it("conserve une vraie recette multi-ingrédients", () => {
    expect(
      isShortcutStandalonePlat(
        base({
          name: "Purée knackis",
          ingredients: "130g Purée en poudre + 400g Eau + 3 Knacki poulet",
        }),
      ),
    ).toBe(false);
  });

  it("conserve un plat à un ingrédient différent du titre", () => {
    expect(
      isShortcutStandalonePlat(
        base({ name: "Nouilles teriyaki", ingredients: "200g Nouilles" }),
      ),
    ).toBe(false);
  });
});

describe("isMorningMealPlat", () => {
  it("détecte un plat homonyme à un aliment matin", () => {
    const morningFood = {
      id: "fi-1",
      name: "Barre Optimum Brownie (13g fibre)",
    } as FoodItem;
    expect(
      isMorningMealPlat(
        base({ name: "Barre Optimum Brownie (13g fibre)", ingredients: "1 Barre" }),
        [morningFood],
      ),
    ).toBe(true);
  });
});

describe("groupGeneratedMealRows", () => {
  it("cumule les portionCount des lignes identiques", () => {
    const row = {
      name: "Hachis",
      calories: 800,
      protein: 40,
      ingredients: "400g PDT",
      ratio: 1,
      portionCount: 2,
      isStandaloneFood: false,
    };
    const grouped = groupGeneratedMealRows([row, { ...row, portionCount: 1 }]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(3);
  });
});

describe("formatGeneratedMealQuantityBadge", () => {
  it("affiche xN selon le total de portions regroupées", () => {
    expect(
      formatGeneratedMealQuantityBadge(
        { name: "Hachis", calories: 800, protein: 40, ingredients: "", ratio: 1, portionCount: 2 },
        2,
      ),
    ).toBe("x2");
  });

  it("affiche un pourcentage pour une portion partielle", () => {
    expect(
      formatGeneratedMealQuantityBadge(
        { name: "Plat", calories: 400, protein: 20, ingredients: "", ratio: 0.66 },
        1,
      ),
    ).toBe("66%");
  });
});

describe("sumGroupedMealPortions", () => {
  it("aligne le total sur la somme des pastilles xN", () => {
    const total = sumGroupedMealPortions([
      { row: { name: "A", calories: 1, protein: 1, ingredients: "", ratio: 1 }, count: 2 },
      { row: { name: "B", calories: 1, protein: 1, ingredients: "", ratio: 1 }, count: 1 },
      { row: { name: "C", calories: 1, protein: 1, ingredients: "", ratio: 0.7 }, count: 1 },
    ]);
    expect(total).toBe(4);
  });
});

describe("isPreferredMaxMealChoice", () => {
  it("préférère 2×3 œufs (reste 0) à 1×4 œufs (reste 2)", () => {
    // Scores approximatifs : 2 œufs ≈ 370, 0 œuf ≈ 0
    const prefer3eggTwice = isPreferredMaxMealChoice(
      0,
      2,
      0,
      600,
      "Oeuf à la coque 3",
      370,
      1,
      0,
      675,
      "Oeuf à la coque 4",
    );
    expect(prefer3eggTwice).toBe(true);
  });

  it("ne tire pas au sort à égalité : ordre alphabétique stable", () => {
    expect(
      isPreferredMaxMealChoice(100, 1, 0, 500, "Alpha", 100, 1, 0, 500, "Beta"),
    ).toBe(true);
    expect(
      isPreferredMaxMealChoice(100, 1, 0, 500, "Beta", 100, 1, 0, 500, "Alpha"),
    ).toBe(false);
  });
});

describe("resolveStandalonePortionCount", () => {
  it("découpe un pack via le grammage unitaire de la fiche (2×375g)", () => {
    const stock = new Map<string, StockInfo>([
      ["hachis parmentier", { grams: 750, count: 1, infinite: false, indivisibleUnit: 0 }],
    ]);
    const fi = { name: "Hachis parmentier", grams: "375", quantity: 2 } as FoodItem;
    expect(resolveStandalonePortionCount(fi, stock)).toBe(2);
  });

  it("découpe via le grammage catalogue si la fiche est un pack unique", () => {
    const stock = new Map<string, StockInfo>([
      ["hachis parmentier", { grams: 750, count: 1, infinite: false, indivisibleUnit: 0 }],
    ]);
    const fi = { name: "Hachis parmentier", grams: "750", quantity: 1 } as FoodItem;
    const meals = [base({ name: "Hachis parmentier", grams: "375", ingredients: "375g Hachis parmentier" })];
    expect(resolveStandalonePortionCount(fi, stock, meals)).toBe(2);
  });
});
