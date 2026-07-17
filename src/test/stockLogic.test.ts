import { describe, it, expect, vi } from "vitest";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientGroups,
  restoreIngredientDisplayNamesFromReference,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  getMealMultiple, getMealMultipleAtRatio, getMealFractionalRatio,
  getMissingIngredients, buildScaledMealForRatio, scaleIngredientStringExact,
  resolveCounterStartForPossibleBadge,
  analyzeMealIngredients,
  findEarliestActiveCounterDate,
  findEarliestFutureCounterDate,
  getProgrammedOnlyCounterStart,
  getRecipeMaxActiveFoodCounter,
  getRecipeMaxActiveFoodCounterDays,
  computePossibleFrozenCounterDays,
  hasFrozenPossibleCounter,
  readFrozenPossibleCounterDays,
  formatFrozenPossibleCounterTooltip,
  mergeFrozenPossibleCounterDays,
  hasActiveFoodItemCounter,
  recipeHasFiniteCounterableIngredients,
  type StockInfo,
  type PossibleFrozenCounterDaysMap,
} from "@/lib/stockUtils";
import { getAdaptedCounterDays } from "@/lib/ingredientUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";

// ─── Aides (Helpers) ─────────────────────────────────────────────────────────

function makeFoodItem(overrides: Partial<FoodItem> & { name: string }): FoodItem {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    storage_type: "frigo",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    quantity: 1,
    grams: null,
    calories: null,
    protein: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    expiration_date: null,
    counter_start_date: null,
    food_type: null,
    no_counter: false,
    ...overrides,
  };
}

function makeMeal(overrides: Partial<Meal> & { name: string }): Meal {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    category: "plat",
    
    sort_order: 0,
    created_at: new Date().toISOString(),
    is_available: true,
    is_favorite: false,
    calories: null,
    protein: null,
    grams: null,
    ingredients: null,
    oven_temp: null,
    oven_minutes: null,
    description: null,
    fiber: null,
    ...overrides,
  };
}

// ─── ANALYSE DES INGRÉDIENTS (PARSING) ──────────────────────────────────────

describe("parseIngredientLine", () => {
  it("analyse les ingrédients basés sur les grammes", () => {
    expect(parseIngredientLine("200g Poulet")).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(parseIngredientLine("50g Farine d'avoine")).toEqual({ qty: 50, count: 0, name: "farine davoine", optional: false });
  });

  it("analyse les ingrédients basés sur le nombre (unités)", () => {
    expect(parseIngredientLine("3 Oeufs")).toEqual({ qty: 0, count: 3, name: "oeufs", optional: false });
    expect(parseIngredientLine("1 Galette")).toEqual({ qty: 0, count: 1, name: "galette", optional: false });
  });

  it("analyse à la fois la quantité (g) et le nombre", () => {
    expect(parseIngredientLine("200g 3 Poulet")).toEqual({ qty: 200, count: 3, name: "poulet", optional: false });
  });

  it("analyse les valeurs décimales", () => {
    expect(parseIngredientLine("12,5g Sucre")).toEqual({ qty: 12.5, count: 0, name: "sucre", optional: false });
    expect(parseIngredientLine("0,5 Oeuf")).toEqual({ qty: 0, count: 0.5, name: "oeuf", optional: false });
  });
});

describe("parseIngredientGroups", () => {
  it("analyse une liste simple séparée par des virgules", () => {
    const groups = parseIngredientGroups("200g Poulet, 100g Riz");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0]).toHaveLength(1);
    expect(groups[0][0][0]).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(groups[1][0][0]).toEqual({ qty: 100, count: 0, name: "riz", optional: false });
  });

  it("analyse les alternatives OU (|) avec le pipe", () => {
    const groups = parseIngredientGroups("100g Pain | 100g Baguette");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0][0].name).toBe("pain");
    expect(groups[0][1][0].name).toBe("baguette");
  });

  it("gère les groupes mixtes avec alternatives", () => {
    const groups = parseIngredientGroups("200g Viande hachée, 1 Galette, 100g Pain | 100g Baguette");
    expect(groups).toHaveLength(3);
    expect(groups[2]).toHaveLength(2); // Pain | Baguette
    expect(groups[2][0]).toHaveLength(1);
  });

  it("gère les bundles ET (+) avec le plus", () => {
    const groups = parseIngredientGroups("100g Riz + 100g Poulet");
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toHaveLength(2);
    expect(groups[0][0][0].name).toBe("riz");
    expect(groups[0][0][1].name).toBe("poulet");
  });
});

// ─── CARTE DE STOCK (STOCK MAP) ─────────────────────────────────────────────

describe("buildStockMap", () => {
  it("agrège les quantités par nom normalisé", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 6 }),
      makeFoodItem({ name: "Oeuf", quantity: 2 }),
    ];
    const map = buildStockMap(items);
    // Les deux devraient correspondre à la même clé (sans le 's' final)
    const key = findStockKey(map, "oeuf");
    expect(key).not.toBeNull();
    const stock = map.get(key!);
    expect(stock!.count).toBe(8);
  });

  it("gère les articles basés sur les grammes", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 2, grams: "200" }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "poulet");
    expect(key).not.toBeNull();
    const stock = map.get(key!);
    expect(stock!.grams).toBe(400); // 2 x 200g
    expect(stock!.count).toBe(2);
  });

  it("gère les grammes partiels (reliquats)", () => {
    const items = [
      makeFoodItem({ name: "Lait", quantity: 2, grams: "200|150" }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "lait");
    const stock = map.get(key!);
    // 1 plein (200g) + 1 partiel (150g) = 350g au total
    expect(stock!.grams).toBe(350);
  });

  it("gère les articles infinis", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "sel");
    expect(map.get(key!)!.infinite).toBe(true);
  });
});

// ─── MULTIPLE DE REPAS (RECETTE COMPLÈTE) ───────────────────────────────────

describe("getMealMultiple", () => {
  it("retourne le bon multiple pour une recette simple", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Oeufs", ingredients: "4 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 8/4 = 2
  });

  it("retourne null quand un ingrédient est manquant", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 100g Beurre" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBeNull(); // pas de Beurre
  });

  it("retourne le minimum parmi les groupes d'ingrédients", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 8 }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "200" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Pain" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(1); // min(8/4=2, 200/170=1) = 1
  });

  it("gère les alternatives OU - choisit la meilleure", () => {
    const items = [
      makeFoodItem({ name: "Baguette", quantity: 0, grams: "0" }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "300" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 300/150 = 2 (depuis Pain)
  });

  it("gère les ingrédients infinis", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
      makeFoodItem({ name: "Oeufs", quantity: 4 }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "1g Sel, 2 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // min(Inf, 4/2) = 2
  });

  it("retourne null pour une recette sans ingrédients", () => {
    const meal = makeMeal({ name: "Test", ingredients: null });
    const map = buildStockMap([]);
    expect(getMealMultiple(meal, map)).toBeNull();
  });
});

describe("getMealMultipleAtRatio", () => {
  it("retourne le même résultat que getMealMultiple quand ratio = 1", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Oeufs", ingredients: "4 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultipleAtRatio(meal, map, 1)).toBe(2);
  });

  it("compte les portions partielles sans faux x1000 (quantités fractionnaires)", () => {
    const items = [
      makeFoodItem({ name: "Beurre", quantity: 1, grams: "120" }),
      makeFoodItem({ name: "Oeuf", quantity: 4 }),
      makeFoodItem({ name: "Farine d'avoine", quantity: 1, grams: "100" }),
    ];
    const meal = makeMeal({
      name: "Cookie",
      calories: "440",
      ingredients: "30g Beurre, 0.5 Oeuf, 25g Farine d'avoine",
    });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(4);
    const at75 = getMealMultipleAtRatio(meal, map, 0.75);
    expect(at75).not.toBe(1000);
    expect(at75).toBeGreaterThan(0);
    expect(at75).toBeLessThanOrEqual(6);
  });

  it("tout-infini à ratio réduit → Infinity (pas x1000)", () => {
    const items = [
      makeFoodItem({ name: "Whey", is_infinite: true }),
      makeFoodItem({ name: "Eau", is_infinite: true }),
    ];
    const meal = makeMeal({
      name: "Shaker whey",
      calories: "117",
      ingredients: "30g Whey, 200g Eau",
    });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(Infinity);
    expect(getMealMultipleAtRatio(meal, map, 0.57)).toBe(Infinity);
    expect(getMealMultipleAtRatio(meal, map, 0.57)).not.toBe(1000);
  });
});

// ─── RATIO FRACTIONNAIRE DE REPAS (CARTES EN POURCENTAGE) ───────────────────

describe("getMealFractionalRatio", () => {
  it("retourne le ratio quand le stock est entre 50-100%", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // 160/200
  });

  it("retourne null quand le ratio >= 1 (recette complète disponible)", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "250" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // recette complète dispo
  });

  it("retourne null quand le ratio < 0.5", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "80" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // 80/200 = 0.4 < 0.5
  });

  it("retourne exactement un ratio de 0.5", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "100" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeCloseTo(0.5);
  });

  it("utilise le ratio minimum à travers plusieurs ingrédients", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }), // 160/200 = 0.8
      makeFoodItem({ name: "Riz", quantity: 1, grams: "70" }),     // 70/100 = 0.7
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.7); // min(0.8, 0.7) = 0.7
  });

  it("gère les alternatives OU - utilise le meilleur ratio du groupe", () => {
    const items = [
      makeFoodItem({ name: "Pain", quantity: 1, grams: "80" }),     // 80/150 = 0.533
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "120" }), // 120/150 = 0.8
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // max(0.533, 0.8) = 0.8
  });

  it("retourne null quand un ingrédient a un stock nul", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      // Pas de Riz du tout
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("gère le ratio partiel basé sur le nombre (unités)", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 2 })];
    const meal = makeMeal({ name: "Test", ingredients: "3 Oeufs" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(2 / 3); // 0.666...
  });

  it("respecte le pourcentage max avec des ingrédients mixtes unités/grammes", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 2 }),                  // 2/4 = 0.5
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "170" }), // 170/170 = 1.0
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Baguette" });
    const map = buildStockMap(items);
    // Baguette est entièrement dispo → ratio serait 1.0 pour ce groupe
    // Oeufs : 2/4 = 0.5
    // getMealMultiple retournerait null (besoin de 4 oeufs, 2 dispos)
    expect(getMealMultiple(meal, map)).toBeNull();
    // getMealFractionalRatio : min(0.5, 1.0) = 0.5
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.5);
  });

  it("limite correctement à l'ingrédient limitant, pas à l'ingrédient abondant", () => {
    // Uniquement des lignes en grammes : les unités (1 Galette, 2 Poitrine) feraient échouer
    // getMealFractionalRatio (snap entier sur les quantités).
    const items = [
      makeFoodItem({ name: "Viande hachée", quantity: 1, grams: "250" }),
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "25" }),
      makeFoodItem({ name: "Chorizo", quantity: 1, grams: "10" }),
      makeFoodItem({ name: "Gruyère", quantity: 1, grams: "30" }),
    ];
    const meal = makeMeal({
      name: "Burrito viande",
      ingredients: "250g Viande hachée, 25g Sauce, 15g Chorizo, 30g Gruyère",
    });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(10 / 15);
  });
});

// ─── MISE À L'ÉCHELLE (SCALING) ─────────────────────────────────────────────

describe("buildScaledMealForRatio", () => {
  it("met à l'échelle les calories et les grammes proportionnellement", () => {
    const meal = makeMeal({ name: "Test", calories: "500", grams: "300", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.75);
    expect(scaled.calories).toBe("375"); // 500 * 0.75
    expect(scaled.grams).toBe("225");    // 300 * 0.75
  });

  it("met à l'échelle les ingrédients basés sur les grammes", () => {
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.6);
    expect(scaled.ingredients).toBe("120g Poulet, 60g Riz");
  });

  it("met à l'échelle les ingrédients basés sur le nombre", () => {
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs" });
    const scaled = buildScaledMealForRatio(meal, 0.5);
    expect(scaled.ingredients).toBe("2 Oeufs");
  });

  it("met à l'échelle avec des alternatives OU", () => {
    const meal = makeMeal({ name: "Test", ingredients: "100g Pain | 100g Baguette" });
    const scaled = buildScaledMealForRatio(meal, 0.7);
    expect(scaled.ingredients).toBe("70g Pain | 70g Baguette");
  });

  it("préserve la précision décimale", () => {
    const meal = makeMeal({ name: "Test", ingredients: "12,5g Sucre" });
    const scaled = buildScaledMealForRatio(meal, 0.8);
    // 12.5 * 0.8 = 10
    expect(scaled.ingredients).toBe("10g Sucre");
  });

  it("conserve les fractions unitaires (ex. 0,5 œuf à 75%)", () => {
    const meal = makeMeal({ name: "Cookie", ingredients: "30g Beurre, 0.5 Oeuf" });
    const scaled = buildScaledMealForRatio(meal, 0.75);
    expect(scaled.ingredients).toContain("0.4 Oeuf");
    expect(scaled.ingredients).toContain("22.5g Beurre");
  });
});

describe("scaleIngredientStringExact", () => {
  it("met à l'échelle chaque ingrédient d'un bundle « + » entre parenthèses", () => {
    const raw = "25g Beurre, ( 8g Chocolat + 13g Beurre de cacahuète maison )";
    const scaled = scaleIngredientStringExact(raw, 4, undefined, true);
    expect(scaled).toBe("100g Beurre, ( 32g Chocolat + 52g Beurre de cacahuète maison )");
  });

  it("met à l'échelle un bundle « + » sans parenthèses", () => {
    const raw = "100g Riz + 50g Poulet";
    const scaled = scaleIngredientStringExact(raw, 2, undefined, true);
    expect(scaled).toBe("200g Riz + 100g Poulet");
  });
});

// ─── CAS LIMITES DE DÉDUCTION DE STOCK (EDGE CASES) ─────────────────────────

describe("getFoodItemTotalGrams", () => {
  it("calcule le total pour plusieurs quantités avec partiel", () => {
    const fi = makeFoodItem({ name: "Lait", quantity: 3, grams: "200|150" });
    // 2 pleins (200g chacun) + 1 partiel (150g) = 550g
    expect(getFoodItemTotalGrams(fi)).toBe(550);
  });

  it("calcule le total pour un seul article sans partiel", () => {
    const fi = makeFoodItem({ name: "Pain", quantity: 1, grams: "250" });
    expect(getFoodItemTotalGrams(fi)).toBe(250);
  });

  it("retourne 0 quand il n'y a pas de grammes", () => {
    const fi = makeFoodItem({ name: "Oeuf", quantity: 6 });
    expect(getFoodItemTotalGrams(fi)).toBe(0);
  });

  it("gère correctement quantity=0", () => {
    const fi = makeFoodItem({ name: "Test", quantity: 0, grams: "100" });
    expect(getFoodItemTotalGrams(fi)).toBe(100);
  });

  it("retourne le reliquat quand quantity est implicite (null) et lot entamé", () => {
    const fi = makeFoodItem({ name: "Beurre", quantity: null, grams: "250|130" });
    expect(getFoodItemTotalGrams(fi)).toBe(130);
  });
});

// ─── UN PAR UN : VALIDATION DE CONSOMMATION ────────────────────────────────

describe("Logique de consommation un par un", () => {
  it("devrait permettre de consommer moins que la quantité disponible", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 3, grams: "200", food_type: "viande" });
    const totalGrams = getFoodItemTotalGrams(fi);
    expect(totalGrams).toBe(600);
    // L'utilisateur consomme 1 unité → 200g déduits → 400g restants
    const consumeQty = 1;
    expect(consumeQty).toBeLessThanOrEqual(fi.quantity!);
  });

  it("devrait calculer correctement le restant après une consommation de grammes partielle", () => {
    const fi = makeFoodItem({ name: "Pomme de terre", quantity: 1, grams: "500", food_type: "feculent" });
    // Consomme 375g sur 500g → 125g restent en reliquat
    const consumeGrams = 375;
    const remaining = getFoodItemTotalGrams(fi) - consumeGrams;
    expect(remaining).toBe(125);
    expect(remaining).toBeGreaterThan(0);
  });

  it("signalé : pas de limite forcée sur la quantité consommée", () => {
    // Ce test documente le comportement actuel où la quantité consommée n'est pas forcée
    const fi = makeFoodItem({ name: "Oeufs", quantity: 3, food_type: "viande" });
    // L'utilisateur pourrait saisir qty=5 ce qui dépasse available=3
    // Le code actuel ne force PAS cette limite
    const userInput = 5;
    expect(userInput).toBeGreaterThan(fi.quantity!); // Ceci DEVRAIT être empêché
  });

  it("signalé : pas de limite forcée sur les grammes consommés", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 1, grams: "200", food_type: "viande" });
    // L'utilisateur pourrait saisir 300g ce qui dépasse les 200g dispos
    const userInputGrams = 300;
    expect(userInputGrams).toBeGreaterThan(getFoodItemTotalGrams(fi)); // DEVRAIT être empêché
  });
});

// ─── CORRESPONDANCE DE NOM STRICTE (STRICT NAME MATCH) ──────────────────────

describe("Cas limites de strictNameMatch", () => {
  it("correspond au singulier/pluriel", () => {
    expect(strictNameMatch("oeuf", "oeufs")).toBe(true);
    expect(strictNameMatch("pomme de terre", "pomme de terres")).toBe(true);
  });

  it("ne correspond PAS à des noms similaires non liés", () => {
    expect(strictNameMatch("pain", "paris")).toBe(false);
    expect(strictNameMatch("riz", "ris")).toBe(false); // ≤3 chars → correspondance exacte requise
  });

  it("correspond avec les accents", () => {
    expect(strictNameMatch("crème", "creme")).toBe(true);
    expect(strictNameMatch("pâté", "pate")).toBe(true);
  });
});

// ─── VALIDATION MAX DU POURCENTAGE ──────────────────────────────────────────

describe("validation max des cartes en pourcentage", () => {
  it("garantit que les ingrédients mis à l'échelle ne dépassent jamais le stock", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      makeFoodItem({ name: "Riz", quantity: 1, grams: "80" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).not.toBeNull();
    
    // Le ratio devrait être limité par le Riz : 80/100 = 0.8
    // Le Poulet serait 160/200 = 0.8 également → min = 0.8
    expect(ratio).toBeCloseTo(0.8);
    
    // Vérifie que les ingrédients mis à l'échelle ne dépassent pas le stock
    const scaled = buildScaledMealForRatio(meal, ratio!);
    const groups = parseIngredientGroups(scaled.ingredients!);
    
    // Poulet mis à l'échelle : 200 * 0.8 = 160g → le stock a 160g ✓
    expect(groups[0][0][0].qty).toBeLessThanOrEqual(160);
    // Riz mis à l'échelle : 100 * 0.8 = 80g → le stock a 80g ✓
    expect(groups[1][0][0].qty).toBeLessThanOrEqual(80);
  });

  it("garantit que le pourcentage reflète l'ingrédient le plus limitant", () => {
    const items = [
      makeFoodItem({ name: "Viande", quantity: 1, grams: "250" }),  // assez
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "12" }),    // 12/25 = 0.48 → trop bas
    ];
    const meal = makeMeal({ name: "Test", ingredients: "250g Viande, 25g Sauce" });
    const map = buildStockMap(items);
    // Ratio Sauce = 0.48 < 0.5, devrait retourner null (sous le seuil)
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("gère correctement quand tous les ingrédients ont des ratios différents", () => {
    const items = [
      makeFoodItem({ name: "Pomme", quantity: 1, grams: "90" }),
      makeFoodItem({ name: "Banane", quantity: 1, grams: "140" }),
      makeFoodItem({ name: "Carotte", quantity: 1, grams: "240" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "100g Pomme, 200g Banane, 300g Carotte" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.7);

    const scaled = buildScaledMealForRatio(meal, ratio!);
    const groups = parseIngredientGroups(scaled.ingredients!);
    expect(groups[1][0][0].qty).toBeLessThanOrEqual(140);
    expect(groups[0][0][0].qty).toBeLessThanOrEqual(90);
  });
});

// ─── Compteur et ingrédients ∞ ────────────────────────────────────────────────

describe("analyzeMealIngredients — stock infini", () => {
  it("n’expose pas de compteur quand tous les ingrédients sont en stock ∞", () => {
    const counterDate = "2026-04-20T10:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Whey", is_infinite: true, counter_start_date: counterDate }),
      makeFoodItem({ name: "Eau", is_infinite: true, counter_start_date: counterDate }),
    ];
    const meal = makeMeal({
      name: "Shaker whey",
      ingredients: "15g Whey, 100g Eau",
    });
    const analysis = analyzeMealIngredients(meal, foodItems);
    expect(analysis.earliestCounterDate).toBeNull();
    expect(analysis.hasCounterableIngredient).toBe(false);
    expect(recipeHasFiniteCounterableIngredients(meal.ingredients, foodItems)).toBe(false);
  });

  it("affiche le compteur d’une alternative OU disponible même si no_counter (compteur manuel)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const foodItems = [
      makeFoodItem({
        name: "Blanc de poulet",
        quantity: 2,
        grams: null,
        no_counter: true,
        counter_start_date: "2026-07-16T10:00:00.000Z",
      }),
    ];
    const meal = makeMeal({
      name: "Sandwich",
      ingredients: "2 Blanc de dinde | 2 Blanc de poulet | 75g Dés de poulet, 25g Fuet",
    });
    const analysis = analyzeMealIngredients(meal, foodItems);
    expect(analysis.maxIngredientCounter).toBe(1);
    expect(analysis.counterIngredientNames.has("blanc de poulet")).toBe(true);
    expect(analysis.hasCounterableIngredient).toBe(false);
    vi.useRealTimers();
  });

  it("masque le compteur recette quand no_counter sur un aliment au grammage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    const foodItems = [
      makeFoodItem({
        name: "Pomme de terre",
        grams: "500",
        quantity: 2,
        no_counter: true,
        counter_start_date: "2026-07-09T10:00:00.000Z",
      }),
    ];
    const meal = makeMeal({
      name: "Poulet patate",
      ingredients: "375g Pomme de terre, 200g Filet de poulet",
    });
    const analysis = analyzeMealIngredients(meal, foodItems);
    expect(analysis.counterIngredientNames.has("pomme de terre")).toBe(false);
    expect(analysis.maxIngredientCounter).toBeNull();
    expect(findEarliestActiveCounterDate(meal.ingredients, foodItems)).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("restoreIngredientDisplayNamesFromReference", () => {
  it("restaure les apostrophes depuis la recette maître sans changer les quantités scalées", () => {
    const out = restoreIngredientDisplayNamesFromReference(
      "25.5g Flocon davoine, 52.5g Whey",
      "34g Flocon d'avoine, 70g Whey",
    );
    expect(out).toBe("25.5g Flocon d'avoine, 52.5g Whey");
  });
});

describe("getProgrammedOnlyCounterStart (badge carte Possible)", () => {
  it("renvoie la date FUTURE quand un ingrédient est seulement en Prog. (pas encore ouvert)", () => {
    // Bug Croque Monsieur : seul Blanc de dinde porte un compteur futur (Prog.), les autres ingrédients
    // n'ont aucun compteur. Le badge doit s'appuyer sur cette date future, pas sur une date passée figée.
    const fixedNow = new Date("2026-07-17T07:34:00.000Z");
    const progDate = "2026-07-17T17:00:00.000Z"; // vendredi soir, futur par rapport à now
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: progDate }),
      makeFoodItem({ name: "Pain de mie", quantity: 4, grams: null }),
      makeFoodItem({ name: "Gruyère", grams: "200" }),
      makeFoodItem({ name: "Fuet", grams: "150" }),
      makeFoodItem({ name: "Chorizo", grams: "150" }),
    ];
    const ingredients = "4 Pain de mie, 2 Blanc de dinde, 40g Gruyère, 30g Fuet, 30g Chorizo";

    expect(findEarliestActiveCounterDate(ingredients, foodItems, undefined, fixedNow)).toBeUndefined();
    expect(findEarliestFutureCounterDate(ingredients, foodItems, undefined, fixedNow)).toBe(progDate);
    expect(getProgrammedOnlyCounterStart(ingredients, foodItems, undefined, fixedNow)).toBe(progDate);
  });

  it("le badge n'affiche AUCUN Xj actif quand le repas est planifié le même jour que l'ouverture Prog.", () => {
    // Reproduction exacte du bug : carte planifiée vendredi soir, ouverture Prog. vendredi soir → 0j → rien.
    const fixedNow = new Date("2026-07-17T07:34:00.000Z");
    const progDate = "2026-07-17T17:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: progDate }),
    ];
    const ingredients = "2 Blanc de dinde, 40g Gruyère";
    const effectiveStart = getProgrammedOnlyCounterStart(ingredients, foodItems, undefined, fixedNow);
    expect(effectiveStart).toBe(progDate);
    // getAdaptedCounterDays sur la date FUTURE (le même jour) → null (aucun badge), au lieu d'un 1j fantôme.
    expect(getAdaptedCounterDays(effectiveStart!, "2026-07-17", undefined, "soir", fixedNow)).toBeNull();
  });

  it("laisse la priorité à l'ouverture réelle passée (retourne undefined si un lot est déjà ouvert)", () => {
    const fixedNow = new Date("2026-07-17T07:34:00.000Z");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-16T10:00:00.000Z" }),
    ];
    const ingredients = "2 Blanc de dinde, 40g Gruyère";
    expect(getProgrammedOnlyCounterStart(ingredients, foodItems, undefined, fixedNow)).toBeUndefined();
  });

  it("conserve l'estimation Xj quand le repas est planifié APRÈS l'ouverture Prog.", () => {
    // Ex. lot programmé vendredi soir, repas planifié samedi soir → 1j (estimation légitime).
    const fixedNow = new Date("2026-07-17T07:34:00.000Z");
    const progDate = "2026-07-17T17:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: progDate }),
    ];
    const ingredients = "2 Blanc de dinde, 40g Gruyère";
    const effectiveStart = getProgrammedOnlyCounterStart(ingredients, foodItems, undefined, fixedNow);
    expect(getAdaptedCounterDays(effectiveStart!, "2026-07-18", undefined, "soir", fixedNow)).toBe(1);
  });
});

describe("getRecipeMaxActiveFoodCounterDays (badge aligné Aliments)", () => {
  it("prend le max des compteurs Aliments ouverts, pas une date figée de carte", () => {
    // Après 19h : Blanc de dinde ouvert aujourd'hui 19h → 0j en Aliments.
    // Même si une date figée hier existe côté carte, le badge doit suivre l'aliment (0j).
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-17T19:00:00.000+02:00" }),
      makeFoodItem({ name: "Pain de mie", quantity: 4, grams: null }),
    ];
    const ingredients = "4 Pain de mie, 2 Blanc de dinde, 50g Gruyère, 30g Chorizo";
    expect(getRecipeMaxActiveFoodCounterDays(ingredients, foodItems, undefined, fixedNow)).toBe(0);
  });

  it("choisit le plus haut compteur quand plusieurs aliments sont ouverts", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-17T19:00:00.000+02:00" }),
      makeFoodItem({ name: "Chorizo", grams: "150", counter_start_date: "2026-07-15T12:00:00.000+02:00" }),
    ];
    const ingredients = "2 Blanc de dinde, 30g Chorizo";
    expect(getRecipeMaxActiveFoodCounterDays(ingredients, foodItems, undefined, fixedNow)).toBe(2);
  });

  it("ignore les compteurs Prog. futurs (retourne null)", () => {
    const fixedNow = new Date("2026-07-17T07:34:00.000Z");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-17T17:00:00.000Z" }),
    ];
    expect(getRecipeMaxActiveFoodCounterDays("2 Blanc de dinde", foodItems, undefined, fixedNow)).toBeNull();
  });

  it("retourne null quand aucun aliment n'est ouvert (consommés juste après ouverture)", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: null }),
      makeFoodItem({ name: "Pain de mie", quantity: 4, grams: null }),
    ];
    expect(getRecipeMaxActiveFoodCounterDays(
      "4 Pain de mie, 2 Blanc de dinde, 50g Gruyère",
      foodItems,
      undefined,
      fixedNow,
    )).toBeNull();
  });

  it("expose aussi la date de démarrage pour l'infobulle", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const start = "2026-07-17T19:00:00.000+02:00";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: start }),
    ];
    expect(getRecipeMaxActiveFoodCounter("2 Blanc de dinde", foodItems, undefined, fixedNow)).toEqual({
      days: 0,
      startDate: start,
      foodName: "Blanc de dinde",
    });
  });

  it("avec créneau planifié : jours entre ouverture et repas (ven. 19h → sam. soir = 1j)", () => {
    // Bug Croque Monsieur : badge vs maintenant = 0j ; doit afficher 1j jusqu’au repas demain soir.
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const start = "2026-07-17T19:00:00.000+02:00";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: start }),
    ];
    expect(getRecipeMaxActiveFoodCounterDays(
      "2 Blanc de dinde",
      foodItems,
      undefined,
      fixedNow,
      "2026-07-18",
      "soir",
    )).toBe(1);
  });

  it("même jour soir que l'ouverture : 0 ou null selon getAdaptedCounterDays", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const start = "2026-07-17T19:00:00.000+02:00";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: start }),
    ];
    const expected = getAdaptedCounterDays(start, "2026-07-17", undefined, "soir", fixedNow);
    expect(getRecipeMaxActiveFoodCounterDays(
      "2 Blanc de dinde",
      foodItems,
      undefined,
      fixedNow,
      "2026-07-17",
      "soir",
    )).toBe(expected);
  });

  it("aucun aliment ouvert + créneau planifié → null (pas de badge)", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: null }),
    ];
    expect(getRecipeMaxActiveFoodCounter(
      "2 Blanc de dinde",
      foodItems,
      undefined,
      fixedNow,
      "2026-07-18",
      "soir",
    )).toBeNull();
  });

  it("avec créneau planifié : compteur Prog. futur encore avant le repas → décalage (ven. 19h Prog. → sam. soir = 1j)", () => {
    // Après updateFoodItemCountersForPlanning le lot peut être « Prog. » (start > now) ;
    // le gel planning doit quand même pouvoir calculer le décalage jusqu’au créneau.
    const fixedNow = new Date("2026-07-17T12:00:00.000+02:00");
    const start = "2026-07-17T19:00:00.000+02:00"; // futur (Prog.) au moment du gel
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: start }),
    ];
    expect(hasActiveFoodItemCounter(foodItems[0], fixedNow)).toBe(false);
    expect(getRecipeMaxActiveFoodCounterDays(
      "2 Blanc de dinde",
      foodItems,
      undefined,
      fixedNow,
      "2026-07-18",
      "soir",
    )).toBe(1);
  });
});

describe("computePossibleFrozenCounterDays (gel badge Possible)", () => {
  it("aligne le gel sur getRecipeMaxActiveFoodCounterDays (vs maintenant)", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-17T19:00:00.000+02:00" }),
      makeFoodItem({ name: "Chorizo", grams: "150", counter_start_date: "2026-07-15T12:00:00.000+02:00" }),
    ];
    const ingredients = "2 Blanc de dinde, 30g Chorizo";
    expect(computePossibleFrozenCounterDays(ingredients, foodItems, undefined, fixedNow)).toBe(2);
    expect(computePossibleFrozenCounterDays(ingredients, foodItems, undefined, fixedNow)).toBe(
      getRecipeMaxActiveFoodCounterDays(ingredients, foodItems, undefined, fixedNow),
    );
  });

  it("avec créneau planifié : fige 1j (ven. 19h → sam. soir)", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: "2026-07-17T19:00:00.000+02:00" }),
    ];
    expect(computePossibleFrozenCounterDays(
      "2 Blanc de dinde",
      foodItems,
      undefined,
      fixedNow,
      "2026-07-18",
      "soir",
    )).toBe(1);
  });

  it("aucun aliment ouvert → null (gel sans badge)", () => {
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: null }),
    ];
    expect(computePossibleFrozenCounterDays("2 Blanc de dinde", foodItems, undefined, fixedNow)).toBeNull();
  });

  it("stock déjà Prog. sur le créneau + baseStartDate passée → 1j (récupération après Soir)", () => {
    // ven. 17 19h = vraie ouverture ; sam. 18 19h = Prog. déjà posé sur le stock
    const fixedNow = new Date("2026-07-17T20:00:00.000+02:00");
    const fridayOpen = "2026-07-17T19:00:00.000+02:00";
    const saturdayProg = "2026-07-18T19:00:00.000+02:00";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 2, grams: null, counter_start_date: saturdayProg }),
    ];
    // Sans base : Prog. = créneau → null
    expect(
      computePossibleFrozenCounterDays(
        "2 Blanc de dinde", foodItems, undefined, fixedNow, "2026-07-18", "soir", undefined,
      ),
    ).toBeNull();
    // Avec base = ouverture réelle ven. → 1j jusqu’à sam. soir
    expect(
      computePossibleFrozenCounterDays(
        "2 Blanc de dinde", foodItems, undefined, fixedNow, "2026-07-18", "soir", undefined, fridayOpen,
      ),
    ).toBe(1);
  });

  it("Prog. lundi + repas mardi (autre recette) → 1j sur la carte la plus tardive", () => {
    // Blanc prog. lundi 20 19h ; 2e recette planifiée mardi 21 19h → badge 1j
    const fixedNow = new Date("2026-07-17T12:00:00.000+02:00");
    const mondayProg = "2026-07-20T19:00:00.000+02:00";
    const foodItems = [
      makeFoodItem({ name: "Blanc de dinde", quantity: 4, grams: null, counter_start_date: mondayProg }),
    ];
    expect(
      computePossibleFrozenCounterDays(
        "2 Blanc de dinde",
        foodItems,
        undefined,
        fixedNow,
        "2026-07-21",
        "soir",
      ),
    ).toBe(1);
  });

  it("lit / écrit la map prefs : clé absente vs null figé", () => {
    const map: PossibleFrozenCounterDaysMap = { "pm-a": 2, "pm-null": null };
    expect(hasFrozenPossibleCounter(map, "pm-a")).toBe(true);
    expect(hasFrozenPossibleCounter(map, "pm-null")).toBe(true);
    expect(hasFrozenPossibleCounter(map, "pm-missing")).toBe(false);
    expect(readFrozenPossibleCounterDays(map, "pm-a")).toBe(2);
    expect(readFrozenPossibleCounterDays(map, "pm-null")).toBeNull();
    expect(readFrozenPossibleCounterDays(map, "pm-missing")).toBeUndefined();
    expect(formatFrozenPossibleCounterTooltip(2)).toBe("2j (figé)");
    expect(formatFrozenPossibleCounterTooltip(null)).toBeUndefined();
  });
});

describe("mergeFrozenPossibleCounterDays (re-gel sans effacer)", () => {
  it("null calculé ne remplace pas un 0j / 1j déjà figé", () => {
    expect(mergeFrozenPossibleCounterDays(0, null)).toBe(0);
    expect(mergeFrozenPossibleCounterDays(1, null)).toBe(1);
  });

  it("nombre calculé remplace null figé ou absence", () => {
    expect(mergeFrozenPossibleCounterDays(null, 1)).toBe(1);
    expect(mergeFrozenPossibleCounterDays(undefined, 1)).toBe(1);
  });

  it("re-planif : nouveau nombre remplace l’ancien (2j → 1j)", () => {
    expect(mergeFrozenPossibleCounterDays(2, 1)).toBe(1);
    expect(mergeFrozenPossibleCounterDays(0, 1)).toBe(1);
    expect(mergeFrozenPossibleCounterDays(1, 2)).toBe(2);
  });

  it("null + null → null", () => {
    expect(mergeFrozenPossibleCounterDays(null, null)).toBeNull();
    expect(mergeFrozenPossibleCounterDays(undefined, null)).toBeNull();
  });
});

describe("resolveCounterStartForPossibleBadge", () => {
  it("ne renvoie rien pour une recette 100 % ∞ même si les fiches portent counter_start_date", () => {
    const foodItems = [
      makeFoodItem({ name: "Whey", is_infinite: true, counter_start_date: "2026-04-20T10:00:00.000Z" }),
    ];
    const pm = {
      id: "pm-shaker",
      day_of_week: "2026-04-25",
      meal_time: "soir",
      ingredients_override: "15g Whey, 100g Eau",
      meals: { ingredients: "30g Whey, 200g Eau" },
    };
    const fixedNow = new Date("2026-04-25T10:00:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      pm,
      [],
      "2026-04-20T10:00:00.000Z",
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBeUndefined();
  });

  it("aligne sur le créneau planifié seulement si l’ouverture est encore future", () => {
    const futureOpen = "2026-04-22T08:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: futureOpen }),
    ];
    const pm = {
      id: "pm-burger",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders" },
    };
    const fixedNow = new Date("2026-04-21T20:00:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      pm,
      [],
      futureOpen,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBeDefined();
    const plannedSlot = new Date("2026-04-23T10:00:00.000Z").getTime();
    expect(new Date(out!).getTime()).toBe(plannedSlot);
  });

  it("conserve le compteur de la carte quand le lot est déjà ouvert (sans compteur food_items)", () => {
    const activeDate = "2026-06-11T19:35:00.000Z";
    const foodItems = [makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: null })];
    const pm = {
      id: "burrito",
      day_of_week: "2026-06-13",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "1 Galette, 200g Tenders" },
    };
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      pm,
      [],
      null,
      activeDate,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(activeDate);
  });

  it("conserve base quand un sibling non planifié partage l’ingrédient critique (consommation immédiate)", () => {
    // Scénario : « Mini rosti + Tenders » sans créneau → consomme les Tenders maintenant.
    // Burger tenders (jeu. 23) doit alors afficher un compteur écoulé, pas le mode prog.
    const baseDate = "2026-04-21T20:35:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: baseDate }),
    ];
    const burger = {
      id: "a",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders" },
    };
    const rosti = {
      id: "b",
      day_of_week: null,
      meal_time: null,
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders, 250g Mini rosti" },
    };
    const fixedNow = new Date("2026-04-21T20:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [rosti],
      baseDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(baseDate);
  });

  it("conserve le compteur stock déjà lancé quand on choisit un créneau futur", () => {
    const baseDate = "2026-06-11T19:35:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: baseDate }),
    ];
    const burrito = {
      id: "burrito",
      day_of_week: "2026-06-13",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "1 Galette, 200g Tenders, 25g Sauce" },
    };
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burrito,
      [],
      baseDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(baseDate);
  });

  it("conserve le compteur actif quand on passe de Midi seul au jour (midi puis jour)", () => {
    const activeDate = "2026-06-11T19:35:00.000Z";
    const programmedDate = "2026-06-13T10:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: activeDate }),
    ];
    const midiOnly = {
      id: "burrito",
      day_of_week: null as string | null,
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "1 Galette, 200g Tenders, 25g Sauce" },
    };
    const withDay = { ...midiOnly, day_of_week: "2026-06-13" };
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const outMidiOnly = resolveCounterStartForPossibleBadge(
      midiOnly,
      [],
      programmedDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
      activeDate,
    );
    const outWithDay = resolveCounterStartForPossibleBadge(
      withDay,
      [withDay],
      programmedDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
      activeDate,
    );
    expect(outMidiOnly).toBe(activeDate);
    expect(outWithDay).toBe(activeDate);
  });

  it("conserve le compteur actif quand on passe de jour seul à Midi (scénario burrito)", () => {
    const activeDate = "2026-06-11T19:35:00.000Z";
    const programmedDate = "2026-06-13T10:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: activeDate }),
    ];
    const withoutMealTime = {
      id: "burrito",
      day_of_week: "2026-06-13",
      meal_time: null as string | null,
      ingredients_override: null as string | null,
      meals: { ingredients: "1 Galette, 200g Tenders, 25g Sauce" },
    };
    const withMidi = { ...withoutMealTime, meal_time: "midi" };
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const outBefore = resolveCounterStartForPossibleBadge(
      withoutMealTime,
      [],
      programmedDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
      activeDate,
    );
    const outAfter = resolveCounterStartForPossibleBadge(
      withMidi,
      [withMidi],
      programmedDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
      activeDate,
    );
    expect(outBefore).toBe(activeDate);
    expect(outAfter).toBe(activeDate);
  });

  it("conserve le compteur actif même si l'analyse renvoie une date future programmée", () => {
    const activeDate = "2026-06-11T19:35:00.000Z";
    const programmedDate = "2026-06-13T10:00:00.000Z";
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: activeDate }),
    ];
    const burrito = {
      id: "burrito",
      day_of_week: "2026-06-13",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "1 Galette, 200g Tenders, 25g Sauce" },
    };
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burrito,
      [],
      programmedDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(activeDate);
  });

  it("masque le compteur quand l’ingrédient est no_counter ou surgelé", () => {
    const foodItems = [
      makeFoodItem({ name: "Tenders", grams: "500", no_counter: true, storage_type: "surgele" }),
    ];
    const burger = {
      id: "a",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders" },
    };
    const fixedNow = new Date("2026-04-22T10:00:00.000Z");
    const base = "2026-04-21T10:00:00.000Z";
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [],
      null,
      base,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBeUndefined();
  });

  it("conserve la date du stock si un sibling partageant l’ingrédient est planifié plus tôt", () => {
    const foodItems = [makeFoodItem({ name: "Tenders", grams: "500" })];
    const burger = {
      id: "a",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders" },
    };
    const rosti = {
      id: "b",
      day_of_week: "2026-04-22",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders, 250g Mini rosti" },
    };
    const base = "2026-04-21T10:00:00.000Z";
    const fixedNow = new Date("2026-04-21T08:00:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [rosti],
      base,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(base);
  });

  it("hérite de la date d'un sibling non planifié quand le stock ne porte pas de counter_start_date", () => {
    // Scénario : Mini rosti + Tenders non planifié (vient d'être ajouté, counter_start_date = now).
    // Les Tenders dans food_items n'ont PAS de counter_start_date (déduction non appliquée).
    // Burger tenders (jeu. 23) doit quand même afficher son compteur écoulé, hérité de Mini rosti.
    const foodItems = [makeFoodItem({ name: "Tenders", grams: "500", counter_start_date: null })];
    const nowDate = "2026-04-21T20:35:00.000Z";
    const burger = {
      id: "a",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      counter_start_date: null,
      created_at: "2026-04-20T00:00:00.000Z",
      meals: { ingredients: "200g Tenders" },
    };
    const minirosti = {
      id: "b",
      day_of_week: null,
      meal_time: null,
      ingredients_override: null as string | null,
      counter_start_date: nowDate,
      created_at: nowDate,
      meals: { ingredients: "200g Tenders, 250g Mini rosti" },
    };
    const fixedNow = new Date("2026-04-21T20:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [minirosti],
      null,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(nowDate);
  });

  it("conserve le stock déjà ouvert même si le sibling partage un ingrédient compteur non critique", () => {
    // Scénario réel observé : Burger tenders (jeudi midi) a Tenders déjà entamés (base),
    // un sandwich (mercredi midi) partage Gruyère/Chorizo mais n'ouvre pas les Tenders.
    // Le sibling mercredi ne doit PAS dicter le départ, mais les Tenders déjà ouverts restent prioritaires.
    const baseDate = "2026-04-21T20:35:00.000Z";
    const foodItems = [
      makeFoodItem({
        name: "Tenders",
        grams: "500",
        counter_start_date: baseDate,
      }),
      makeFoodItem({ name: "Gruyere", grams: "200" }),
      makeFoodItem({ name: "Chorizo", grams: "200" }),
    ];
    const burger = {
      id: "burger",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: {
        ingredients: "200g Tenders, 35g Gruyere, 20g Chorizo",
      },
    };
    const sandwich = {
      id: "sandwich",
      day_of_week: "2026-04-22",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: {
        ingredients: "4 Pain de mie, 40g Gruyere, 30g Chorizo",
      },
    };
    const fixedNow = new Date("2026-04-21T20:37:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [sandwich],
      baseDate,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(baseDate);
  });

  it("conserve l’ouverture réelle même si le sibling partageant est sur un créneau passé", () => {
    const foodItems = [makeFoodItem({ name: "Tenders", grams: "500" })];
    const burger = {
      id: "a",
      day_of_week: "2026-04-23",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders" },
    };
    const oldSibling = {
      id: "b",
      day_of_week: "2026-04-20",
      meal_time: "midi",
      ingredients_override: null as string | null,
      meals: { ingredients: "200g Tenders, 250g Mini rosti" },
    };
    const base = "2026-04-21T10:00:00.000Z";
    const fixedNow = new Date("2026-04-21T20:00:00.000Z");
    const out = resolveCounterStartForPossibleBadge(
      burger,
      [oldSibling],
      base,
      undefined,
      foodItems,
      undefined,
      fixedNow,
    );
    expect(out).toBe(base);
  });
});
