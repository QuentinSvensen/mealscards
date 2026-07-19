import { describe, it, expect } from "vitest";
import {
  CALORIE_GOAL_VIRTUAL_LOW_OFFSET,
  extraFitsRemainingCalories,
  formatCalorieGoalTarget,
  getCalorieRangeTotalColorClass,
  getRemainingDayCalories,
  hasCalorieGoalRangeMin,
  normalizeCalorieGoalRange,
  resolveCalorieGoalRangeForColoring,
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

  it("affiche uniquement la borne haute sans borne basse (pas de min virtuel à l'affichage)", () => {
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

describe("resolveCalorieGoalRangeForColoring", () => {
  it("conserve une fourchette min–max réelle", () => {
    expect(resolveCalorieGoalRangeForColoring(2000, 2300)).toEqual({ low: 2000, high: 2300 });
  });

  it("fabrique [max − 100, max] quand seul le max est renseigné", () => {
    expect(resolveCalorieGoalRangeForColoring(null, 2300)).toEqual({
      low: 2300 - CALORIE_GOAL_VIRTUAL_LOW_OFFSET,
      high: 2300,
    });
    expect(resolveCalorieGoalRangeForColoring(0, 2300)).toEqual({ low: 2200, high: 2300 });
  });

  it("retourne null si le max est trop bas pour un intervalle utile", () => {
    expect(resolveCalorieGoalRangeForColoring(null, 50)).toBeNull();
    expect(resolveCalorieGoalRangeForColoring(null, 0)).toBeNull();
  });
});

describe("hasCalorieGoalRangeMin", () => {
  it("retourne true quand une borne basse distincte est renseignée", () => {
    expect(hasCalorieGoalRangeMin(2000, 2300)).toBe(true);
  });

  it("retourne true quand seule la borne haute est renseignée (fourchette virtuelle)", () => {
    expect(hasCalorieGoalRangeMin(0, 2300)).toBe(true);
    expect(hasCalorieGoalRangeMin(null, 2300)).toBe(true);
  });

  it("retourne true aussi quand les deux bornes saisies sont identiques (max seul → virtuel)", () => {
    expect(hasCalorieGoalRangeMin(2300, 2300)).toBe(true);
  });
});

describe("getCalorieRangeTotalColorClass", () => {
  it("avec max seul : vert dans [max−100, max], rouge au-dessus, null en dessous", () => {
    expect(getCalorieRangeTotalColorClass(2250, 0, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2200, null, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2300, 0, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2400, 0, 2300)).toBe("text-red-400");
    expect(getCalorieRangeTotalColorClass(2199, 0, 2300)).toBeNull();
  });

  it("vert dans la fourchette réelle, rouge au-dessus, null en dessous", () => {
    expect(getCalorieRangeTotalColorClass(2132, 2000, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2000, 2000, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2300, 2000, 2300)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(2400, 2000, 2300)).toBe("text-red-400");
    expect(getCalorieRangeTotalColorClass(1900, 2000, 2300)).toBeNull();
  });

  it("applique dayScale sur la fourchette journalière (total semaine)", () => {
    // Max seul 2300 → virtuel 2200–2300 × 7 = 15400–16100
    expect(getCalorieRangeTotalColorClass(15500, 0, 2300, 7)).toBe("text-emerald-500");
    expect(getCalorieRangeTotalColorClass(16200, 0, 2300, 7)).toBe("text-red-400");
    expect(getCalorieRangeTotalColorClass(15000, 0, 2300, 7)).toBeNull();
  });
});

describe("getRemainingDayCalories", () => {
  it("retourne max − déjà pris (planifié)", () => {
    expect(getRemainingDayCalories(2300, 2000)).toBe(300);
  });

  it("plafonne à 0 quand le jour dépasse l'objectif", () => {
    expect(getRemainingDayCalories(2300, 2500)).toBe(0);
  });

  it("tolère des entrées non numériques", () => {
    expect(getRemainingDayCalories(Number.NaN, 100)).toBe(0);
    expect(getRemainingDayCalories(2000, Number.NaN)).toBe(2000);
  });
});

describe("extraFitsRemainingCalories", () => {
  it("accepte un extra qui tient dans le reste", () => {
    expect(extraFitsRemainingCalories(120, 150)).toBe(true);
    expect(extraFitsRemainingCalories(150, 150)).toBe(true);
  });

  it("refuse un extra qui dépasse le reste", () => {
    expect(extraFitsRemainingCalories(151, 150)).toBe(false);
    expect(extraFitsRemainingCalories(10, 0)).toBe(false);
  });
});
