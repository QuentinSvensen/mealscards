import { describe, expect, it } from "vitest";
import {
  mergeRecoveredAndBackupCards,
  recoverPreviousWeekCardsFromLive,
} from "./recoverPreviousWeekCards";
import type { PossibleMealBackupCard } from "./types";

const week = [
  { key: "lundi" as const, iso: "2026-07-20", display: "LUNDI 20/07" },
  { key: "mardi" as const, iso: "2026-07-21", display: "MARDI 21/07" },
];

function card(
  id: string,
  dayOfWeek: string,
  mealName: string,
): PossibleMealBackupCard {
  return {
    id,
    meal_id: `m-${id}`,
    quantity: 1,
    expiration_date: null,
    day_of_week: dayOfWeek,
    meal_time: "midi",
    counter_start_date: null,
    sort_order: 0,
    ingredients_override: null,
    meal_name: mealName,
  };
}

describe("recoverPreviousWeekCards", () => {
  it("récupère les cartes encore en base sur les ISO de la semaine affichée", () => {
    const live = [
      { id: "1", meal_id: "a", quantity: 1, expiration_date: null, day_of_week: "2026-07-20", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meals: { name: "Poisson + Riz" } },
      { id: "2", meal_id: "b", quantity: 1, expiration_date: null, day_of_week: "2026-07-28", meal_time: "midi", counter_start_date: null, sort_order: 0, ingredients_override: null, meals: { name: "Hors semaine" } },
    ] as any[];
    const recovered = recoverPreviousWeekCardsFromLive(live, week);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].meal_name).toBe("Poisson + Riz");
  });

  it("écarte les cartes de sauvegarde sur un jour déjà couvert", () => {
    const recovered = [card("1", "2026-07-20", "Poisson + Riz")];
    const backup = [card("9", "lundi", "Riz + Tenders")];
    const merged = mergeRecoveredAndBackupCards(recovered, backup, week);
    expect(merged).toHaveLength(1);
    expect(merged[0].meal_name).toBe("Poisson + Riz");
  });

  it("complète les jours non couverts en normalisant l’ISO d’une autre semaine", () => {
    const recovered = [card("1", "2026-07-20", "Poisson + Riz")];
    const backup = [card("9", "2026-07-14", "Carbonara")];
    const merged = mergeRecoveredAndBackupCards(recovered, backup, week);
    expect(merged).toHaveLength(2);
    expect(merged[1].day_of_week).toBe("2026-07-21");
  });

  it("retombe sur la sauvegarde si aucune carte live n’est trouvée", () => {
    const backup = [card("9", "lundi", "Carbonara")];
    expect(mergeRecoveredAndBackupCards([], backup, week)).toEqual(backup);
  });
});
