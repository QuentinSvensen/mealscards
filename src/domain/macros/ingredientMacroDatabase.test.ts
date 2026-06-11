import { describe, expect, it } from "vitest";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import {
  applyIngredientMacroToText,
  buildIngredientMacroUpdatePlan,
  collectIngredientMacroEntries,
  createIngredientMacroLibraryItem,
  areIngredientMacroLibrariesEqual,
  persistMissingIngredientMacroEntries,
  removeIngredientMacroLibraryItem,
  upsertFoodItemMacroLibraryItem,
  upsertIngredientMacroLibraryItem,
  resolveIngredientLineMacros,
  autofillIngredientLinesMacros,
} from "./ingredientMacroDatabase";

const baseMeal: Omit<Meal, "id" | "name" | "ingredients"> = {
  category: "plat",
  calories: null,
  protein: null,
  grams: null,
  sort_order: 0,
  created_at: "2026-01-01",
  is_available: true,
  is_favorite: false,
  oven_temp: null,
  oven_minutes: null,
};

// Crée un repas minimal pour tester le référentiel macros sans dépendre de Supabase.
function makeMeal(id: string, name: string, ingredients: string | null): Meal {
  return { ...baseMeal, id, name, ingredients };
}

// Crée une carte Possible minimale avec override d'ingrédients pour tester la propagation.
function makePossible(id: string, meal: Meal, ingredients_override: string | null): PossibleMeal {
  return {
    id,
    meal_id: meal.id,
    quantity: 1,
    expiration_date: null,
    day_of_week: null,
    meal_time: null,
    counter_start_date: null,
    sort_order: 0,
    created_at: "2026-01-01",
    meals: meal,
    ingredients_override,
  };
}

// Crée une fiche aliment minimale pour tester l'import automatique depuis l'onglet Aliments.
function makeFoodItem(id: string, name: string, calories: string | null, protein: string | null, storage_type: FoodItem["storage_type"] = "frigo", grams: string | null = null, quantity: number | null = null): FoodItem {
  return {
    id,
    name,
    grams,
    calories,
    protein,
    expiration_date: null,
    counter_start_date: null,
    sort_order: 0,
    created_at: "2026-01-01",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    no_counter: true,
    storage_type,
    quantity,
    food_type: null,
  };
}

describe("ingredientMacroDatabase", () => {
  it("collecte les ingrédients ayant des calories ou protéines annotées", () => {
    const meals = [
      makeMeal("1", "Poulet riz", "100g Filet de poulet{106} [23], 50g Riz"),
      makeMeal("2", "Dinde", "100g Dinde{105} [24], 80g haricots verts{15} [1.1]"),
    ];

    const entries = collectIngredientMacroEntries(meals);

    expect(entries.map((entry) => entry.displayName)).toEqual(["Dinde", "Filet de poulet", "Haricots verts"]);
    expect(entries.find((entry) => entry.displayName === "Dinde")).toMatchObject({
      calories: "105",
      protein: "24",
      recipeCount: 1,
      basisLabel: "100g",
    });
  });

  it("applique une modification à toutes les recettes et overrides qui utilisent l'ingrédient", () => {
    const meals = [
      makeMeal("1", "Poulet riz", "100g Filet de poulet{106} [23], 50g Riz"),
      makeMeal("2", "Salade poulet", "80g Filet de poulet, 30g Salade"),
    ];
    const possibleMeals = [
      makePossible("pm1", meals[0], "50g Filet de poulet{106} [23]"),
    ];

    const foodItems = [makeFoodItem("food1", "Filet de poulet", "106", "23")];

    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, "filet de poulet", "110", "25");

    expect(plan.mealUpdates).toHaveLength(2);
    expect(plan.mealUpdates[0].ingredients).toContain("Filet de poulet{110} [25]");
    expect(plan.mealUpdates[1].ingredients).toContain("Filet de poulet{110} [25]");
    expect(plan.possibleUpdates[0].ingredients_override).toContain("Filet de poulet{110} [25]");
    expect(plan.foodUpdates[0]).toMatchObject({ id: "food1", calories: "110", protein: "25" });
  });

  it("peut retirer une macro en sauvegardant une valeur vide", () => {
    const updated = applyIngredientMacroToText("100g Dinde{105} [24]", "dinde", "", "20");

    expect(updated).toBe("100g Dinde [20]");
  });

  it("ajoute un ingrédient libre dans le référentiel persistant", () => {
    const item = createIngredientMacroLibraryItem("glace vanille", "207", "3.5");
    expect(item).toMatchObject({ key: "glace vanille", displayName: "Glace vanille" });

    const library = upsertIngredientMacroLibraryItem([], item!);
    const entries = collectIngredientMacroEntries([], [], library);

    expect(entries[0]).toMatchObject({
      displayName: "Glace vanille",
      calories: "207",
      protein: "3.5",
      recipeCount: 0,
    });
  });

  it("collecte aussi les macros précisées sur les fiches aliments", () => {
    const entries = collectIngredientMacroEntries([], [], [], [
      makeFoodItem("food1", "Bonbons", "110", "10", "extras", "30", null),
    ]);

    expect(entries[0]).toMatchObject({
      displayName: "Bonbons",
      calories: "110",
      protein: "10",
      foodCount: 1,
      basisLabel: "100g",
    });
  });

  it("crée une entrée Macro persistante depuis les macros d'un aliment", () => {
    const library = upsertFoodItemMacroLibraryItem([], "Patatoes Lidl", "131", "2", "3");

    expect(library).toEqual([
      {
        key: "patatoes lidl",
        displayName: "Patatoes Lidl",
        calories: "131",
        protein: "2",
        fiber: "3",
      },
    ]);
  });

  it("détecte l'égalité de contenu entre deux référentiels Macro", () => {
    const left = [createIngredientMacroLibraryItem("Patatoes Lidl", "131", "2")!];
    const right = [{ ...left[0] }];
    expect(areIngredientMacroLibrariesEqual(left, right)).toBe(true);
    expect(areIngredientMacroLibrariesEqual(left, [])).toBe(false);
  });

  it("garde une ligne Macro après disparition de sa recette source", () => {
    const entries = collectIngredientMacroEntries([
      makeMeal("1", "Plat source", "100g Dinde{105} [24]"),
    ]);

    const library = persistMissingIngredientMacroEntries([], entries);
    const persistedEntries = collectIngredientMacroEntries([], [], library);

    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0]).toMatchObject({
      displayName: "Dinde",
      calories: "105",
      protein: "24",
      recipeCount: 0,
      basisLabel: "100g",
    });
  });

  it("déduit la base depuis l'onglet Aliments quand la macro vient d'un repas", () => {
    const meals = [
      makeMeal("1", "Bol", "Teriyaki{70} [2], Nouille protéinée{350} [14]"),
    ];
    const foodItems = [
      makeFoodItem("food1", "Teriyaki", null, null, "frigo", null, 1),
      makeFoodItem("food2", "Nouille protéinée", null, null, "frigo", "100", null),
    ];

    const entries = collectIngredientMacroEntries(meals, [], [], foodItems);

    expect(entries.find((entry) => entry.displayName === "Teriyaki")).toMatchObject({
      basisLabel: "Quantité",
      foodCount: 1,
    });
    expect(entries.find((entry) => entry.displayName === "Nouille protéinée")).toMatchObject({
      basisLabel: "100g",
      foodCount: 1,
    });
  });

  it("prépare la suppression d'une ligne en vidant les macros partout", () => {
    const meals = [makeMeal("1", "Poulet riz", "100g Filet de poulet{106} [23], 50g Riz")];
    const possibleMeals = [makePossible("pm1", meals[0], "50g Filet de poulet{106} [23]")];
    const foodItems = [makeFoodItem("food1", "Filet de poulet", "106", "23")];
    const library = [createIngredientMacroLibraryItem("Filet de poulet", "106", "23")!];

    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, "filet de poulet", "", "");
    const nextLibrary = removeIngredientMacroLibraryItem(library, "filet de poulet");

    expect(plan.mealUpdates[0].ingredients).toBe("100g Filet de poulet, 50g Riz");
    expect(plan.possibleUpdates[0].ingredients_override).toBe("50g Filet de poulet");
    expect(plan.foodUpdates[0]).toMatchObject({ id: "food1", calories: null, protein: null, fiber: null });
    expect(nextLibrary).toEqual([]);
  });

  it("calcule les macros d'une ligne depuis le référentiel Macro au 100 g", () => {
    const library = [createIngredientMacroLibraryItem("Patatoes Lidl", "131", "2,1", "4")!];
    const line = {
      qty: "250",
      count: "",
      name: "Patatoes Lidl",
      cal: "",
      pro: "",
      fiber: "",
      isOr: false,
      isAnd: false,
      isOptional: false,
    };

    expect(resolveIngredientLineMacros(line, { macroLibrary: library })).toEqual({
      cal: "131",
      pro: "2,1",
      fiber: "4",
    });

    const filled = autofillIngredientLinesMacros([line], { macroLibrary: library });
    expect(filled[0].cal).toBe("131");
    expect(filled[0].pro).toBe("2,1");
    expect(filled[0].fiber).toBe("4");
  });
});
