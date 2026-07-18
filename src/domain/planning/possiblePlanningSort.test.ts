import { describe, expect, it } from "vitest";
import { comparePossiblePlanningOrder } from "./possiblePlanningSort";

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
});
