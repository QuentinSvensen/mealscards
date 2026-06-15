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
  it("applique les snapshots ðŸ’¾ par-dessus les prÃ©fÃ©rences live", () => {
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

  it("ignore les clÃ©s de snapshots inconnues", () => {
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

  it("remappe les snapshots sauvegardés vers les dates ISO de la semaine cible", () => {
    const targetWeek = [
      { key: "lundi", iso: "2026-06-01", display: "" },
      { key: "mardi", iso: "2026-06-02", display: "" },
      { key: "mercredi", iso: "2026-06-03", display: "" },
      { key: "jeudi", iso: "2026-06-04", display: "" },
      { key: "vendredi", iso: "2026-06-05", display: "" },
      { key: "samedi", iso: "2026-06-06", display: "" },
      { key: "dimanche", iso: "2026-06-07", display: "" },
    ] as any;
    const merged = mergeSnapshotsIntoLivePrefMap(
      {},
      {
        "manual-mardi-midi": { cal: 300, prot: 20 },
        "extra-vendredi": { cal: 50, prot: 4, itemIds: ["x"] },
        "breakfast-dimanche": { cal: 100, prot: 8, mealId: "meal:pdej" },
      },
      targetWeek,
    );

    expect(merged.planning_manual_calories["2026-06-02-midi"]).toBe(300);
    expect(merged.planning_manual_proteins["2026-06-02-midi"]).toBe(20);
    expect(merged.planning_extra_calories["2026-06-05"]).toBe(50);
    expect(merged.planning_extra_selections["2026-06-05"]).toEqual(["x"]);
    expect(merged.planning_breakfast_manual_calories["2026-06-07"]).toBe(100);
    expect(merged.planning_breakfast["2026-06-07"]).toBe("meal:pdej");
  });

  it("préfère le snapshot de la date cible aux anciennes sauvegardes du même jour", () => {
    const targetWeek = [
      { key: "lundi", iso: "2026-06-15", display: "" },
      { key: "mardi", iso: "2026-06-16", display: "" },
      { key: "mercredi", iso: "2026-06-17", display: "" },
      { key: "jeudi", iso: "2026-06-18", display: "" },
      { key: "vendredi", iso: "2026-06-19", display: "" },
      { key: "samedi", iso: "2026-06-20", display: "" },
      { key: "dimanche", iso: "2026-06-21", display: "" },
    ] as any;

    const merged = mergeSnapshotsIntoLivePrefMap(
      {},
      {
        "manual-2026-06-16-midi": { cal: 1500, prot: 35, fiber: 6 },
        "manual-2026-06-09-midi": { cal: 1000, prot: 30 },
      },
      targetWeek,
    );

    expect(merged.planning_manual_calories["2026-06-16-midi"]).toBe(1500);
    expect(merged.planning_manual_proteins["2026-06-16-midi"]).toBe(35);
    expect(merged.planning_manual_fibers["2026-06-16-midi"]).toBe(6);
  });

  it("ignore les snapshots ISO d'anciennes semaines pour le même jour", () => {
    const targetWeek = [
      { key: "mardi", iso: "2026-06-16", display: "" },
    ] as any;

    const merged = mergeSnapshotsIntoLivePrefMap(
      {},
      {
        "manual-2026-06-16-midi": { cal: 1500, prot: 35, fiber: 6 },
        "manual-2026-06-09-midi": { cal: 1000, prot: 30 },
        "manual-mardi-midi": { cal: 800, prot: 25 },
      },
      targetWeek,
    );

    expect(merged.planning_manual_calories["2026-06-16-midi"]).toBe(1500);
    expect(merged.planning_manual_proteins["2026-06-16-midi"]).toBe(35);
  });
});

describe("applyNextWeekPromotionOnTop", () => {
  it("Ã©crase les extras issus des snapshots avec le brouillon semaine suivante", () => {
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

  it("la semaine suivante garde la prioritÃ© sur une valeur sauvegardÃ©e (ðŸ’¾)", () => {
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
    expect(out.planning_manual_calories["2025-04-14-midi"]).toBe(999);
    expect(out.planning_manual_proteins["2025-04-14-midi"]).toBe(99);
  });

  it("promeut les brouillons semaine suivante sur les dates ISO de la semaine cible", () => {
    const targetWeek = [
      { key: "lundi", iso: "2026-06-01", display: "" },
      { key: "mardi", iso: "2026-06-02", display: "" },
      { key: "mercredi", iso: "2026-06-03", display: "" },
      { key: "jeudi", iso: "2026-06-04", display: "" },
      { key: "vendredi", iso: "2026-06-05", display: "" },
      { key: "samedi", iso: "2026-06-06", display: "" },
      { key: "dimanche", iso: "2026-06-07", display: "" },
    ] as any;
    const out = applyNextWeekPromotionOnTop(
      {
        planning_manual_calories: {},
        planning_manual_proteins: {},
        planning_extra_calories: {},
        planning_extra_proteins: {},
        planning_extra_selections: {},
        planning_breakfast_manual_calories: {},
        planning_breakfast_manual_proteins: {},
        planning_breakfast: {},
        planning_drink_checks: {},
      },
      {
        next_week_manual_calories: { "mardi-midi": 450 },
        next_week_manual_proteins: { "mardi-midi": 35 },
        next_week_extra_calories: { vendredi: 80 },
        next_week_extra_proteins: { vendredi: 6 },
        next_week_extra_selections: { vendredi: ["extra-a"] },
        next_week_breakfast: { dimanche: "meal:pdej" },
        next_week_breakfast_manual_calories: { dimanche: 120 },
        next_week_breakfast_manual_proteins: { dimanche: 10 },
        next_week_drink_checks: { "mardi-midi": true },
      },
      {},
      targetWeek,
    );

    expect(out.planning_manual_calories["2026-06-02-midi"]).toBe(450);
    expect(out.planning_manual_proteins["2026-06-02-midi"]).toBe(35);
    expect(out.planning_extra_calories["2026-06-05"]).toBe(80);
    expect(out.planning_extra_selections["2026-06-05"]).toEqual(["extra-a"]);
    expect(out.planning_breakfast["2026-06-07"]).toBe("meal:pdej");
    expect(out.planning_breakfast_manual_calories["2026-06-07"]).toBe(120);
    expect(out.planning_drink_checks["2026-06-02-midi"]).toBe(true);
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
  it("supprime les ISO jusquâ€™au cutoff et le plateau", () => {
    const meals = [
      { id: "1", day_of_week: null },
      { id: "2", day_of_week: "2025-04-06" },
      { id: "3", day_of_week: "2025-04-14" },
      { id: "4", day_of_week: "lundi" },
    ] as unknown as PossibleMeal[];
    const del = filterPossibleMealsToDeleteForWeeklyClear(meals, "2025-04-07");
    expect(del.map(m => m.id).sort()).toEqual(["1", "2", "4"].sort());
  });

  it("préserve les cartes créées directement dans Possible (is_available=false, sans jour)", () => {
    const meals = [
      { id: "keep", day_of_week: null, meals: { is_available: false } },
      { id: "del1", day_of_week: null, meals: { is_available: true } },
      { id: "del2", day_of_week: "2025-04-06", meals: { is_available: false } },
    ] as unknown as PossibleMeal[];
    const del = filterPossibleMealsToDeleteForWeeklyClear(meals, "2025-04-07");
    expect(del.map(m => m.id).sort()).toEqual(["del1", "del2"].sort());
    expect(del.find(m => m.id === "keep")).toBeUndefined();
  });

  it("conserve les cartes ISO de la semaine précédente pendant le reset hebdomadaire", () => {
    const meals = [
      { id: "older", day_of_week: "2025-03-30" },
      { id: "previous", day_of_week: "2025-03-31" },
      { id: "previous-end", day_of_week: "2025-04-06" },
      { id: "next", day_of_week: "2025-04-07" },
      { id: "named", day_of_week: "lundi" },
    ] as unknown as PossibleMeal[];

    const del = filterPossibleMealsToDeleteForWeeklyClear(meals, "2025-04-06", {
      startISO: "2025-03-31",
      endISO: "2025-04-06",
    });

    expect(del.map(m => m.id).sort()).toEqual(["named", "older"].sort());
  });
});

describe("getPossibleMealIdsToDeleteOnManualReset", () => {
  it("conserve le petit-dÃ©j plateau sans jour", () => {
    const meals = [
      { id: "a", day_of_week: null, meals: { category: "petit_dejeuner" } },
      { id: "b", day_of_week: "2025-04-07", meals: { category: "plat" } },
    ] as unknown as PossibleMeal[];
    expect(getPossibleMealIdsToDeleteOnManualReset(meals)).toEqual(["b"]);
  });

  it("conserve les cartes ISO de la semaine précédente au reset manuel", () => {
    const meals = [
      { id: "previous", day_of_week: "2025-03-31", meals: { category: "plat" } },
      { id: "current", day_of_week: "2025-04-07", meals: { category: "plat" } },
      { id: "named", day_of_week: "mardi", meals: { category: "plat" } },
    ] as unknown as PossibleMeal[];

    expect(getPossibleMealIdsToDeleteOnManualReset(meals, {
      startISO: "2025-03-31",
      endISO: "2025-04-06",
    }).sort()).toEqual(["current", "named"].sort());
  });
});

describe("buildFullBackupPayload", () => {
  it("sÃ©rialise les cartes et les objectifs numÃ©riques", () => {
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
