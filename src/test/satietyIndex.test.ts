import { describe, expect, it } from "vitest";
import {
  computeHoltPortionGrams,
  estimateHoltSatietyIndex,
  getIngredientSatietyIndex,
  HOLT_ISO_CALORIE_PORTION_KCAL,
} from "@/lib/satietyIndex";

describe("computeHoltPortionGrams", () => {
  it("calcule ~293 g de pomme de terre pour 240 kcal à 82 kcal/100 g", () => {
    expect(computeHoltPortionGrams(82)).toBeCloseTo(292.7, 0);
  });

  it("calcule ~183 g de pâtes pour 240 kcal à 131 kcal/100 g", () => {
    expect(computeHoltPortionGrams(131)).toBeCloseTo(183.2, 0);
  });
});

describe("estimateHoltSatietyIndex", () => {
  it("approche les ancres Holt sur portion 240 kcal", () => {
    expect(estimateHoltSatietyIndex(77, 2, 2.5, "feculent")).toBeGreaterThanOrEqual(310);
    expect(estimateHoltSatietyIndex(265, 9, 2.5, null)).toBeGreaterThanOrEqual(85);
    expect(estimateHoltSatietyIndex(265, 9, 2.5, null)).toBeLessThanOrEqual(115);
    expect(estimateHoltSatietyIndex(131, 5, 3.2, "feculent")).toBeGreaterThanOrEqual(105);
    expect(estimateHoltSatietyIndex(131, 5, 3.2, "feculent")).toBeLessThanOrEqual(135);
    expect(estimateHoltSatietyIndex(120, 20, 0, "viande")).toBeGreaterThanOrEqual(200);
    expect(estimateHoltSatietyIndex(120, 20, 0, "viande")).toBeLessThanOrEqual(240);
  });

  it("pomme de terre utilisateur (82 kcal) proche de l'ancre Holt (~323)", () => {
    const index = estimateHoltSatietyIndex(82, 2, 2, "feculent");
    expect(index).toBeGreaterThanOrEqual(280);
    expect(index).toBeLessThanOrEqual(330);
  });
});

describe("getIngredientSatietyIndex", () => {
  it("utilise la portion Holt 240 kcal, pas le 100 g brut", () => {
    expect(HOLT_ISO_CALORIE_PORTION_KCAL).toBe(240);
    const potato = getIngredientSatietyIndex("82", "2", "2", {
      basisLabel: "100g",
      foodType: "feculent",
    });
    expect(potato).toBeGreaterThan(200);
    expect(potato).not.toBe(137);
  });

  it("favorise la grenaille Picard vs Patatoes Lidl (féculent, portion 240 kcal)", () => {
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
