import { describe, expect, it } from "vitest";
import { getExtraMacroMode, getExtraMacroReferenceMacros, getExtraPortionMacros, getExtraStoredMacrosFromReference, hasNonZeroMacro, parseFoodMacroValue } from "./extraMacroUtils";

describe("parseFoodMacroValue", () => {
  it("conserve le signe moins (ajustement Négatif en base)", () => {
    expect(parseFoodMacroValue("-316")).toBe(-316);
    expect(parseFoodMacroValue("-11")).toBe(-11);
    expect(parseFoodMacroValue("-316 kcal")).toBe(-316);
    expect(parseFoodMacroValue("−11")).toBe(-11); // minus typographique U+2212
  });

  it("parse les positifs et ignore le texte parasite", () => {
    expect(parseFoodMacroValue("350 kcal")).toBe(350);
    expect(parseFoodMacroValue("2,1")).toBe(2.1);
    expect(parseFoodMacroValue("")).toBe(0);
  });

  it("hasNonZeroMacro accepte les négatifs", () => {
    expect(hasNonZeroMacro(-316)).toBe(true);
    expect(hasNonZeroMacro(0)).toBe(false);
    expect(hasNonZeroMacro(11)).toBe(true);
  });
});

describe("extraMacroUtils", () => {
  it("calcule la portion extra depuis des macros au 100g quand un grammage est présent", () => {
    expect(getExtraMacroMode({ grams: "30", quantity: null })).toBe("per100g");
    expect(getExtraPortionMacros({ grams: "30", quantity: null, calories: "110", protein: "10", fiber: "6" })).toEqual({
      cal: 33,
      pro: 3,
      fiber: 2,
    });
  });

  it("garde les macros extras au 100g comme référence pour l'onglet Macro", () => {
    expect(getExtraMacroReferenceMacros({
      storage_type: "extras",
      grams: "30g",
      quantity: null,
      calories: "110",
      protein: "10",
      fiber: "6",
    })).toEqual({
      cal: "110",
      pro: "10",
      fiber: "6",
    });
    expect(getExtraStoredMacrosFromReference(
      { storage_type: "extras", grams: "30", quantity: null },
      "110",
      "10",
      "6",
    )).toEqual({
      calories: "110",
      protein: "10",
      fiber: "6",
    });
  });

  it("utilise la valeur brute comme macro par quantité quand aucune valeur en grammes n'existe", () => {
    expect(getExtraMacroMode({ grams: null, quantity: 3 })).toBe("perQuantity");
    expect(getExtraPortionMacros({ grams: null, quantity: 3, calories: "62.4", protein: "4.6", fiber: "1.2" })).toEqual({
      cal: 187,
      pro: 14,
      fiber: 4,
    });
    expect(
      getExtraPortionMacros({ grams: null, quantity: 3, calories: "62.4", protein: "4.6", fiber: "1.2" }, { perUnit: true }),
    ).toEqual({
      cal: 62,
      pro: 5,
      fiber: 1,
    });
  });

  it("utilise la valeur brute pour le produit complet sans grammes ni quantité", () => {
    expect(getExtraMacroMode({ grams: null, quantity: null })).toBe("wholeProduct");
    expect(getExtraPortionMacros({ grams: null, quantity: null, calories: "244", protein: "8", fiber: "5" })).toEqual({
      cal: 244,
      pro: 8,
      fiber: 5,
    });
  });
});
