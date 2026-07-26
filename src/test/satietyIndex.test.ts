import { describe, expect, it } from "vitest";
import {
  clampMealSatietyIndex,
  computeIngredientSatietyContribution,
  computeSatietyPortionFactor,
  estimateMealsCardsSatietyIndex,
  estimateMealsCardsSatietyIndexFromMealMacros,
  formatMealSatietyIndexTooltip,
  getIngredientSatietyIndex,
  getMealRecipeSatietyDetails,
  getMealRecipeSatietyIndex,
  getMealSatietyIndex,
  normalizeMealRecipeSatietyTotal,
  normalizeSatietyIndexPer100g,
  resolveFoodItemSatietyOptions,
  resolveFoodItemRecordSatietyOptions,
} from "@/lib/satietyIndex";

/** Attendu carte : somme pondérée brute round(Σ). */
function expectedMealSatietyFromContributions(rawSum: number): number {
  return Math.round(rawSum);
}

describe("estimateMealsCardsSatietyIndex", () => {
  it("augmente avec les protéines et les fibres, baisse avec les kcal", () => {
    const base = estimateMealsCardsSatietyIndex(100, 10, 2, null);
    expect(estimateMealsCardsSatietyIndex(100, 20, 2, null)).toBeGreaterThan(base);
    expect(estimateMealsCardsSatietyIndex(100, 10, 8, null)).toBeGreaterThan(base);
    expect(estimateMealsCardsSatietyIndex(250, 10, 2, null)).toBeLessThan(base);
  });

  it("favorise un féculent peu dense vs un pain calorique", () => {
    const potato = estimateMealsCardsSatietyIndex(82, 2, 2, "feculent");
    const bread = estimateMealsCardsSatietyIndex(265, 9, 2.5, null);
    expect(potato).toBeGreaterThan(bread);
  });

  it("ravioli conserve (peu protéiné, peu calorique) ≈ 25, pas le bonus volume pomme de terre", () => {
    const ravioli = estimateMealsCardsSatietyIndex(83, 3.6, 1.6, "feculent");
    const ravioliSansType = estimateMealsCardsSatietyIndex(83, 3.6, 1.6, null);
    expect(ravioli).toBeGreaterThanOrEqual(20);
    expect(ravioli).toBeLessThanOrEqual(35);
    expect(ravioliSansType).toBeGreaterThanOrEqual(20);
    expect(ravioliSansType).toBeLessThanOrEqual(35);
    // Bien sous l’ancien score ~65 dilué par le bonus faible densité
    expect(ravioli).toBeLessThan(40);
  });

  it("pomme de terre (féculent peu protéiné) garde un indice élevé", () => {
    const potato = estimateMealsCardsSatietyIndex(82, 2, 2, "feculent");
    expect(potato).toBeGreaterThanOrEqual(70);
  });

  it("crédite davantage une viande riche en protéines (proche de 100)", () => {
    const withType = estimateMealsCardsSatietyIndex(150, 12, 0, "viande");
    const withoutType = estimateMealsCardsSatietyIndex(150, 12, 0, null);
    expect(withType).toBeGreaterThan(withoutType);
    expect(estimateMealsCardsSatietyIndex(120, 20, 0, "viande")).toBeGreaterThanOrEqual(85);
  });

  it("applique un malus aux féculents denses (≥ 200 kcal/100 g)", () => {
    const dense = estimateMealsCardsSatietyIndex(220, 5, 3, "feculent");
    const sameWithoutType = estimateMealsCardsSatietyIndex(220, 5, 3, null);
    expect(dense).toBeLessThan(sameWithoutType);
  });

  it("reste dans [5, 100]", () => {
    expect(estimateMealsCardsSatietyIndex(900, 0, 0, null)).toBeGreaterThanOrEqual(5);
    expect(estimateMealsCardsSatietyIndex(50, 80, 40, "viande")).toBeLessThanOrEqual(100);
    expect(estimateMealsCardsSatietyIndex(120, 25, 0, "viande")).toBe(100);
  });
});

describe("getIngredientSatietyIndex", () => {
  it("estime un indice de base pour 100 g (pas une portion iso-calorique)", () => {
    const potato = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(potato).toBe(estimateMealsCardsSatietyIndex(82, 2, 2, "feculent"));
  });

  it("favorise la grenaille Picard vs Patatoes Lidl (féculent, densite 100 g)", () => {
    const picard = getIngredientSatietyIndex("122", "2.6", "2.4", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    const lidl = getIngredientSatietyIndex("131", "2.1", "2.2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(picard).not.toBeNull();
    expect(lidl).not.toBeNull();
    expect(picard!).toBeGreaterThan(lidl!);
  });

  it("normalise au 100 g en base Quantité avec grammes/unité", () => {
    const index = getIngredientSatietyIndex("40", "4", "2", {
      basisLabel: "Quantité",
      unitGrams: 40,
      foodType: "feculent",
    });
    const per100g = getIngredientSatietyIndex("100", "10", "5", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(index).toBe(per100g);
  });

  it("retourne null en Quantité sans poids d'unité", () => {
    expect(
      getIngredientSatietyIndex("80", "8", "1", { basisLabel: "Quantité", foodType: "feculent" }),
    ).toBeNull();
  });
});

describe("resolveFoodItemSatietyOptions", () => {
  it("choisit Quantité quand quantité et grammes/unité sont renseignés", () => {
    expect(resolveFoodItemSatietyOptions("3", "500", "feculent")).toEqual({
      basisLabel: "Quantité",
      unitGrams: 500,
      foodType: "feculent",
    });
  });

  it("retombe sur 100 g sans quantité ou sans grammes", () => {
    expect(resolveFoodItemSatietyOptions("", "500", "viande")).toEqual({
      basisLabel: "100g",
      foodType: "viande",
    });
    expect(resolveFoodItemSatietyOptions("2", "", null)).toEqual({
      basisLabel: "100g",
      foodType: null,
    });
  });
});

describe("resolveFoodItemRecordSatietyOptions", () => {
  it("réutilise la même logique qu'un formulaire Aliments quand quantité + grammes", () => {
    const fromForm = resolveFoodItemSatietyOptions("1", "40", "feculent");
    const fromRecord = resolveFoodItemRecordSatietyOptions({
      quantity: 1,
      grams: "40",
      food_type: "feculent",
    });
    expect(fromRecord).toEqual(fromForm);
  });

  it("garde la base Quantité même sans grammes/unité (comme Macro)", () => {
    expect(
      resolveFoodItemRecordSatietyOptions({
        quantity: 12,
        grams: null,
        food_type: "viande",
      }),
    ).toEqual({ basisLabel: "Quantité", foodType: "viande" });
  });
});

describe("computeSatietyPortionFactor / computeIngredientSatietyContribution", () => {
  it("applique 300@100g × 10g → contribution 30", () => {
    const factor = computeSatietyPortionFactor(10, 0, { basisLabel: "100g" });
    expect(factor).toBeCloseTo(0.1);
    expect(computeIngredientSatietyContribution(300, factor!)).toBe(30);
  });

  it("convertit Quantité via grammes/unité (indice déjà au 100 g)", () => {
    // 2 × 50 g → facteur 1 (pas count=2, qui gonflait densite × 100/U)
    expect(computeSatietyPortionFactor(0, 2, { basisLabel: "Quantité", unitGrams: 50 })).toBeCloseTo(1);
    expect(computeIngredientSatietyContribution(120, 1)).toBe(120);
  });

  it("convertit les unités en grammes quand la base est 100 g + poids/unité", () => {
    expect(
      computeSatietyPortionFactor(0, 2, { basisLabel: "100g", unitGrams: 50 }),
    ).toBeCloseTo(1);
  });

  it("retourne null si unités sans poids/unité (Quantité ou 100 g)", () => {
    expect(computeSatietyPortionFactor(0, 2, { basisLabel: "100g" })).toBeNull();
    expect(computeSatietyPortionFactor(0, 4, { basisLabel: "Quantité" })).toBeNull();
  });
});

describe("getMealRecipeSatietyIndex", () => {
  it("somme les contributions proportionnelles aux grammes de la recette", () => {
    const potatoIndex = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(potatoIndex).not.toBeNull();

    const total = getMealRecipeSatietyIndex(
      "10g Pomme de terre{82}[2]<2>, Sel",
      {
        foodItems: [
          {
            id: "1",
            name: "Pomme de terre",
            grams: "100",
            calories: "82",
            protein: "2",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: null,
            food_type: "feculent",
          },
        ],
      },
    );

    // Satiété totale : courbe (Σ + α×volume) avec 10 g
    expect(total).toBe(expectedMealSatietyFromContributions(potatoIndex! * 0.1));
  });

  it("prend la première alternative non optionnelle d'un groupe « ou »", () => {
    const firstIndex = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    const secondIndex = getIngredientSatietyIndex("131", "5", "3", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(firstIndex).not.toBeNull();
    expect(secondIndex).not.toBeNull();

    const total = getMealRecipeSatietyIndex(
      "100g Pomme de terre{82}[2]<2> | 100g Pates{131}[5]<3>",
      {
        foodItems: [
          {
            id: "1",
            name: "Pomme de terre",
            grams: null,
            calories: "82",
            protein: "2",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: null,
            food_type: "feculent",
          },
          {
            id: "2",
            name: "Pates",
            grams: null,
            calories: "131",
            protein: "5",
            fiber: "3",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 1,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: null,
            food_type: "feculent",
          },
        ],
      },
    );

    // 100 g d'une seule alt. → courbe saturante de (indice × 1, 100 g)
    expect(total).toBe(expectedMealSatietyFromContributions(firstIndex!));
    expect(total).not.toBe(secondIndex);
  });

  it("retourne null sans ingrédients exploitables", () => {
    expect(getMealRecipeSatietyIndex("Sel, Poivre")).toBeNull();
    expect(getMealRecipeSatietyIndex(null)).toBeNull();
  });

  it("Hachis : lignes en grammes restent en base 100 g malgré un stock Aliments en Quantité sans grammes/unité", () => {
    const potatoIndex = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    const beefIndex = getIngredientSatietyIndex("200", "20", "0", {
      basisLabel: "100g",
      foodType: "viande",
    });
    expect(potatoIndex).not.toBeNull();
    expect(beefIndex).not.toBeNull();

    const total = getMealRecipeSatietyIndex(
      "400g Pomme de terre{82}[2]<2>, 200g Boeuf hache{200}[20]<0>",
      {
        foodItems: [
          {
            id: "1",
            name: "Pomme de terre",
            grams: null,
            calories: "82",
            protein: "2",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: 1,
            food_type: "feculent",
          },
          {
            id: "2",
            name: "Boeuf hache",
            grams: null,
            calories: "200",
            protein: "20",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 1,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: 2,
            food_type: "viande",
          },
        ],
      },
    );

    // Σ contributions = 4×pdt + 2×boeuf, volume 600 g → courbe saturante
    const raw = potatoIndex! * 4 + beefIndex! * 2;
    expect(total).toBe(expectedMealSatietyFromContributions(raw));
    expect(total).not.toBeNull();
    expect(total!).toBeGreaterThan(100);
  });

  it("Hachis sans macros inline : résout via fiches Aliments (stock Quantité) pour lignes en grammes", () => {
    const total = getMealRecipeSatietyIndex("400g Pomme de terre, 200g Boeuf hache", {
      foodItems: [
        {
          id: "1",
          name: "Pomme de terre",
          grams: null,
          calories: "82",
          protein: "2",
          fiber: "2",
          expiration_date: null,
          counter_start_date: null,
          sort_order: 0,
          created_at: "",
          is_meal: false,
          is_infinite: false,
          is_dry: false,
          is_indivisible: false,
          no_counter: false,
          storage_type: "sec",
          quantity: 1,
          food_type: "feculent",
        },
        {
          id: "2",
          name: "Boeuf hache",
          grams: null,
          calories: "200",
          protein: "20",
          fiber: "0",
          expiration_date: null,
          counter_start_date: null,
          sort_order: 1,
          created_at: "",
          is_meal: false,
          is_infinite: false,
          is_dry: false,
          is_indivisible: false,
          no_counter: false,
          storage_type: "frais",
          quantity: 2,
          food_type: "viande",
        },
      ],
    });

    expect(total).not.toBeNull();
    expect(total!).toBeGreaterThan(0);
  });

  it("Hachis-like : total non null même si isAvailable=false (catalogue ≠ stock)", () => {
    const total = getMealRecipeSatietyIndex(
      "400g Pommes de terre, 200g Boeuf hache",
      {
        foodItems: [
          {
            id: "1",
            name: "Pomme de terre",
            grams: null,
            calories: "82",
            protein: "2",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: 1,
            food_type: "feculent",
          },
          {
            id: "2",
            name: "Boeuf hache",
            grams: null,
            calories: "200",
            protein: "20",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 1,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: 2,
            food_type: "viande",
          },
        ],
      },
      () => false,
    );

    expect(total).not.toBeNull();
    expect(total!).toBeGreaterThan(0);
  });

  it("Pizza : Base pizza (unité) + alts OU hors stock contribuent si macros connues", () => {
    const baseIndex = getIngredientSatietyIndex("250", "8", "2", {
      basisLabel: "Quantité",
      unitGrams: 280,
      foodType: "feculent",
    });
    const chickenIndex = getIngredientSatietyIndex("110", "23", "0", {
      basisLabel: "100g",
      foodType: "viande",
    });
    const cheeseIndex = getIngredientSatietyIndex("400", "27", "0", {
      basisLabel: "100g",
      foodType: null,
    });
    expect(baseIndex).not.toBeNull();
    expect(chickenIndex).not.toBeNull();
    expect(cheeseIndex).not.toBeNull();

    // Première alt. OU sans macros / hors stock → bascule sur Mozzarella avec macros.
    const total = getMealRecipeSatietyIndex(
      "1 Base pizza, 75g Des de poulet, 100g Emmental | 35g Gruyere",
      {
        foodItems: [
          {
            id: "1",
            name: "Base pizza",
            grams: "280",
            calories: "250",
            protein: "8",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: 2,
            food_type: "feculent",
          },
          {
            id: "2",
            name: "Des de poulet",
            grams: null,
            calories: "110",
            protein: "23",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 1,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: null,
            food_type: "viande",
          },
          {
            id: "3",
            name: "Gruyere",
            grams: null,
            calories: "400",
            protein: "27",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 2,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: null,
            food_type: null,
          },
        ],
      },
      () => false,
    );

    // Contribution base = indice × (280/100) ; total = courbe (Σ, volume)
    const raw = baseIndex! * 2.8 + chickenIndex! * 0.75 + cheeseIndex! * 0.35;
    const volumeGrams = 280 + 75 + 35;
    const expected = expectedMealSatietyFromContributions(raw);
    expect(total).toBe(expected);
    expect(total).toBeGreaterThan(0);
  });

  it("Oeufs au plat : total = courbe(1,5×indice_oeuf + indice_pâtes, 250 g)", () => {
    const eggIndex = getIngredientSatietyIndex("65", "5", "0", {
      basisLabel: "Quantité",
      unitGrams: 50,
      foodType: "viande",
    });
    const pastaIndex = getIngredientSatietyIndex("347", "13", "8", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(eggIndex).not.toBeNull();
    expect(pastaIndex).not.toBeNull();

    // Cas bug : fiche Oeuf en Quantité sans grams, poids/unité uniquement en prefs Macro
    const total = getMealRecipeSatietyIndex("3 Oeufs, 100g Pâtes", {
      foodItems: [
        {
          id: "1",
          name: "Oeuf",
          grams: null,
          calories: "65",
          protein: "5",
          fiber: "0",
          expiration_date: null,
          counter_start_date: null,
          sort_order: 0,
          created_at: "",
          is_meal: false,
          is_infinite: false,
          is_dry: false,
          is_indivisible: false,
          no_counter: false,
          storage_type: "sec",
          quantity: 12,
          food_type: "viande",
        },
        {
          id: "2",
          name: "Pâtes",
          grams: null,
          calories: "347",
          protein: "13",
          fiber: "8",
          expiration_date: null,
          counter_start_date: null,
          sort_order: 1,
          created_at: "",
          is_meal: false,
          is_infinite: false,
          is_dry: false,
          is_indivisible: false,
          no_counter: false,
          storage_type: "sec",
          quantity: null,
          food_type: "feculent",
        },
      ],
      unitGramsByKey: { oeuf: 50 },
    });

    // Facteur œufs = 150/100 = 1,5 (pas ×3) ; volume = 150 + 100 = 250 g
    const expected = expectedMealSatietyFromContributions(eggIndex! * 1.5 + pastaIndex!);
    expect(total).toBe(expected);
    expect(total!).toBeGreaterThan(0);
  });

  it("Avant grimpe vs Pain+Fuet : +50 g pain augmente l'indice (pas de dilution)", () => {
    const avantGrimpe = getMealRecipeSatietyIndex(
      "50g Fuet{450}[25]<0>, 100g Pain{265}[9]<2.5>",
    );
    const painPlusFuet = getMealRecipeSatietyIndex(
      "50g Fuet{450}[25]<0>, 150g Pain{265}[9]<2.5>",
    );
    const fuetContrib = getIngredientSatietyIndex("450", "25", "0")! * 0.5;
    const pain100 = getIngredientSatietyIndex("265", "9", "2.5")! * 1;
    const pain150 = getIngredientSatietyIndex("265", "9", "2.5")! * 1.5;

    expect(avantGrimpe).toBe(expectedMealSatietyFromContributions(fuetContrib + pain100));
    expect(painPlusFuet).toBe(expectedMealSatietyFromContributions(fuetContrib + pain150));
    expect(painPlusFuet!).toBeGreaterThan(avantGrimpe!);
    expect(avantGrimpe!).toBeGreaterThanOrEqual(70);
    expect(painPlusFuet!).toBeGreaterThan(avantGrimpe!);
  });

  it("Hachis (400 g pdt + 200 g bœuf) : somme pondérée sans plafond", () => {
    const potatoIndex = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    })!;
    const beefIndex = getIngredientSatietyIndex("200", "20", "0", {
      basisLabel: "100g",
      foodType: "viande",
    })!;
    const foodItems = [
      {
        id: "1",
        name: "Pomme de terre",
        grams: null,
        calories: "82",
        protein: "2",
        fiber: "2",
        expiration_date: null,
        counter_start_date: null,
        sort_order: 0,
        created_at: "",
        is_meal: false,
        is_infinite: false,
        is_dry: false,
        is_indivisible: false,
        no_counter: false,
        storage_type: "sec" as const,
        quantity: null,
        food_type: "feculent" as const,
      },
      {
        id: "2",
        name: "Boeuf hache",
        grams: null,
        calories: "200",
        protein: "20",
        fiber: "0",
        expiration_date: null,
        counter_start_date: null,
        sort_order: 1,
        created_at: "",
        is_meal: false,
        is_infinite: false,
        is_dry: false,
        is_indivisible: false,
        no_counter: false,
        storage_type: "frais" as const,
        quantity: null,
        food_type: "viande" as const,
      },
    ];
    const hachis = getMealRecipeSatietyIndex(
      "400g Pomme de terre{82}[2]<2>, 200g Boeuf hache{200}[20]<0>",
      { foodItems },
    );
    const expected = expectedMealSatietyFromContributions(potatoIndex * 4 + beefIndex * 2);
    expect(hachis).toBe(expected);
    expect(hachis!).toBeGreaterThan(100);
  });

  it("Croque-like : 4 Pain de mie (unités) + grammes, optionnels exclus", () => {
    const details = getMealRecipeSatietyDetails(
      "4 Pain de mie, 2 Blanc de dinde, 40g Gruyère, ?30g Chorizo, ?25g Fuet",
      {
        foodItems: [
          {
            id: "1",
            name: "Pain de mie",
            grams: "40",
            calories: "265",
            protein: "9",
            fiber: "2.5",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: 8,
            food_type: "feculent",
          },
          {
            id: "2",
            name: "Blanc de dinde",
            grams: "20",
            calories: "105",
            protein: "22",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 1,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: 4,
            food_type: "viande",
          },
          {
            id: "3",
            name: "Gruyère",
            grams: null,
            calories: "400",
            protein: "27",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 2,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: null,
            food_type: null,
          },
          {
            id: "4",
            name: "Chorizo",
            grams: null,
            calories: "450",
            protein: "25",
            fiber: "0",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 3,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "frais",
            quantity: null,
            food_type: "viande",
          },
        ],
      },
    );

    expect(details).not.toBeNull();
    // 4×40 + 2×20 + 40 = 240 g (Chorizo/Fuet optionnels exclus)
    expect(details!.totalGrams).toBe(240);
    expect(details!.index).toBeGreaterThan(0);

    // Sans poids/unité → Pain de mie ne doit pas gonfler via count seul
    expect(
      getMealRecipeSatietyIndex("4 Pain de mie, 40g Gruyère{400}[27]<0>", {
        foodItems: [
          {
            id: "1",
            name: "Pain de mie",
            grams: null,
            calories: "265",
            protein: "9",
            fiber: "2.5",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: 8,
            food_type: "feculent",
          },
        ],
      }),
    ).toBe(expectedMealSatietyFromContributions(getIngredientSatietyIndex("400", "27", "0")! * 0.4));
  });
});

describe("normalizeMealRecipeSatietyTotal / normalizeSatietyIndexPer100g / clampMealSatietyIndex", () => {
  it("retourne la somme pondérée arrondie, sans plafond", () => {
    expect(normalizeMealRecipeSatietyTotal(0)).toBe(0);
    expect(normalizeMealRecipeSatietyTotal(81.5)).toBe(82);
    expect(normalizeMealRecipeSatietyTotal(104.5)).toBe(105);
    expect(normalizeMealRecipeSatietyTotal(186)).toBe(186);
    expect(normalizeMealRecipeSatietyTotal(532)).toBe(532);
  });

  it("est monotone : plus de contribution → indice ≥", () => {
    const a = normalizeMealRecipeSatietyTotal(81.5)!;
    const b = normalizeMealRecipeSatietyTotal(104.5)!;
    expect(b).toBeGreaterThan(a);
  });

  it("ancienne densite / 100 g encore disponible (compat)", () => {
    expect(normalizeSatietyIndexPer100g(156, 150)).toBe(100);
    expect(normalizeSatietyIndexPer100g(120, 200)).toBe(60);
  });

  it("clampMealSatietyIndex clamp dans [0, 100]", () => {
    expect(clampMealSatietyIndex(220)).toBe(100);
    expect(clampMealSatietyIndex(-3)).toBe(0);
    expect(clampMealSatietyIndex(72.4)).toBe(72);
  });
});

describe("formatMealSatietyIndexTooltip", () => {
  it("inclut le volume en grammes quand fourni", () => {
    expect(formatMealSatietyIndexTooltip(105, 200)).toBe(
      "Satiété de la recette : 105 · Volume : 200 g",
    );
  });

  it("reste lisible sans volume", () => {
    expect(formatMealSatietyIndexTooltip(72)).toBe("Satiété Meals Cards (recette) : 72");
  });
});

describe("getMealSatietyIndex (repli macros fiche)", () => {
  it("Kebab ~350 g (macros fiche) → somme pondérée sans courbe", () => {
    const base = estimateMealsCardsSatietyIndex(200, 10, 1);
    expect(base).toBe(53);

    const index = estimateMealsCardsSatietyIndexFromMealMacros(
      "700",
      "35",
      "3.5",
      "350g",
    );
    expect(index).toBe(expectedMealSatietyFromContributions(base * 3.5));
    expect(index).toBe(186);

    const viaMeal = getMealSatietyIndex({
      name: "Kebab (2 viandes)",
      ingredients: null,
      calories: "700",
      protein: "35",
      fiber: "3.5",
      grams: "350g",
    });
    expect(viaMeal).toBe(index);
  });

  it("Tacos ~454 g (macros fiche) → somme pondérée sans courbe", () => {
    expect(normalizeMealRecipeSatietyTotal(182)).toBe(182);

    const base = estimateMealsCardsSatietyIndex(250, 8, 1);
    expect(base).toBe(40);
    const fromMacros = estimateMealsCardsSatietyIndexFromMealMacros(
      String(250 * 4.54),
      String(8 * 4.54),
      String(1 * 4.54),
      "454g",
    );
    expect(fromMacros).toBe(expectedMealSatietyFromContributions(base * 4.54));
  });

  it("snack Avant grimpe clairement sous kebab ~350 g", () => {
    const snack = getMealRecipeSatietyIndex(
      "50g Fuet{450}[25]<0>, 100g Pain{265}[9]<2.5>",
    );
    const kebab = estimateMealsCardsSatietyIndexFromMealMacros(
      "700",
      "35",
      "3.5",
      "350g",
    );
    expect(snack).not.toBeNull();
    expect(kebab).not.toBeNull();
    expect(snack!).toBeLessThan(kebab!);
  });

  it("repas avec ingrédients non résolus + macros fiche → satiété non null (fallback)", () => {
    const fallback = estimateMealsCardsSatietyIndexFromMealMacros("600", "35", "8");
    expect(fallback).not.toBeNull();

    const index = getMealSatietyIndex({
      name: "Hachis parmentier",
      ingredients: "400g Pomme de terre inconnue, 200g Boeuf mystere",
      calories: "600",
      protein: "35",
      fiber: "8",
    });

    expect(index).toBe(fallback);
    expect(getMealRecipeSatietyIndex("400g Pomme de terre inconnue, 200g Boeuf mystere")).toBeNull();
  });

  it("repas avec ingrédients résolus → satiété totale recette (pas le fallback fiche)", () => {
    const potatoIndex = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(potatoIndex).not.toBeNull();

    // 10 g seuls → courbe (contribution = indice × 0,1, volume 10 g)
    const recipeTotal = expectedMealSatietyFromContributions(potatoIndex! * 0.1);
    const fallback = estimateMealsCardsSatietyIndexFromMealMacros("999", "99", "9");
    expect(fallback).not.toBe(recipeTotal);

    const index = getMealSatietyIndex(
      {
        name: "Pizza maison",
        ingredients: "10g Pomme de terre{82}[2]<2>",
        calories: "999",
        protein: "99",
        fiber: "9",
      },
      {
        foodItems: [
          {
            id: "1",
            name: "Pomme de terre",
            grams: "100",
            calories: "82",
            protein: "2",
            fiber: "2",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: false,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: null,
            food_type: "feculent",
          },
        ],
      },
    );

    expect(index).toBe(recipeTotal);
  });

  it("repas sans ingrédients ni macros → null", () => {
    expect(
      getMealSatietyIndex({
        name: "Repas vide",
        ingredients: null,
        calories: null,
        protein: null,
        fiber: null,
      }),
    ).toBeNull();
  });

  it("n'invente pas de fibre 0 si absente de la fiche", () => {
    expect(estimateMealsCardsSatietyIndexFromMealMacros("500", "40", null)).toBeNull();
    expect(estimateMealsCardsSatietyIndexFromMealMacros("500", "40", "")).toBeNull();
    expect(
      getMealSatietyIndex({
        name: "Sans fibres",
        ingredients: null,
        calories: "500",
        protein: "40",
        fiber: null,
      }),
    ).toBeNull();
  });

  it("repas nom seul : macros aliment homonyme (is_meal) avec contribution totale si grammes connus", () => {
    const expected = estimateMealsCardsSatietyIndexFromMealMacros("450", "25", "3", "200g");
    expect(expected).not.toBeNull();
    // Macros portion → courbe (indice_base × 200/100, volume 200 g)
    const base = estimateMealsCardsSatietyIndex(225, 12.5, 1.5);
    expect(expected).toBe(expectedMealSatietyFromContributions(base * 2));

    const index = getMealSatietyIndex(
      {
        name: "20 Nuggets McDo",
        ingredients: null,
        calories: null,
        protein: null,
        fiber: null,
      },
      {
        foodItems: [
          {
            id: "n1",
            name: "20 Nuggets McDo",
            grams: "200g",
            calories: "450",
            protein: "25",
            fiber: "3",
            expiration_date: null,
            counter_start_date: null,
            sort_order: 0,
            created_at: "",
            is_meal: true,
            is_infinite: false,
            is_dry: false,
            is_indivisible: false,
            no_counter: false,
            storage_type: "sec",
            quantity: 1,
            food_type: null,
          },
        ],
      },
    );

    expect(index).toBe(expected);
  });
});
