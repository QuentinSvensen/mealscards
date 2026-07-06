import { describe, it, expect } from "vitest";
import {
  buildBackupBreakfastBreakdownItems,
  isBackupBreakfastPmAlreadyInMatinSlot,
} from "./breakfastBreakdown";
import type { PossibleMealBackupCard } from "./types";

describe("breakfastBreakdown", () => {
  const matinCard: PossibleMealBackupCard = {
    id: "pm-1",
    meal_id: "meal-1",
    quantity: 1,
    expiration_date: null,
    day_of_week: "2026-06-29",
    meal_time: "matin",
    counter_start_date: null,
    sort_order: 0,
    ingredients_override: null,
  };

  it("détecte une carte pm déjà dans le créneau matin", () => {
    expect(isBackupBreakfastPmAlreadyInMatinSlot(matinCard, "2026-06-29", "lundi", [matinCard])).toBe(true);
  });

  it("n'ajoute pas deux fois la même carte pm dans le détail", () => {
    const items = buildBackupBreakfastBreakdownItems({
      key: "lundi",
      iso: "2026-06-29",
      matinCards: [matinCard],
      bfSel: "pm:pm-1",
      cards: [matinCard],
      breakfastManualCalories: {},
      breakfastManualProteins: {},
      calOverrides: {},
      proOverrides: {},
      matinAssignedIds: [],
      mealsById: new Map([
        [
          "meal-1",
          {
            id: "meal-1",
            name: "Cookie maison",
            category: "petit_dejeuner",
            calories: "400",
            protein: "38",
            grams: null,
            ingredients: null,
            sort_order: 0,
            created_at: "",
            is_available: true,
            is_favorite: false,
            oven_temp: null,
            oven_minutes: null,
          },
        ],
      ]),
      foodItems: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Cookie maison");
  });
});
