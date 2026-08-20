import { describe, expect, it } from "vitest";
import type { Meal, PossibleMeal } from "@/types/meals";
import type { FoodItem } from "@/types/food";
import {
  applyIngredientMacroToText,
  applyIngredientRenameToText,
  buildIngredientMacroUpdatePlan,
  buildIngredientRenamePlan,
  collectIngredientMacroEntries,
  createIngredientMacroLibraryItem,
  areIngredientMacroLibrariesEqual,
  persistMissingIngredientMacroEntries,
  removeIngredientMacroLibraryItem,
  renameIngredientMacroLibraryItem,
  upsertFoodItemMacroLibraryItem,
  upsertIngredientMacroLibraryItem,
  resolveIngredientLineMacros,
  resolveUnParUnFoodItemMacros,
  resolveConsumeDialogMacros,
  autofillIngredientLinesMacros,
  computeFoodItemPortionMacros,
  computeHomonymFoodMealMacros,
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
function makeFoodItem(
  id: string,
  name: string,
  calories: string | null,
  protein: string | null,
  storage_type: FoodItem["storage_type"] = "frigo",
  grams: string | null = null,
  quantity: number | null = null,
  fiber: string | null = null,
): FoodItem {
  return {
    id,
    name,
    grams,
    calories,
    protein,
    fiber,
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
    expect(plan.foodUpdates).toEqual([
      { id: "food1", calories: "110", protein: "25", fiber: null },
    ]);
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

  it("privilégie la base Quantité depuis la fiche aliment même si le référentiel macro est au 100g", () => {
    const foodItems = [
      makeFoodItem("food1", "Vacherin vanille framboise Picard", "117", "1,4", "congelateur", null, 1, "0,7"),
    ];
    const library = [createIngredientMacroLibraryItem("Vacherin vanille framboise Picard", "117", "1,4", "0,7")!];

    const entries = collectIngredientMacroEntries([], [], library, foodItems);

    expect(entries.find((entry) => entry.displayName.includes("Vacherin"))).toMatchObject({
      basisLabel: "Quantité",
      foodCount: 1,
    });
  });

  it("garde la base 100g si les recettes utilisent des grammes malgré une quantité en stock", () => {
    const meals = [makeMeal("1", "Sandwich", "30g Fuet{137} [8], 50g Pain")];
    const foodItems = [makeFoodItem("food1", "Fuet", "456", "27", "frigo", "170", 2, "0")];

    const entries = collectIngredientMacroEntries(meals, [], [], foodItems);

    expect(entries.find((entry) => entry.displayName === "Fuet")).toMatchObject({
      basisLabel: "100g",
      recipeCount: 1,
      foodCount: 1,
    });
  });

  it("prépare la suppression d'une ligne en vidant les macros dans les recettes et aliments standards", () => {
    const meals = [makeMeal("1", "Poulet riz", "100g Filet de poulet{106} [23], 50g Riz")];
    const possibleMeals = [makePossible("pm1", meals[0], "50g Filet de poulet{106} [23]")];
    const foodItems = [makeFoodItem("food1", "Filet de poulet", "106", "23")];
    const library = [createIngredientMacroLibraryItem("Filet de poulet", "106", "23")!];

    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, "filet de poulet", "", "");
    const nextLibrary = removeIngredientMacroLibraryItem(library, "filet de poulet");

    expect(plan.mealUpdates[0].ingredients).toBe("100g Filet de poulet, 50g Riz");
    expect(plan.possibleUpdates[0].ingredients_override).toBe("50g Filet de poulet");
    expect(plan.foodUpdates).toEqual([
      { id: "food1", calories: null, protein: null, fiber: null },
    ]);
    expect(nextLibrary).toEqual([]);
  });

  it("synchronise les macros vers les aliments standards et extras", () => {
    const foodItems = [
      makeFoodItem("food1", "Barres Koro", null, null, "extras", "100", null),
      makeFoodItem("food2", "Barres Koro", null, null, "frigo", "100", null),
    ];

    const plan = buildIngredientMacroUpdatePlan([], [], foodItems, "barres koro", "280", "40", "8");

    expect(plan.foodUpdates).toEqual([
      { id: "food1", calories: "280", protein: "40", fiber: "8" },
      { id: "food2", calories: "280", protein: "40", fiber: "8" },
    ]);
  });

  it("résout les macros malgré un pluriel (Pommes de terre ↔ Pomme de terre)", () => {
    const fi = makeFoodItem("p1", "Pomme de terre", "82", "2", "frais", null, null, "2");
    const line = {
      qty: "400",
      count: "",
      name: "Pommes de terre",
      cal: "",
      pro: "",
      fiber: "",
      isOr: false,
      isAnd: false,
      isOptional: false,
    };

    expect(resolveIngredientLineMacros(line, { foodItems: [fi] })).toEqual({
      cal: "82",
      pro: "2",
      fiber: "2",
    });
  });

  it("préfère le référentiel Macro à la fiche Aliments homonyme (ex. Lions extras vs Macro /100g)", () => {
    const fi = makeFoodItem("lions-fi", "Lions", "204", "0", "extras", "42", 1);
    const library = [createIngredientMacroLibraryItem("Lions", "480", "4,8", "1,3")!];
    const line = {
      qty: "",
      count: "",
      name: "Lions",
      cal: "204",
      pro: "0",
      fiber: "0",
      isOr: false,
      isAnd: false,
      isOptional: false,
    };

    expect(resolveIngredientLineMacros(line, { foodItems: [fi], macroLibrary: library })).toEqual({
      cal: "480",
      pro: "4,8",
      fiber: "1,3",
    });

    const filled = autofillIngredientLinesMacros([line], { foodItems: [fi], macroLibrary: library });
    expect(filled[0].cal).toBe("480");
    expect(filled[0].pro).toBe("4,8");
    expect(filled[0].fiber).toBe("1,3");
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

  it("conserve les macros négatives du référentiel (Négatif −316 / −11)", () => {
    const library = [createIngredientMacroLibraryItem("Négatif", "-316", "-11", "0")!];
    const line = {
      qty: "1",
      count: "",
      name: "Négatif",
      cal: "316",
      pro: "11",
      fiber: "0",
      isOr: false,
      isAnd: false,
      isOptional: false,
    };

    expect(resolveIngredientLineMacros(line, { macroLibrary: library })).toEqual({
      cal: "-316",
      pro: "-11",
      fiber: "0",
    });

    // Resynchronise même si la ligne était déjà remplie en positif (bug historique).
    const filled = autofillIngredientLinesMacros([line], { macroLibrary: library });
    expect(filled[0].cal).toBe("-316");
    expect(filled[0].pro).toBe("-11");
    expect(filled[0].fiber).toBe("0");
  });

  it("calcule l'affichage Un par un depuis le référentiel Macro ingrédients", () => {
    const library = [createIngredientMacroLibraryItem("Fuet", "228", "14")!];
    const fi = makeFoodItem("f1", "Fuet", "456", "27", "frigo", "300", 2);

    expect(resolveUnParUnFoodItemMacros(fi, library)).toEqual({
      per100Cal: 228,
      per100Pro: 14,
      calDisplay: 1368,
      proDisplay: 84,
      hasGrams: true,
    });
  });

  it("totalise les macros sur le stock réel (unités + reliquat)", () => {
    const library = [createIngredientMacroLibraryItem("Fuet", "456", "27")!];
    const fi = makeFoodItem("f2", "Fuet", null, null, "frigo", "300|150", 2);

    expect(resolveUnParUnFoodItemMacros(fi, library)).toEqual({
      per100Cal: 456,
      per100Pro: 27,
      calDisplay: 2052,
      proDisplay: 122,
      hasGrams: true,
    });
  });

  it("prévisualise les macros du dialogue Consommer selon les grammes saisis", () => {
    const library = [createIngredientMacroLibraryItem("Brochettes poulet tandoori Picard", "150", "18")!];
    const fi = makeFoodItem("f3", "Brochettes poulet tandoori Picard", null, null, "frigo", "400", 1);

    expect(resolveConsumeDialogMacros(fi, library, "", "200")).toEqual({
      cal: 300,
      pro: 36,
    });
    expect(resolveConsumeDialogMacros(fi, library, "", "")).toEqual({
      cal: null,
      pro: null,
    });
  });

  it("prévisualise les macros du dialogue Consommer avec quantité et grammes", () => {
    const library = [createIngredientMacroLibraryItem("Fuet", "456", "27")!];
    const fi = makeFoodItem("f4", "Fuet", null, null, "frigo", "300", 3);

    expect(resolveConsumeDialogMacros(fi, library, "1", "150")).toEqual({
      cal: 2052,
      pro: 122,
    });
  });

  it("renomme un ingrédient dans une chaîne de recette", () => {
    const next = applyIngredientRenameToText(
      "100g Dinde{105} [24]<2>, Riz{130} [3]",
      "dinde",
      "Poulet",
    );
    expect(next).toBe("100g Poulet{105} [24] <2>, Riz{130} [3]");
  });

  it("prépare un plan de renommage recettes / possibles / aliments", () => {
    const meal = makeMeal("m1", "Bol", "100g Dinde{105} [24], Riz{130} [3]");
    const possibles = [makePossible("p1", meal, "Dinde{50} [10]")];
    const foods = [makeFoodItem("f1", "Dinde", "105", "24")];

    const plan = buildIngredientRenamePlan([meal], possibles, foods, "dinde", "Poulet rôti");

    expect(plan.mealUpdates).toEqual([
      { id: "m1", ingredients: "100g Poulet rôti{105} [24], Riz{130} [3]" },
    ]);
    expect(plan.possibleUpdates).toEqual([
      { id: "p1", ingredients_override: "Poulet rôti{50} [10]" },
    ]);
    expect(plan.foodUpdates).toEqual([{ id: "f1", name: "Poulet rôti" }]);
  });

  it("renomme l'entrée du référentiel Macro (ancienne clé → nouvelle)", () => {
    const library = [createIngredientMacroLibraryItem("Dinde", "105", "24", "0")!];
    const next = renameIngredientMacroLibraryItem(library, "dinde", "Poulet", "110", "25", "1");
    expect(next).toEqual([
      {
        key: "poulet",
        displayName: "Poulet",
        calories: "110",
        protein: "25",
        fiber: "1",
      },
    ]);
  });

  it("aliment-repas : macros depuis la fiche (portion unitaire)", () => {
    const fi = makeFoodItem("n1", "Nouille protéinée", "350", "25", "frigo", "100", 2);
    const macros = computeFoodItemPortionMacros(fi);
    expect(macros.calories).toBe("350");
    expect(macros.protein).toBe("25");
  });

  it("aliment-repas sans fiche : lit le référentiel Macro /100g × grammage unitaire", () => {
    const fi = makeFoodItem("n1", "Nouille protéinée", null, null, "frigo", "200", 2);
    const library = [createIngredientMacroLibraryItem("Nouille protéinée", "175", "12", "2")!];
    const macros = computeFoodItemPortionMacros(fi, {
      macroSources: { foodItems: [fi], macroLibrary: library, mealMacros: new Map() },
    });
    // 175/100g × 200g = 350 kcal ; 12 × 2 = 24 prot
    expect(macros.calories).toBe("350");
    expect(macros.protein).toBe("24");
    expect(macros.fiber).toBe("4");
  });

  it("aliment-repas sans grammage : affiche les valeurs Macro /100g (repli visible)", () => {
    const fi = makeFoodItem("n1", "Nouille protéinée", null, null, "frigo", null, 2);
    const library = [createIngredientMacroLibraryItem("Nouille protéinée", "350", "25", "0")!];
    const macros = computeFoodItemPortionMacros(fi, {
      macroSources: { foodItems: [fi], macroLibrary: library, mealMacros: new Map() },
    });
    expect(macros.calories).toBe("350");
    expect(macros.protein).toBe("25");
  });

  it("aliment-repas : macros depuis annotations recettes + g/unité Macro", () => {
    const fi = makeFoodItem("n1", "Nouille protéinée", null, null, "frigo", null, 2);
    const mealMacros = new Map([["nouille proteinee", { cal: "175", pro: "12", fiber: "2" }]]);
    const macros = computeFoodItemPortionMacros(fi, {
      macroSources: {
        foodItems: [fi],
        macroLibrary: [],
        mealMacros,
        unitGramsByKey: { "nouille proteinee": 200 },
      },
    });
    expect(macros.calories).toBe("350");
    expect(macros.protein).toBe("24");
  });

  it("repas homonyme sans kcal : scale Macro /100g × grammes de la portion", () => {
    const fi = makeFoodItem("n1", "Nouille protéinée", null, null, "frigo", "210", 1);
    fi.is_meal = true;
    const library = [createIngredientMacroLibraryItem("Nouille protéinée", "350", "25", "2")!];
    const macros = computeHomonymFoodMealMacros(
      { name: "Nouille protéinée", grams: "210" },
      [fi],
      { foodItems: [fi], macroLibrary: library, mealMacros: new Map() },
    );
    expect(macros?.calories).toBe("735");
    expect(macros?.protein).toBe("53");
  });

  it("repas homonyme : Macro /100g même si l'aliment n'est plus en stock", () => {
    const library = [createIngredientMacroLibraryItem("Nouille protéinée", "350", "25", "2")!];
    const macros = computeHomonymFoodMealMacros(
      { name: "Nouille protéinée", grams: "210" },
      [],
      { foodItems: [], macroLibrary: library, mealMacros: new Map() },
    );
    expect(macros?.calories).toBe("735");
    expect(macros?.protein).toBe("53");
  });

  it("repas homonyme : macros de la fiche catalogue Tous si Macro et aliment absents", () => {
    const catalog = makeMeal("m1", "Nouille protéinée", null);
    catalog.calories = "700";
    catalog.protein = "50";
    catalog.grams = "210";
    const macros = computeHomonymFoodMealMacros(
      { name: "Nouille protéinée", grams: "210" },
      [],
      { foodItems: [], macroLibrary: [], mealMacros: new Map(), catalogMeals: [catalog] },
    );
    expect(macros?.calories).toBe("700");
    expect(macros?.protein).toBe("50");
  });
});
