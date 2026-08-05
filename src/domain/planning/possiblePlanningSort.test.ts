import { describe, expect, it } from "vitest";
import {
  comparePossiblePlanningOrder,
  hasNumberedPotLabel,
  isUnnumberedPotLabel,
  prioritizeNumberedPotsAmongUnplanned,
} from "./possiblePlanningSort";

const fixedNow = new Date("2026-05-28T10:00:00.000Z");

/** Crée une carte minimale pour tester le tri Planning sans dépendre des données Supabase. */
function pm(
  name: string,
  day: string | null,
  time: string | null,
  sortOrder = 0,
) {
  return {
    day_of_week: day,
    meal_time: time,
    counter_start_date: null,
    sort_order: sortOrder,
    meals: { name },
  };
}

describe("hasNumberedPotLabel", () => {
  it("détecte un numéro après #", () => {
    expect(hasNumberedPotLabel("Pot #3")).toBe(true);
    expect(hasNumberedPotLabel("Pot # 12")).toBe(true);
    expect(hasNumberedPotLabel("Pot #?")).toBe(false);
    expect(hasNumberedPotLabel("Pot #")).toBe(false);
  });
});

describe("isUnnumberedPotLabel", () => {
  it("détecte Pot #? et Pot # sans chiffre", () => {
    expect(isUnnumberedPotLabel("Pot #?")).toBe(true);
    expect(isUnnumberedPotLabel("Pot #")).toBe(true);
    expect(isUnnumberedPotLabel("Pot #3")).toBe(false);
    expect(isUnnumberedPotLabel("Tarte")).toBe(false);
  });
});

describe("prioritizeNumberedPotsAmongUnplanned", () => {
  it("place les pots numérotés non planifiés au-dessus des #?", () => {
    const items = [
      pm("Pot #?", null, null, 0),
      pm("Pot #6", null, null, 1),
      pm("Pot #3", null, null, 2),
    ];
    const sorted = prioritizeNumberedPotsAmongUnplanned(items);
    expect(sorted.map((item) => item.meals.name)).toEqual(["Pot #6", "Pot #3", "Pot #?"]);
  });

  it("ne déplace pas les cartes planifiées", () => {
    const items = [
      pm("Pot #?", null, null, 0),
      pm("Planifié", "2026-05-28", "midi", 1),
      pm("Pot #3", null, null, 2),
    ];
    const sorted = prioritizeNumberedPotsAmongUnplanned(items);
    expect(sorted.map((item) => item.meals.name)).toEqual(["Pot #3", "Planifié", "Pot #?"]);
  });
});

describe("comparePossiblePlanningOrder", () => {
  it("place les cartes avec seulement le jour sous les cartes du même jour avec timing", () => {
    const items = [
      pm("Jour seul", "2026-05-28", null, 0),
      pm("Soir", "2026-05-28", "soir", 1),
      pm("Midi", "2026-05-28", "midi", 2),
    ];

    const sorted = [...items].sort((a, b) => comparePossiblePlanningOrder(a, b, fixedNow));

    expect(sorted.map((item) => item.meals.name)).toEqual(["Midi", "Soir", "Jour seul"]);
  });

  it("ordonne les créneaux matin → midi → goûter → soir", () => {
    const items = [
      pm("Soir", "2026-05-28", "soir", 0),
      pm("Goûter", "2026-05-28", "gouter", 1),
      pm("Midi", "2026-05-28", "midi", 2),
      pm("Matin", "2026-05-28", "matin", 3),
    ];

    const sorted = [...items].sort((a, b) => comparePossiblePlanningOrder(a, b, fixedNow));

    expect(sorted.map((item) => item.meals.name)).toEqual(["Matin", "Midi", "Goûter", "Soir"]);
  });

  it("garde une carte jour seul avant le jour suivant", () => {
    const items = [
      pm("Demain midi", "2026-05-29", "midi", 0),
      pm("Aujourd'hui sans timing", "2026-05-28", null, 1),
    ];

    const sorted = [...items].sort((a, b) => comparePossiblePlanningOrder(a, b, fixedNow));

    expect(sorted.map((item) => item.meals.name)).toEqual(["Aujourd'hui sans timing", "Demain midi"]);
  });

  it("parmi les non planifiés, place Pot #N avant Pot #?", () => {
    const items = [
      pm("Pot #?", null, null, 0),
      pm("Pot #3", null, null, 1),
    ];
    const sorted = [...items].sort((a, b) => comparePossiblePlanningOrder(a, b, fixedNow));
    expect(sorted.map((item) => item.meals.name)).toEqual(["Pot #3", "Pot #?"]);
  });
});
