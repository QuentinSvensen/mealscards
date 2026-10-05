import { describe, expect, it } from "vitest";

import { construireExportEatcards, modeEatcards, nombreExport } from "@/domain/macros/exportEatcards";

describe("export Eatcards", () => {
  it("garde le 100 g et omet un type inconnu", () => {
    expect(modeEatcards("100g")).toBe("cent_grammes");
    expect(modeEatcards(null)).toBe("cent_grammes");
    const [ligne] = construireExportEatcards([
      {
        nom: "Baguette",
        basisLabel: "100g",
        calories: "244",
        protein: "8,5",
        poidsUniteG: null,
        typeAliment: null,
      },
    ]);
    expect(ligne).toEqual({
      nom: "Baguette",
      mode: "cent_grammes",
      kcal: 244,
      proteines: 8.5,
    });
    expect(ligne).not.toHaveProperty("type");
    expect(JSON.stringify(ligne)).not.toContain("fiber");
  });

  it("passe une quantité à l'unité avec son poids et son type", () => {
    expect(nombreExport("")).toBeNull();
    expect(nombreExport("abc")).toBeNull();
    const [ligne] = construireExportEatcards([
      {
        nom: " Blanc de dinde ",
        basisLabel: "Quantité",
        calories: "41",
        protein: "9",
        poidsUniteG: 40,
        typeAliment: "viande",
      },
    ]);
    expect(ligne).toEqual({
      nom: "Blanc de dinde",
      mode: "unite",
      kcal: 41,
      proteines: 9,
      poids_unite_g: 40,
      type: "viande",
    });
  });
});
