import { describe, expect, it } from "vitest";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { isShortcutStandalonePlat, isMorningMealPlat } from "@/components/MaxMealGenerator";

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
