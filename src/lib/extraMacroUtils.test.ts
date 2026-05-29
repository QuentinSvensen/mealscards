import { describe, expect, it } from "vitest";
import { getExtraMacroMode, getExtraMacroReferenceMacros, getExtraPortionMacros, getExtraStoredMacrosFromReference } from "./extraMacroUtils";

describe("extraMacroUtils", () => {
  it("calcule la portion extra depuis des macros au 100g quand un grammage est présent", () => {
    expect(getExtraMacroMode({ grams: "30", quantity: null })).toBe("per100g");
    expect(getExtraPortionMacros({ grams: "30", quantity: null, calories: "110", protein: "10" })).toEqual({
      cal: 33,
      pro: 3,
    });
  });

  it("garde les macros extras au 100g comme référence pour l'onglet Macro", () => {
    expect(getExtraMacroReferenceMacros({
      storage_type: "extras",
      grams: "30g",
      quantity: null,
      calories: "110",
      protein: "10",
    })).toEqual({
      cal: "110",
      pro: "10",
    });
    expect(getExtraStoredMacrosFromReference(
      { storage_type: "extras", grams: "30", quantity: null },
      "110",
      "10",
    )).toEqual({
      calories: "110",
      protein: "10",
    });
  });

  it("utilise la valeur brute comme macro par quantité quand aucune valeur en grammes n'existe", () => {
    expect(getExtraMacroMode({ grams: null, quantity: 3 })).toBe("perQuantity");
    expect(getExtraPortionMacros({ grams: null, quantity: 3, calories: "62.4", protein: "4.6" })).toEqual({
      cal: 187,
      pro: 14,
    });
  });

  it("utilise la valeur brute pour le produit complet sans grammes ni quantité", () => {
    expect(getExtraMacroMode({ grams: null, quantity: null })).toBe("wholeProduct");
    expect(getExtraPortionMacros({ grams: null, quantity: null, calories: "244", protein: "8" })).toEqual({
      cal: 244,
      pro: 8,
    });
  });
});
