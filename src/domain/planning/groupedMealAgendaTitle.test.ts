import { describe, expect, it } from "vitest";
import {
  formatGroupedMealAgendaTitle,
  sortMealsForAgendaTitle,
} from "./groupedMealAgendaTitle";

describe("sortMealsForAgendaTitle", () => {
  it("suit l’ordre Planning (sort_order = carte du haut en premier)", () => {
    const ordered = sortMealsForAgendaTitle([
      { id: "b", sort_order: 1, meals: { name: "Pot #4", category: "dessert" } },
      { id: "a", sort_order: 0, meals: { name: "Hachis parmentier", category: "plat" } },
    ]);
    expect(ordered.map((m) => m.meals?.name)).toEqual([
      "Hachis parmentier",
      "Pot #4",
    ]);
  });
});

describe("formatGroupedMealAgendaTitle", () => {
  it("combine les titres avec l’emoji de la carte du haut", () => {
    expect(
      formatGroupedMealAgendaTitle([
        { id: "a", sort_order: 0, meals: { name: "Hachis parmentier", category: "plat" } },
        { id: "b", sort_order: 1, meals: { name: "Pot #4", category: "dessert" } },
      ]),
    ).toBe("🍽️ Hachis parmentier, Pot #4");
  });

  it("conserve l’ordre sort_order entre desserts", () => {
    expect(
      formatGroupedMealAgendaTitle([
        { id: "1", sort_order: 0, meals: { name: "Pot #1", category: "dessert" } },
        { id: "2", sort_order: 1, meals: { name: "Pot #2", category: "dessert" } },
        { id: "4", sort_order: 2, meals: { name: "Pot #4", category: "dessert" } },
      ]),
    ).toBe("🍰 Pot #1, Pot #2, Pot #4");
  });
});
