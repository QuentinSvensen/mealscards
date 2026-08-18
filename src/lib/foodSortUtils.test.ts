import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodItem } from "@/hooks/useFoodItems";
import {
  compareFoodItemsByExpiration,
  getActiveCounterDaysForSort,
  getSortedFoodItems,
  normalizeExpirationSortKey,
} from "./foodSortUtils";

/** Construit un aliment minimal pour les tests de tri. */
function makeFood(partial: Partial<FoodItem> & Pick<FoodItem, "id" | "name">): FoodItem {
  return {
    grams: null,
    calories: null,
    protein: null,
    fiber: null,
    expiration_date: null,
    counter_start_date: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    no_counter: false,
    storage_type: "sec",
    quantity: 1,
    food_type: null,
    ...partial,
  };
}

describe("normalizeExpirationSortKey", () => {
  it("extrait YYYY-MM-DD depuis une date ISO jour ou datetime", () => {
    expect(normalizeExpirationSortKey("2026-07-11")).toBe("2026-07-11");
    expect(normalizeExpirationSortKey("2026-08-30T12:00:00.000Z")).toBe("2026-08-30");
  });

  it("traite null, vide et invalide comme absents", () => {
    expect(normalizeExpirationSortKey(null)).toBeNull();
    expect(normalizeExpirationSortKey("")).toBeNull();
    expect(normalizeExpirationSortKey("   ")).toBeNull();
    expect(normalizeExpirationSortKey("11/07/2026")).toBeNull();
  });
});

describe("compareFoodItemsByExpiration / getSortedFoodItems (péremption)", () => {
  // Repro exact Placard sec (sans badge compteur) : 30 août / 11 juil. / 19 juil. 2026
  const fuet = makeFood({
    id: "fuet",
    name: "Fuet",
    expiration_date: "2026-08-30",
    sort_order: 1,
  });
  const pain = makeFood({
    id: "pain",
    name: "Pain de mie",
    expiration_date: "2026-07-11",
    sort_order: 2,
  });
  const speculoos = makeFood({
    id: "speculoos",
    name: "Spéculoos",
    expiration_date: "2026-07-19",
    sort_order: 3,
  });

  it("repro UI : 3 aliments SANS compteur → Pain de mie → Spéculoos → Fuet", () => {
    expect(fuet.counter_start_date).toBeNull();
    expect(pain.counter_start_date).toBeNull();
    expect(speculoos.counter_start_date).toBeNull();
    expect(getActiveCounterDaysForSort(fuet)).toBeNull();
    expect(getActiveCounterDaysForSort(pain)).toBeNull();
    expect(getActiveCounterDaysForSort(speculoos)).toBeNull();

    const sorted = getSortedFoodItems([fuet, pain, speculoos], "expiration", true);
    expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Spéculoos", "Fuet"]);
  });

  it("repro UI : compteur 0 (non actif) ne change pas l'ordre chronologique", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
    const fuetZero = makeFood({
      ...fuet,
      // Ouvert « maintenant » → differenceInDays = 0 → pas de badge « Nj » actif pour le tri
      counter_start_date: "2026-07-18T10:00:00.000Z",
      grams: "100|40", // entamé pour ne pas être ignoré comme paquet scellé
    });
    expect(getActiveCounterDaysForSort(fuetZero)).toBeNull();
    const sorted = getSortedFoodItems([fuetZero, pain, speculoos], "expiration", true);
    expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Spéculoos", "Fuet"]);
    vi.useRealTimers();
  });

  it("compteur visible → au-dessus d'un aliment date-only même si date plus lointaine", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
    const fuetOpen = makeFood({
      id: "fuet",
      name: "Fuet",
      expiration_date: "2026-08-30",
      counter_start_date: "2026-07-01T10:00:00.000Z",
      grams: "200|80",
      sort_order: 1,
    });
    expect(getActiveCounterDaysForSort(fuetOpen)).toBeGreaterThanOrEqual(1);
    const sorted = getSortedFoodItems([fuetOpen, pain, speculoos], "expiration", true);
    expect(sorted.map((i) => i.name)).toEqual(["Fuet", "Pain de mie", "Spéculoos"]);
    vi.useRealTimers();
  });

  it("trie décroissant : date la plus lointaine d'abord (groupe date)", () => {
    const sorted = getSortedFoodItems([fuet, pain, speculoos], "expiration", false);
    expect(sorted.map((i) => i.name)).toEqual(["Fuet", "Spéculoos", "Pain de mie"]);
  });

  it("place les dates manquantes en fin en croissant", () => {
    const sansDate = makeFood({ id: "x", name: "Sans date", expiration_date: null, sort_order: 0 });
    const sorted = getSortedFoodItems([sansDate, fuet, pain], "expiration", true);
    expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Fuet", "Sans date"]);
  });

  it("place les dates manquantes en début en décroissant", () => {
    const sansDate = makeFood({ id: "x", name: "Sans date", expiration_date: null, sort_order: 0 });
    const sorted = getSortedFoodItems([sansDate, fuet, pain], "expiration", false);
    expect(sorted.map((i) => i.name)).toEqual(["Sans date", "Fuet", "Pain de mie"]);
  });

  describe("compteur orphelin masqué (ne doit PAS monter en groupe 0 — bug Fuet)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("ignore counter_start_date sur paquet scellé (pas de badge) → tri par date", () => {
      // Comme Fuet scellé : date DB présente, badge UI null → groupe 1, pas groupe 0
      const fuetOrphelin = makeFood({
        id: "fuet",
        name: "Fuet",
        expiration_date: "2026-08-30",
        counter_start_date: "2026-07-01T10:00:00.000Z",
        grams: "200", // plein / scellé
        quantity: 1,
        sort_order: 1,
      });
      expect(getActiveCounterDaysForSort(fuetOrphelin)).toBeNull();
      const sorted = getSortedFoodItems([fuetOrphelin, pain, speculoos], "expiration", true);
      expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Spéculoos", "Fuet"]);
    });

    it("ignore counter_start_date si no_counter (badge masqué) → tri par date", () => {
      const fuetNoCtr = makeFood({
        id: "fuet",
        name: "Fuet",
        expiration_date: "2026-08-30",
        counter_start_date: "2026-07-01T10:00:00.000Z",
        no_counter: true,
        sort_order: 1,
      });
      expect(getActiveCounterDaysForSort(fuetNoCtr)).toBeNull();
      const sorted = getSortedFoodItems([fuetNoCtr, pain, speculoos], "expiration", true);
      expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Spéculoos", "Fuet"]);
    });

    it("aliment entamé avec compteur auto coupé : pas de jours affichés (ex. Aliments inutilisés)", () => {
      const pommeDeTerre = makeFood({
        id: "pdt",
        name: "Pomme de terre",
        grams: "500|250",
        quantity: 1,
        no_counter: true,
        counter_start_date: "2026-08-06T10:00:00.000Z",
        expiration_date: "2026-08-08",
        storage_type: "sec",
      });
      expect(getActiveCounterDaysForSort(pommeDeTerre)).toBeNull();
    });

    it("avec résolveur UI qui masque le badge : Fuet ne passe pas avant les dates proches", () => {
      const fuetHidden = makeFood({
        id: "fuet",
        name: "Fuet",
        expiration_date: "2026-08-30",
        counter_start_date: "2026-07-01T10:00:00.000Z",
        sort_order: 1,
      });
      // Simule resolveFoodItemCounterStartForDisplay → null (paquet intact / baseline)
      const resolveHidden = (fi: FoodItem) =>
        fi.id === "fuet" ? null : fi.counter_start_date;
      const sorted = getSortedFoodItems(
        [fuetHidden, pain, speculoos],
        "expiration",
        true,
        "",
        resolveHidden,
      );
      expect(sorted.map((i) => i.name)).toEqual(["Pain de mie", "Spéculoos", "Fuet"]);
    });
  });

  describe("groupe 0 — compteurs visibles entre eux", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("privilégie le compteur actif plus élevé en croissant", () => {
      const openedLong = makeFood({
        id: "a",
        name: "Ouvert longtemps",
        expiration_date: "2026-07-20",
        counter_start_date: "2026-06-01T10:00:00.000Z",
        grams: "100|40",
        sort_order: 2,
      });
      const openedRecent = makeFood({
        id: "b",
        name: "Ouvert récemment",
        expiration_date: "2026-07-20",
        counter_start_date: "2026-07-10T10:00:00.000Z",
        grams: "100|40",
        sort_order: 1,
      });
      const cmp = compareFoodItemsByExpiration(openedLong, openedRecent, true);
      expect(cmp).toBeLessThan(0); // ouvert plus longtemps d'abord
    });
  });
});
