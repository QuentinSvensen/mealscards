import { describe, expect, it } from "vitest";
import {
  filterBackupCardsForArchiveWeek,
  filterPossibleMealsForArchiveWeek,
} from "./filterArchiveWeekMeals";
import { filterBackupCardsForDisplayDay } from "./backupWeekAlignment";
import type { PossibleMealBackupCard } from "./types";

const week = [
  { key: "lundi" as const, iso: "2026-07-20", display: "LUNDI 20/07" },
  { key: "mardi" as const, iso: "2026-07-21", display: "MARDI 21/07" },
];

describe("filterArchiveWeekMeals", () => {
  it("ne garde que les cartes ISO de la semaine archivée", () => {
    const cards: PossibleMealBackupCard[] = [
      { id: "1", meal_id: "a", quantity: 1, expiration_date: null, day_of_week: "2026-07-20", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meal_name: "Poisson + Riz" },
      { id: "2", meal_id: "b", quantity: 1, expiration_date: null, day_of_week: "lundi", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meal_name: "Riz + Tenders" },
    ];
    const filtered = filterBackupCardsForArchiveWeek(cards, week, "2026-07-20", "2026-07-26");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].meal_name).toBe("Poisson + Riz");
  });

  it("filtre l’affichage jour par ISO avant la clé jour", () => {
    const cards: PossibleMealBackupCard[] = [
      { id: "1", meal_id: "a", quantity: 1, expiration_date: null, day_of_week: "2026-07-20", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meal_name: "Poisson + Riz" },
      { id: "2", meal_id: "b", quantity: 1, expiration_date: null, day_of_week: "lundi", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meal_name: "Riz + Tenders" },
    ];
    const dayCards = filterBackupCardsForDisplayDay(cards, "2026-07-20", "lundi", "2026-07-20");
    expect(dayCards).toHaveLength(1);
    expect(dayCards[0].meal_name).toBe("Poisson + Riz");
  });

  it("filtre les possible meals pour l’archivage", () => {
    const meals = [
      { id: "1", day_of_week: "2026-07-20", meal_time: "midi" },
      { id: "2", day_of_week: "lundi", meal_time: "midi" },
    ] as any[];
    const filtered = filterPossibleMealsForArchiveWeek(meals, week);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });
});
