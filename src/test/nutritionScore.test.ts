import { describe, expect, it } from "vitest";
import {
  computeNutritionScoreV7,
  computeNutritionScoreV7Raw,
  computeIngredientCaloricDensityAdjustment,
  computeViandeIngredientNutritionScoreRaw,
  computeFeculentIngredientNutritionScoreRaw,
  getIngredientMacroNutritionScore,
  getIngredientMacroNutritionScoreRaw,
  getMealNutritionScore,
  normalizeUnitMacrosToPer100g,
  resolveIngredientMacrosForNutritionScore,
} from "@/lib/nutritionScore";

describe("computeNutritionScoreV7", () => {
  it("retourne 100 pour une densité protéique parfaite sans fibres", () => {
    expect(computeNutritionScoreV7(500, 50, 0)).toBe(100);
  });

  it("ajoute un bonus fibres sans pénaliser l'absence de fibres", () => {
    expect(computeNutritionScoreV7(500, 50, 5)).toBe(100);
    expect(computeNutritionScoreV7(869, 71, 1)).toBe(83);
  });

  it("retourne null si calories ou protéines manquantes", () => {
    expect(computeNutritionScoreV7(null, 40, 5)).toBeNull();
    expect(computeNutritionScoreV7(500, null, 5)).toBeNull();
  });
});

describe("computeNutritionScoreV7Raw", () => {
  it("dépasse 100 quand la densité protéique dépasse 100 g/1000 kcal", () => {
    // Affiché 100, mais raw 110 (densité 110, pas de fibres)
    expect(computeNutritionScoreV7(500, 55, 0)).toBe(100);
    expect(computeNutritionScoreV7Raw(500, 55, 0)).toBe(110);
  });

  it("dépasse 100 avec bonus fibres au-delà du plafond d'affichage", () => {
    // Densité 100 + bonus fibres 10 → raw 110, affichage 100
    expect(computeNutritionScoreV7(500, 50, 5)).toBe(100);
    expect(computeNutritionScoreV7Raw(500, 50, 5)).toBe(110);
  });

  it("reste égal à l'affichage quand le score est sous 100", () => {
    expect(computeNutritionScoreV7Raw(869, 71, 1)).toBe(83);
    expect(computeNutritionScoreV7(869, 71, 1)).toBe(83);
  });

  it("retourne null si calories ou protéines manquantes", () => {
    expect(computeNutritionScoreV7Raw(null, 40, 5)).toBeNull();
    expect(computeNutritionScoreV7Raw(500, null, 5)).toBeNull();
  });
});

describe("getMealNutritionScore", () => {
  it("ignore les catégories hors Plat / Petit déj", () => {
    expect(
      getMealNutritionScore({
        category: "dessert",
        calories: "500",
        protein: "50",
        fiber: "5",
      }),
    ).toBeNull();
  });

  it("calcule depuis les macros directes pour un petit déj sans ingrédients", () => {
    expect(
      getMealNutritionScore({
        category: "petit_dejeuner",
        calories: "345",
        protein: "43",
        fiber: "7",
      }),
    ).toBe(100);
  });
});

describe("getIngredientMacroNutritionScore", () => {
  it("calcule la même note v7 depuis les chaînes macros d'un ingrédient", () => {
    expect(getIngredientMacroNutritionScore("500", "50", "0")).toBe(100);
    expect(getIngredientMacroNutritionScore("869 kcal", "71", "1")).toBe(83);
  });

  it("retourne null si calories ou protéines manquent", () => {
    expect(getIngredientMacroNutritionScore("", "40", "5")).toBeNull();
    expect(getIngredientMacroNutritionScore("500", "", "5")).toBeNull();
  });
});

describe("getIngredientMacroNutritionScoreRaw", () => {
  it("affiche 100 pour deux macros mais distingue leurs scores bruts", () => {
    // densités 110 et 105 → affichage 100, raw 110 vs 105
    expect(getIngredientMacroNutritionScore("500", "55", "0")).toBe(100);
    expect(getIngredientMacroNutritionScore("500", "52.5", "0")).toBe(100);
    expect(getIngredientMacroNutritionScoreRaw("500", "55", "0")).toBe(110);
    expect(getIngredientMacroNutritionScoreRaw("500", "52.5", "0")).toBe(105);
  });
});

describe("normalizeUnitMacrosToPer100g", () => {
  it("convertit macros/unité en équivalent pour 100 g", () => {
    // 1 unité = 80 g → × 100/80 = 1.25
    expect(normalizeUnitMacrosToPer100g(117, 10, 2, 80)).toEqual({
      calories: 146.25,
      protein: 12.5,
      fiber: 2.5,
    });
  });

  it("retourne null si grammes/unité invalides", () => {
    expect(normalizeUnitMacrosToPer100g(100, 10, 1, null)).toBeNull();
    expect(normalizeUnitMacrosToPer100g(100, 10, 1, 0)).toBeNull();
    expect(normalizeUnitMacrosToPer100g(100, 10, 1, -5)).toBeNull();
  });

  it("conserve les macros nulles après conversion", () => {
    expect(normalizeUnitMacrosToPer100g(100, null, undefined, 50)).toEqual({
      calories: 200,
      protein: null,
      fiber: null,
    });
  });
});

describe("note Macro Quantité avec grammes/unité", () => {
  it("résout les macros au 100 g quand basis Quantité + unitGrams", () => {
    const macros = resolveIngredientMacrosForNutritionScore("80", "8", "1", {
      basisLabel: "Quantité",
      unitGrams: 80,
    });
    expect(macros.calories).toBe(100);
    expect(macros.protein).toBe(10);
    expect(macros.fiber).toBe(1.25);
  });

  it("ne normalise pas sans grammes/unité ni hors base Quantité", () => {
    expect(
      resolveIngredientMacrosForNutritionScore("80", "8", "1", { basisLabel: "Quantité" }),
    ).toEqual({ calories: 80, protein: 8, fiber: 1 });
    expect(
      resolveIngredientMacrosForNutritionScore("80", "8", "1", {
        basisLabel: "100g",
        unitGrams: 80,
      }),
    ).toEqual({ calories: 80, protein: 8, fiber: 1 });
  });

  it("calcule la note sur macros converties au 100 g", () => {
    // 40 kcal / 4 g prot / 40 g → 100 kcal / 10 g prot pour 100 g → densité 100 → note 100 + bonus densité
    expect(
      getIngredientMacroNutritionScore("40", "4", "0", {
        basisLabel: "Quantité",
        unitGrams: 40,
      }),
    ).toBe(100);
    expect(
      getIngredientMacroNutritionScoreRaw("40", "4", "0", {
        basisLabel: "Quantité",
        unitGrams: 40,
      }),
    ).toBe(106);

    // Sans base 100 g connue → pas de bonus densité (ratios seuls)
    expect(getIngredientMacroNutritionScore("40", "4", "0")).toBe(100);
  });

  it("applique aussi le bonus fibres après normalisation", () => {
    // 40 kcal / 4 prot / 2 fib / 40 g → 100 / 10 / 5 pour 100 g
    // densité 100 + bonus fibres 15 + bonus kcal/100g +6 → raw 121, affichage 100
    expect(
      getIngredientMacroNutritionScoreRaw("40", "4", "2", {
        basisLabel: "Quantité",
        unitGrams: 40,
      }),
    ).toBe(121);
    expect(
      getIngredientMacroNutritionScore("40", "4", "2", {
        basisLabel: "Quantité",
        unitGrams: 40,
      }),
    ).toBe(100);
  });

  it("favorise les féculents peu caloriques au 100 g (pomme de terre vs pain burger)", () => {
    const potato = getIngredientMacroNutritionScore("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    const burgerBun = getIngredientMacroNutritionScore("199", "5", "3.34", {
      basisLabel: "Quantité",
      unitGrams: 55,
      foodType: "feculent",
    });
    expect(potato).toBe(75);
    expect(burgerBun).toBe(35);
    expect(potato).toBeGreaterThan(burgerBun!);
  });
});

describe("note Macro par type viande / féculent", () => {
  it("viande : favorise volume, densité protéique et protéines au 100 g", () => {
    expect(computeViandeIngredientNutritionScoreRaw(105, 24, 105)).toBe(97);
    expect(computeViandeIngredientNutritionScoreRaw(280, 18, 280)).toBe(44);
    expect(
      getIngredientMacroNutritionScore("105", "24", "0", {
        basisLabel: "100g",
        foodType: "viande",
      }),
    ).toBe(97);
  });

  it("viande : le jaune d'œuf léger dépasse le poisson pané grâce au volume", () => {
    const jaune = getIngredientMacroNutritionScore("55", "2.7", "0", {
      basisLabel: "100g",
      foodType: "viande",
    });
    const poisson = getIngredientMacroNutritionScore("209", "14", "1.3", {
      basisLabel: "100g",
      foodType: "viande",
    });
    expect(jaune).toBe(65);
    expect(poisson).toBe(56);
    expect(jaune).toBeGreaterThan(poisson!);
  });

  it("viande : jaune d'œuf très calorique au 100 g reste sous une viande maigre", () => {
    const jauneReel = getIngredientMacroNutritionScore("322", "16", "0", {
      basisLabel: "100g",
      foodType: "viande",
    });
    const dinde = getIngredientMacroNutritionScore("105", "24", "0", {
      basisLabel: "100g",
      foodType: "viande",
    });
    expect(jauneReel).toBe(30);
    expect(dinde).toBe(97);
    expect(dinde).toBeGreaterThan(jauneReel!);
  });

  it("féculent : favorise fibres et faible densité énergétique (volume)", () => {
    expect(computeFeculentIngredientNutritionScoreRaw(82, 2, 82)).toBe(75);
    expect(computeFeculentIngredientNutritionScoreRaw(248, 3, 248)).toBe(39);
    expect(
      getIngredientMacroNutritionScore("248", "8", "3", {
        basisLabel: "100g",
        foodType: "feculent",
      }),
    ).toBe(39);
  });

  it("féculent : moins de kcal au 100 g = meilleure note (grenaille Picard vs Patatoes Lidl)", () => {
    const picard = getIngredientMacroNutritionScore("122", "2.6", "2.4", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    const lidl = getIngredientMacroNutritionScore("131", "2.1", "2.2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(picard).toBe(68);
    expect(lidl).toBe(67);
    expect(picard).toBeGreaterThan(lidl!);
  });

  it("sans type : conserve la formule générique v7 + densité", () => {
    expect(
      getIngredientMacroNutritionScore("82", "2", "2", { basisLabel: "100g" }),
    ).toBe(49);
  });
});

describe("computeIngredientCaloricDensityAdjustment", () => {
  it("bonus pour faible densité, malus pour forte densité", () => {
    expect(computeIngredientCaloricDensityAdjustment(82)).toBe(10);
    expect(computeIngredientCaloricDensityAdjustment(130)).toBe(0);
    expect(computeIngredientCaloricDensityAdjustment(248)).toBe(-17);
    expect(computeIngredientCaloricDensityAdjustment(362)).toBe(-33);
  });
});
