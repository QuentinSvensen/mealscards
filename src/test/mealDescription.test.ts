import { describe, it, expect } from "vitest";
import { resolveMealDescriptionForDisplay } from "@/lib/mealDescription";
import type { Meal } from "@/types/meals";

/** Fiche minimale pour les tests de description. */
function meal(partial: Partial<Meal> & Pick<Meal, "id" | "name">): Meal {
  return {
    category: "dessert",
    calories: null,
    protein: null,
    fiber: null,
    grams: null,
    ingredients: null,
    expiration_date: null,
    possible_quantity: 1,
    counter_start_date: null,
    oven_temp: null,
    oven_minutes: null,
    is_favorite: false,
    sort_order: 0,
    description: null,
    ...partial,
  } as Meal;
}

describe("resolveMealDescriptionForDisplay", () => {
  it("renvoie uniquement la description de la fiche, pas celle d’un homonyme", () => {
    const potA = meal({ id: "a", name: "Pot #1", description: "Notes pot A" });
    const potB = meal({ id: "b", name: "Pot #1", description: null });
    const catalog = [potA, potB];

    expect(resolveMealDescriptionForDisplay(potA, catalog)).toBe("Notes pot A");
    expect(resolveMealDescriptionForDisplay(potB, catalog)).toBeNull();
  });

  it("ignore une description vide / espaces", () => {
    const empty = meal({ id: "c", name: "Pot #1", description: "   " });
    expect(resolveMealDescriptionForDisplay(empty, [])).toBeNull();
  });
});
