import { describe, expect, it } from "vitest";
import {
  cycleMacroSortMode,
  cycleMacroFoodTypeFilter,
  compareMacroIngredientEntries,
  formatMacroBasisBadgeLabel,
  formatUnitGramsNoteTooltip,
  parseUnitGramsInput,
  upsertIngredientMacroUnitGrams,
} from "@/components/MacroIngredients";
import type { IngredientMacroEntry } from "@/domain/macros/ingredientMacroDatabase";
import {
  getIngredientMacroNutritionScore,
  getIngredientMacroNutritionScoreRaw,
} from "@/lib/nutritionScore";

/** Construit une entrée Macro minimale pour les tests de tri. */
function makeEntry(
  key: string,
  displayName: string,
  calories: string,
  protein = "10",
  fiber = "0",
  basisLabel: string | null = "100g",
): IngredientMacroEntry {
  return {
    key,
    displayName,
    basisLabel,
    calories,
    protein,
    fiber,
    recipeCount: 1,
    foodCount: 0,
    overrideCount: 0,
    recipeNames: [],
    hasConflictingCalories: false,
    hasConflictingProtein: false,
    hasConflictingFiber: false,
  };
}

describe("MacroIngredients sort", () => {
  it("cycle Nom → Note → Calories → Protéines → Nom", () => {
    expect(cycleMacroSortMode("name")).toBe("note");
    expect(cycleMacroSortMode("note")).toBe("calories");
    expect(cycleMacroSortMode("calories")).toBe("protein");
    expect(cycleMacroSortMode("protein")).toBe("name");
  });

  it("cycle filtre type Tous → Viande → Féculent → Tous", () => {
    expect(cycleMacroFoodTypeFilter("all")).toBe("viande");
    expect(cycleMacroFoodTypeFilter("viande")).toBe("feculent");
    expect(cycleMacroFoodTypeFilter("feculent")).toBe("all");
  });

  it("trie par nom croissant", () => {
    const a = makeEntry("b", "Banane", "100");
    const b = makeEntry("a", "Avocat", "200");
    expect(compareMacroIngredientEntries(a, b, {}, "name", true)).toBeGreaterThan(0);
    expect(compareMacroIngredientEntries(a, b, {}, "name", false)).toBeLessThan(0);
  });

  it("trie par calories croissant puis décroissant", () => {
    const low = makeEntry("l", "Léger", "100", "10", "0");
    const high = makeEntry("h", "Riche", "500", "10", "0");
    expect(compareMacroIngredientEntries(low, high, {}, "calories", true)).toBeLessThan(0);
    expect(compareMacroIngredientEntries(low, high, {}, "calories", false)).toBeGreaterThan(0);
  });

  it("trie par protéines croissant puis décroissant", () => {
    const low = makeEntry("l", "Faible", "200", "5", "0");
    const high = makeEntry("h", "Protéiné", "200", "40", "0");
    expect(compareMacroIngredientEntries(low, high, {}, "protein", true)).toBeLessThan(0);
    expect(compareMacroIngredientEntries(low, high, {}, "protein", false)).toBeGreaterThan(0);
  });

  it("trie par note et pousse les notes manquantes en fin", () => {
    // Densité protéique élevée → note haute
    const good = makeEntry("g", "Dinde", "100", "30", "0");
    const weak = makeEntry("w", "Huile", "900", "0", "0");
    const missing = makeEntry("m", "Inconnu", "", "", "");
    expect(compareMacroIngredientEntries(good, weak, {}, "note", false)).toBeLessThan(0);
    expect(compareMacroIngredientEntries(missing, good, {}, "note", true)).toBeGreaterThan(0);
  });

  it("trie par note raw quand deux macros affichent 100", () => {
    // densités 110 et 105 → badge 100, mais raw 110 > 105
    const better = makeEntry("better", "Meilleur", "500", "55", "0");
    const good = makeEntry("good", "Bon", "500", "52.5", "0");

    expect(getIngredientMacroNutritionScore(better.calories, better.protein, better.fiber)).toBe(100);
    expect(getIngredientMacroNutritionScore(good.calories, good.protein, good.fiber)).toBe(100);
    expect(getIngredientMacroNutritionScoreRaw(better.calories, better.protein, better.fiber)).toBe(110);
    expect(getIngredientMacroNutritionScoreRaw(good.calories, good.protein, good.fiber)).toBe(105);

    // Décroissant : meilleur (110) avant bon (105)
    expect(compareMacroIngredientEntries(better, good, {}, "note", false)).toBeLessThan(0);
    // Croissant : bon (105) avant meilleur (110)
    expect(compareMacroIngredientEntries(better, good, {}, "note", true)).toBeGreaterThan(0);
  });
});

describe("Macro Quantité — grammes par unité", () => {
  it("parseUnitGramsInput accepte nombre positif et virgule", () => {
    expect(parseUnitGramsInput("80")).toBe(80);
    expect(parseUnitGramsInput("80,5")).toBe(80.5);
    expect(parseUnitGramsInput("")).toBeNull();
    expect(parseUnitGramsInput("0")).toBeNull();
    expect(parseUnitGramsInput("-10")).toBeNull();
    expect(parseUnitGramsInput("abc")).toBeNull();
  });

  it("formatMacroBasisBadgeLabel garde « Quantité » (grammes note non affichés sur le badge)", () => {
    expect(formatMacroBasisBadgeLabel("Quantité", 80)).toBe("Quantité");
    expect(formatMacroBasisBadgeLabel("Quantité", null)).toBe("Quantité");
    expect(formatMacroBasisBadgeLabel("100g", 80)).toBe("100g");
  });

  it("formatUnitGramsNoteTooltip reste court", () => {
    expect(formatUnitGramsNoteTooltip("Vacherin", null)).toBe("Indiquer le poids d'une unité");
    expect(formatUnitGramsNoteTooltip("Vacherin", 80)).toBe("Poids d'une unité : 80 g");
  });

  it("upsertIngredientMacroUnitGrams ajoute et retire une clé", () => {
    const withGrams = upsertIngredientMacroUnitGrams({}, "vacherin", 80);
    expect(withGrams).toEqual({ vacherin: 80 });
    expect(upsertIngredientMacroUnitGrams(withGrams, "vacherin", null)).toEqual({});
  });
});
