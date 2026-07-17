import { describe, it, expect } from "vitest";
import {
  formatCalorieGoalTarget,
  hasCalorieGoalRangeMin,
  normalizeCalorieGoalRange,
} from "./calorieGoalRange";

describe("normalizeCalorieGoalRange", () => {
  it("garde une fourchette valide telle quelle", () => {
    expect(normalizeCalorieGoalRange(2000, 2300)).toEqual({ low: 2000, high: 2300 });
  });

  it("ignore une borne basse absente ou <= 0", () => {
    expect(normalizeCalorieGoalRange(0, 2300)).toEqual({ low: null, high: 2300 });
    expect(normalizeCalorieGoalRange(null, 2300)).toEqual({ low: null, high: 2300 });
    expect(normalizeCalorieGoalRange(undefined, 2300)).toEqual({ low: null, high: 2300 });
  });

  it("échange les bornes quand la basse dépasse la haute", () => {
    expect(normalizeCalorieGoalRange(2500, 2300)).toEqual({ low: 2300, high: 2500 });
  });

  it("arrondit les valeurs décimales", () => {
    expect(normalizeCalorieGoalRange(1999.6, 2300.4)).toEqual({ low: 2000, high: 2300 });
  });

  it("gère une borne haute absente", () => {
    expect(normalizeCalorieGoalRange(2000, 0)).toEqual({ low: 2000, high: 0 });
  });
});

describe("formatCalorieGoalTarget", () => {
  it("affiche la fourchette basse–haute quand les deux bornes diffèrent", () => {
    expect(formatCalorieGoalTarget(2000, 2300)).toBe("2000\u20132300");
  });

  it("affiche uniquement la borne haute sans borne basse", () => {
    expect(formatCalorieGoalTarget(null, 2300)).toBe("2300");
    expect(formatCalorieGoalTarget(0, 2300)).toBe("2300");
  });

  it("affiche une seule valeur quand les bornes sont égales", () => {
    expect(formatCalorieGoalTarget(2300, 2300)).toBe("2300");
  });

  it("normalise l'ordre avant l'affichage", () => {
    expect(formatCalorieGoalTarget(2500, 2300)).toBe("2300\u20132500");
  });
});

describe("hasCalorieGoalRangeMin", () => {
  it("retourne true quand une borne basse distincte est renseignée", () => {
    expect(hasCalorieGoalRangeMin(2000, 2300)).toBe(true);
  });

  it("retourne false quand seule la borne haute est renseignée", () => {
    expect(hasCalorieGoalRangeMin(0, 2300)).toBe(false);
    expect(hasCalorieGoalRangeMin(null, 2300)).toBe(false);
  });

  it("retourne false quand les deux bornes sont identiques", () => {
    expect(hasCalorieGoalRangeMin(2300, 2300)).toBe(false);
  });
});
