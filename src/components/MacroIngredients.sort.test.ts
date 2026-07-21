import { describe, expect, it } from "vitest";
import {
  cycleMacroSortMode,
  cycleMacroFoodTypeFilter,
  compareMacroIngredientEntries,
} from "@/components/MacroIngredients";
import type { IngredientMacroEntry } from "@/domain/macros/ingredientMacroDatabase";

/** Construit une entrée Macro minimale pour les tests de tri. */
function makeEntry(
  key: string,
  displayName: string,
  calories: string,
  protein = "10",
  fiber = "0",
): IngredientMacroEntry {
  return {
    key,
    displayName,
    basisLabel: "100g",
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
});
