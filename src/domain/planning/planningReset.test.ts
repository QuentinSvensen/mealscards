import { describe, it, expect } from "vitest";
import { applyNextWeekPromotionOnTop } from "./applyNextWeekPromotion";
import { mergeSnapshotsIntoLivePrefMap } from "./mergePlanningSnapshots";
import { resolvePostResetGoals } from "./postResetGoals";
import { filterPossibleMealsToDeleteForWeeklyClear, getPossibleMealIdsToDeleteOnManualReset } from "./mealsToClear";
import { buildFullBackupPayload, serializePossibleMealsForBackup } from "./buildBackupPayload";
import type { PossibleMeal } from "@/hooks/useMeals";
import type { PlanningPrefMap } from "./types";

const baseMeal = {
  created_at: "",
  sort_order: 0,
  meals: {} as PossibleMeal["meals"],
};

describe("mergeSnapshotsIntoLivePrefMap", () => {
  it("applique les snapshots 💾 par-dessus les préférences live", () => {
    const prefMap: PlanningPrefMap = {
      planning_manual_calories: { "2025-04-07-midi": 100 },
      planning_manual_proteins: {},
      planning_extra_calories: { "2025-04-07": 50 },
      planning_extra_proteins: {},
      planning_extra_selections: {},
      planning_breakfast_manual_calories: {},
      planning_breakfast_manual_proteins: {},
      planning_breakfast: {},
      planning_drink_checks: {},
    };
    const merged = mergeSnapshotsIntoLivePrefMap(prefMap, {
      "manual-2025-04-07-midi": { cal: 999, prot: 12 },
      "extra-2025-04-07": { cal: 1, prot: 2, itemIds: ["a", "b"] },
    });
    expect(merged.planning_manual_calories["2025-04-07-midi"]).toBe(999);
    expect(merged.planning_manual_proteins["2025-04-07-midi"]).toBe(12);
    expect(merged.planning_extra_calories["2025-04-07"]).toBe(1);
    expect(merged.planning_extra_proteins["2025-04-07"]).toBe(2);
    expect(merged.planning_extra_selections["2025-04-07"]).toEqual(["a", "b"]);
  });

  it("ignore les clés de snapshots inconnues", () => {
    const prefMap: PlanningPrefMap = {
      planning_manual_calories: {},
      planning_manual_proteins: {},
      planning_extra_calories: {},
      planning_extra_proteins: {},
      planning_extra_selections: {},
      planning_breakfast_manual_calories: {},
      planning_breakfast_manual_proteins: {},
      planning_breakfast: {},
      planning_drink_checks: {},
    };
    const merged = mergeSnapshotsIntoLivePrefMap(prefMap, { foo: { cal: 1 } } as any);
    expect(merged.planning_manual_calories).toEqual({});
  });
});

describe("applyNextWeekPromotionOnTop", () => {
  it("écrase les extras issus des snapshots avec le brouillon semaine suivante", () => {
    const merged = mergeSnapshotsIntoLivePrefMap(
      {
        planning_manual_calories: {},
        planning_manual_proteins: {},
        planning_extra_calories: { "2025-04-14": 10 },
        planning_extra_proteins: {},
        planning_extra_selections: { "2025-04-14": ["food-a"] },
        planning_breakfast_manual_calories: {},
        planning_breakfast_manual_proteins: {},
        planning_breakfast: {},
        planning_drink_checks: {},
      },
      {
        "extra-2025-04-14": { cal: 10, prot: 0, itemIds: ["food-a"] },
      },
    );
    const prefMap: PlanningPrefMap = {
      next_week_extra_calories: { "2025-04-14": 0 },
      next_week_extra_proteins: {},
      next_week_extra_selections: { "2025-04-14": ["custom::Collation::100::5"] },
      next_week_manual_calories: {},
      next_week_manual_proteins: {},
      next_week_breakfast: {},
      next_week_breakfast_manual_calories: {},
      next_week_breakfast_manual_proteins: {},
      next_week_drink_checks: {},
    };
    const out = applyNextWeekPromotionOnTop(merged, prefMap);
    expect(out.planning_extra_selections["2025-04-14"]).toEqual(["custom::Collation::100::5"]);
    expect(out.planning_extra_calories["2025-04-14"]).toBeUndefined();
  });

  it("ne réécrase pas une clé sauvegardée (💾) avec le brouillon next_week", () => {
    const merged = mergeSnapshotsIntoLivePrefMap(
      {
        planning_manual_calories: { "2025-04-14-midi": 420 },
        planning_manual_proteins: { "2025-04-14-midi": 30 },
        planning_extra_calories: {},
        planning_extra_proteins: {},
        planning_extra_selections: {},
        planning_breakfast_manual_calories: {},
        planning_breakfast_manual_proteins: {},
        planning_breakfast: {},
        planning_drink_checks: {},
      },
      {
        "manual-2025-04-14-midi": { cal: 420, prot: 30 },
      },
    );
    const prefMap: PlanningPrefMap = {
      next_week_manual_calories: { "2025-04-14-midi": 999 },
      next_week_manual_proteins: { "2025-04-14-midi": 99 },
      next_week_extra_calories: {},
      next_week_extra_proteins: {},
      next_week_extra_selections: {},
      next_week_breakfast: {},
      next_week_breakfast_manual_calories: {},
      next_week_breakfast_manual_proteins: {},
      next_week_drink_checks: {},
    };
    const snapshots = {
      "manual-2025-04-14-midi": { cal: 420, prot: 30 },
    };
    const out = applyNextWeekPromotionOnTop(merged, prefMap, snapshots);
    expect(out.planning_manual_calories["2025-04-14-midi"]).toBe(420);
    expect(out.planning_manual_proteins["2025-04-14-midi"]).toBe(30);
  });
});

describe("resolvePostResetGoals", () => {
  it("promouvoit next_week si positif", () => {
    const g = resolvePostResetGoals({
      planning_daily_goal: 2000,
      next_week_daily_goal: 2400,
      planning_protein_goal: 100,
      next_week_protein_goal: 120,
    });
    expect(g.planning_daily_goal).toBe(2400);
    expect(g.next_week_daily_goal).toBe(2400);
    expect(g.planning_protein_goal).toBe(120);
    expect(g.next_week_protein_goal).toBe(120);
  });

  it("garde le planning si next_week absent ou nul", () => {
    const g = resolvePostResetGoals({
      planning_daily_goal: 2000,
      planning_protein_goal: 100,
    });
    expect(g.planning_daily_goal).toBe(2000);
    expect(g.next_week_daily_goal).toBe(2000);
  });
});

describe("filterPossibleMealsToDeleteForWeeklyClear", () => {
  it("supprime les ISO jusqu’au cutoff et le plateau", () => {
    const meals = [
      { id: "1", day_of_week: null },
      { id: "2", day_of_week: "2025-04-06" },
      { id: "3", day_of_week: "2025-04-14" },
      { id: "4", day_of_week: "lundi" },
    ] as unknown as PossibleMeal[];
    const del = filterPossibleMealsToDeleteForWeeklyClear(meals, "2025-04-07");
    expect(del.map(m => m.id).sort()).toEqual(["1", "2", "4"].sort());
  });
});

describe("getPossibleMealIdsToDeleteOnManualReset", () => {
  it("conserve le petit-déj plateau sans jour", () => {
    const meals = [
      { id: "a", day_of_week: null, meals: { category: "petit_dejeuner" } },
      { id: "b", day_of_week: "2025-04-07", meals: { category: "plat" } },
    ] as unknown as PossibleMeal[];
    expect(getPossibleMealIdsToDeleteOnManualReset(meals)).toEqual(["b"]);
  });
});

describe("buildFullBackupPayload", () => {
  it("sérialise les cartes et les objectifs numériques", () => {
    const pm = [
      {
        id: "x",
        meal_id: "m",
        quantity: 1,
        expiration_date: null,
        day_of_week: "2025-04-07",
        meal_time: "midi",
        counter_start_date: null,
        sort_order: 0,
        ingredients_override: null,
        ...baseMeal,
      },
    ] as PossibleMeal[];
    const pref: PlanningPrefMap = {
      planning_manual_calories: {},
      planning_manual_proteins: {},
      planning_extra_calories: {},
      planning_extra_proteins: {},
      planning_extra_selections: {},
      planning_breakfast_manual_calories: {},
      planning_breakfast_manual_proteins: {},
      planning_breakfast: {},
      planning_drink_checks: {},
      planning_cal_overrides: {},
      planning_daily_goal: 2500,
      planning_protein_goal: 140,
    };
    const b = buildFullBackupPayload(pm, pref);
    expect(b.cards).toHaveLength(1);
    expect(b.cards[0].id).toBe("x");
    expect(b.daily_goal).toBe(2500);
    expect(serializePossibleMealsForBackup(pm)).toEqual(b.cards);
  });
});
