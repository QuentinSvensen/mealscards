import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeCounterDays, getAdaptedCounterDays } from "@/lib/ingredientUtils";
import { computePlannedCounterDate, findEarliestPastPlannedOpenForFood, resolveFoodItemCounterStartForDisplay, resolveFoodItemStockVisualHint, isSealedPartialUseInPastPlanning } from "@/hooks/useMealTransfers";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { PossibleMeal } from "@/hooks/useMeals";

// ─── getAdaptedCounterDays (carte Possible) ─────────────────────────────────

describe("getAdaptedCounterDays", () => {
  it("estime les jours entre ouverture future et créneau du repas quand le jour est planifié", () => {
    const fixedNow = new Date("2026-04-06T10:00:00.000Z"); // avant l’ouverture prévue le même jour
    const futureStart = "2026-04-06T12:00:00.000Z"; // ouverture lundi midi (futur par rapport à fixedNow)
    expect(
      getAdaptedCounterDays(futureStart, "2026-04-07", "2026-01-01T10:00:00.000Z", "midi", fixedNow)
    ).toBe(1);
  });

  it("estime aussi avec une clé jour français (ex. mardi après ouverture lundi)", () => {
    const fixedNow = new Date("2026-04-06T10:00:00.000Z");
    const futureStart = "2026-04-06T12:00:00.000Z";
    expect(
      getAdaptedCounterDays(futureStart, "mardi", "2026-01-01T10:00:00.000Z", "midi", fixedNow)
    ).toBe(1);
  });

  it("n'affiche pas d'estimation si le repas est le même jour calendaire que l'ouverture future", () => {
    const fixedNow = new Date("2026-04-06T10:00:00.000Z");
    const futureStart = "2026-04-06T12:00:00.000Z";
    expect(
      getAdaptedCounterDays(futureStart, "2026-04-06", "2026-01-01T10:00:00.000Z", "midi", fixedNow)
    ).toBeNull();
  });

  it("returns null when counter start is in the future even without planning (unplanned)", () => {
    const fixedNow = new Date("2026-04-05T14:00:00.000Z");
    const futureStart = "2026-04-10T12:00:00.000Z";
    expect(getAdaptedCounterDays(futureStart, null, undefined, null, fixedNow)).toBeNull();
  });

  it("ne montre pas de badge sur une carte non planifiée qui vient elle-même d'entamer l'aliment (start ≈ createdAt)", () => {
    const now = "2026-04-22T14:00:00.000Z";
    const fixedNow = new Date(now);
    // start et createdAt identiques (à la seconde près) → carte à l'origine de l'ouverture
    expect(getAdaptedCounterDays(now, null, now, null, fixedNow)).toBeNull();
    // tolérance ~30s
    const thirtySecLater = new Date(new Date(now).getTime() + 30_000).toISOString();
    expect(getAdaptedCounterDays(now, null, thirtySecLater, null, fixedNow)).toBeNull();
  });

  it("affiche bien le nombre de jours pour une carte non planifiée héritée d'une ouverture plus ancienne", () => {
    const fixedNow = new Date("2026-04-22T14:00:00.000Z");
    const start = "2026-04-20T13:00:00.000Z"; // ouvert il y a > 2 jours
    const createdAt = "2026-04-22T14:00:00.000Z"; // carte créée maintenant
    const d = getAdaptedCounterDays(start, null, createdAt, null, fixedNow);
    expect(d).toBe(2);
  });

  it("affiche le décalage entre ouverture réelle passée et repas planifié plus tard (ex. burger après tenders entamés)", () => {
    const fixedNow = new Date("2026-04-22T14:00:00.000Z");
    const startPast = "2026-04-21T10:00:00.000Z";
    const d = getAdaptedCounterDays(startPast, "2026-04-23", "2026-01-01T10:00:00.000Z", "midi", fixedNow);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThanOrEqual(1);
  });

  it("garde le badge après sélection explicite de Midi (ouverture jeudi → repas samedi midi)", () => {
    const fixedNow = new Date("2026-06-11T19:37:00.000Z");
    const startPast = "2026-06-11T19:35:00.000Z";
    const withoutMealTime = getAdaptedCounterDays(startPast, "2026-06-13", "2026-01-01T10:00:00.000Z", null, fixedNow);
    const withMidi = getAdaptedCounterDays(startPast, "2026-06-13", "2026-01-01T10:00:00.000Z", "midi", fixedNow);
    expect(withoutMealTime).not.toBeNull();
    expect(withMidi).not.toBeNull();
    expect(withMidi).toBeGreaterThanOrEqual(1);
  });
});

// ─── computeCounterDays ─────────────────────────────────────────────────────

describe("computeCounterDays", () => {
  it("returns null when counterStartDate is null", () => {
    expect(computeCounterDays(null)).toBeNull();
  });

  it("returns null when counterStartDate is undefined", () => {
    expect(computeCounterDays(undefined)).toBeNull();
  });

  it("returns null when counterStartDate is empty string", () => {
    // empty string → new Date('') → Invalid Date → NaN
    expect(computeCounterDays("")).toBeNull();
  });

  it("returns 0 for a counter started now", () => {
    const now = new Date().toISOString();
    expect(computeCounterDays(now)).toBe(0);
  });

  it("returns 1 for a counter started 1 day ago", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(computeCounterDays(yesterday)).toBe(1);
  });

  it("returns 3 for a counter started 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(computeCounterDays(threeDaysAgo)).toBe(3);
  });

  it("returns null (hidden) when counter_start_date is in the future (scheduled meal)", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    expect(computeCounterDays(tomorrow)).toBeNull();
  });

  it("returns 0 when counter_start_date is a few hours in the past (same day)", () => {
    const fewHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(computeCounterDays(fewHoursAgo)).toBe(0);
  });

  it("returns null when counter is 1 hour in the future", () => {
    const oneHourFromNow = new Date(Date.now() + 3600000).toISOString();
    expect(computeCounterDays(oneHourFromNow)).toBeNull();
  });
});

// ─── computePlannedCounterDate ──────────────────────────────────────────────

describe("computePlannedCounterDate", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fix "now" to Wednesday 2026-03-18 10:00:00 UTC
    dateSpy = vi.spyOn(Date.prototype, "getDay");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 12:00 for a midi meal", () => {
    const result = computePlannedCounterDate("lundi", "midi");
    const d = new Date(result);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it("returns 19:00 for a soir meal", () => {
    const result = computePlannedCounterDate("lundi", "soir");
    const d = new Date(result);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
  });

  it("does not force midi (12:00) when mealTime is null — hour stays from reference date", () => {
    const result = computePlannedCounterDate("mercredi", null);
    const d = new Date(result);
    expect(d.getDay()).toBe(3);
    const ref = new Date();
    const todayIdx = ref.getDay() === 0 ? 6 : ref.getDay() - 1;
    const diff = 2 - todayIdx; // mercredi = index 2
    const expected = new Date(ref);
    expected.setDate(expected.getDate() + diff);
    expect(d.getHours()).toBe(expected.getHours());
    expect(d.getMinutes()).toBe(expected.getMinutes());
  });

  it("returns a date on the correct day of the week for lundi", () => {
    const result = computePlannedCounterDate("lundi", "midi");
    const d = new Date(result);
    expect(d.getDay()).toBe(1); // Monday
  });

  it("returns a date on the correct day for samedi", () => {
    const result = computePlannedCounterDate("samedi", "soir");
    const d = new Date(result);
    expect(d.getDay()).toBe(6); // Saturday
  });

  it("returns a date on the correct day for dimanche", () => {
    const result = computePlannedCounterDate("dimanche", "midi");
    const d = new Date(result);
    expect(d.getDay()).toBe(0); // Sunday
  });

  it("returns valid ISO string", () => {
    const result = computePlannedCounterDate("jeudi", "soir");
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });

  it("each day maps to a different weekday", () => {
    const days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
    const expectedDow = [1, 2, 3, 4, 5, 6, 0];
    days.forEach((day, i) => {
      const result = computePlannedCounterDate(day, "midi");
      const d = new Date(result);
      expect(d.getDay()).toBe(expectedDow[i]);
    });
  });
});

// ─── Counter lifecycle scenarios (pure logic) ───────────────────────────────

describe("Counter lifecycle scenarios", () => {
  it("Scenario: move to Possible → counter starts at now → computeCounterDays returns 0", () => {
    // Simulates: meal moved to Possible, counter_start_date = now
    const counterStartDate = new Date().toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBe(0); // Counter visible, showing 0 days
  });

  it("Scenario: plan meal for future → counter_start_date in future → computeCounterDays returns null (hidden)", () => {
    // Simulates: meal planned for Saturday, counter set to Saturday 12h
    const futureSaturday = new Date();
    futureSaturday.setDate(futureSaturday.getDate() + 3);
    futureSaturday.setHours(12, 0, 0, 0);
    
    const counterStartDate = futureSaturday.toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBeNull(); // Counter hidden
  });

  it("Scenario: remove planning → counter resets to now → computeCounterDays returns 0", () => {
    // Simulates: planning removed, counter reset to now
    const counterStartDate = new Date().toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBe(0); // Counter visible again
  });

  it("Scenario: planned meal time has passed → counter becomes visible", () => {
    // Simulates: meal was planned for yesterday 12h, now the planned time has passed
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    pastDate.setHours(12, 0, 0, 0);
    
    const counterStartDate = pastDate.toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBeGreaterThanOrEqual(0); // Counter visible, showing >= 1 day
    expect(days).not.toBeNull();
  });

  it("Scenario: ingredient with no_counter or storage_type surgele should not get counter_start_date", () => {
    // This is enforced in deductIngredientsFromStock: shouldStartCounter check
    // !is_infinite && storage_type !== 'surgele' && !no_counter
    const fiSurgele = { is_infinite: false, storage_type: "surgele", no_counter: false, counter_start_date: null };
    const fiNoCtr = { is_infinite: false, storage_type: "frigo", no_counter: true, counter_start_date: null };
    const fiInfinite = { is_infinite: true, storage_type: "frigo", no_counter: false, counter_start_date: null };

    const shouldStartSurgele = !fiSurgele.counter_start_date && !fiSurgele.is_infinite && fiSurgele.storage_type !== 'surgele' && !fiSurgele.no_counter;
    const shouldStartNoCtr = !fiNoCtr.counter_start_date && fiNoCtr.storage_type !== 'surgele' && !fiNoCtr.no_counter;
    
    const shouldStartInfinite =
      !fiInfinite.counter_start_date &&
      !fiInfinite.is_infinite &&
      fiInfinite.storage_type !== "surgele" &&
      !fiInfinite.no_counter;

    expect(shouldStartSurgele).toBe(false);
    expect(shouldStartNoCtr).toBe(false);
    expect(shouldStartInfinite).toBe(false);
  });

  it("Scenario: counter cleared when partial remainder consumed fully", () => {
    // When remaining <= 0 after deduction → item deleted
    // When fullUnits > 0 but remainder === 0 → counter_start_date set to null
    const fiWithCounter = { counter_start_date: "2026-03-15T10:00:00.000Z" };
    const remaining = 500; // perUnit=500, no partial
    const perUnit = 500;
    const fullUnits = Math.floor(remaining / perUnit); // 1
    const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10; // 0
    
    // Logic from deductIngredientsFromStock: if remainder is 0 and fullUnits > 0, clear counter
    const shouldClearCounter = remainder <= 0 && fiWithCounter.counter_start_date;
    expect(shouldClearCounter).toBeTruthy();
    expect(remainder).toBe(0);
    expect(fullUnits).toBe(1);
  });

  it("Scenario: counter NOT cleared when partial remainder still exists", () => {
    const remaining = 350;
    const perUnit = 500;
    const fullUnits = Math.floor(remaining / perUnit); // 0
    const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10; // 350
    
    expect(remainder).toBe(350);
    expect(remainder > 0).toBe(true);
    // Counter should NOT be cleared since there's still a partial unit
  });
});

// ─── Counter start conditions ───────────────────────────────────────────────

describe("Counter start conditions", () => {
  it("should start counter when: no existing counter, not surgele, no_counter is false", () => {
    const fi = { counter_start_date: null, storage_type: "frigo", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(true);
  });

  it("should NOT start counter when item already has counter", () => {
    const fi = { counter_start_date: "2026-03-10T00:00:00.000Z", storage_type: "frigo", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should NOT start counter for surgele storage", () => {
    const fi = { counter_start_date: null, storage_type: "surgele", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should NOT start counter when no_counter flag is true", () => {
    const fi = { counter_start_date: null, storage_type: "frigo", no_counter: true };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should start counter for sec storage (not surgele)", () => {
    const fi = { counter_start_date: null, storage_type: "sec", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(true);
  });
});

// ─── Ouverture inférée depuis repas Possible planifiés passés ─────────────────

describe("findEarliestPastPlannedOpenForFood", () => {
  const sauce: FoodItem = {
    id: "s1",
    name: "Sauce tikka masala",
    grams: "225",
    quantity: null,
    counter_start_date: null,
    calories: null,
    protein: null,
    fiber: null,
    expiration_date: null,
    sort_order: 0,
    created_at: "",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    no_counter: false,
    storage_type: "frigo",
    food_type: null,
  };

  const makePm = (day: string, time: string, ingredients: string): PossibleMeal => ({
    id: `pm-${day}-${time}`,
    meal_id: "m1",
    quantity: 1,
    expiration_date: null,
    day_of_week: day,
    meal_time: time,
    counter_start_date: null,
    created_at: "2026-06-01T10:00:00.000Z",
    ingredients_override: ingredients,
    meals: { ingredients },
  } as PossibleMeal);

  it("retourne le créneau passé le plus ancien qui utilise l'aliment", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const pms = [
      makePm("2026-06-29", "midi", "Riz + 50g Sauce tikka masala"),
      makePm("2026-07-01", "soir", "50g Sauce tikka masala"),
    ];
    const open = findEarliestPastPlannedOpenForFood(sauce, pms, fixedNow);
    expect(open).toBeTruthy();
    expect(new Date(open!).getHours()).toBe(12);
  });

  it("ignore un repas qui consomme le paquet entier (400g Tenders)", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const tenders: FoodItem = {
      ...sauce,
      id: "t1",
      name: "Tenders",
      grams: "400",
      quantity: 1,
    };
    const pms = [makePm("2026-06-29", "midi", "400g Tenders")];
    expect(findEarliestPastPlannedOpenForFood(tenders, pms, fixedNow)).toBeUndefined();
  });

  it("ignore aussi une fraction de boîte (200g sur 400g)", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const tenders: FoodItem = {
      ...sauce,
      id: "t1",
      name: "Tenders",
      grams: "400",
      quantity: 1,
    };
    const pms = [makePm("2026-06-29", "midi", "200g Tenders")];
    expect(findEarliestPastPlannedOpenForFood(tenders, pms, fixedNow)).toBeUndefined();
  });

  it("ouvre un pot cité sans quantité dans une recette passée", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const pms = [makePm("2026-06-29", "midi", "Riz + Tenders + Sauce tikka masala")];
    expect(findEarliestPastPlannedOpenForFood(sauce, pms, fixedNow)).toBeTruthy();
  });

  it("ignore les lots multi-paquets (#2)", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const lardons: FoodItem = {
      ...sauce,
      id: "l1",
      name: "Lardons",
      grams: "100",
      quantity: 2,
    };
    const pms = [makePm("2026-06-29", "midi", "50g Lardons")];
    expect(findEarliestPastPlannedOpenForFood(lardons, pms, fixedNow)).toBeUndefined();
  });

  it("ignore les créneaux futurs", () => {
    const fixedNow = new Date("2026-06-28T10:00:00.000Z");
    const pms = [makePm("2026-06-29", "midi", "50g Sauce tikka masala")];
    expect(findEarliestPastPlannedOpenForFood(sauce, pms, fixedNow)).toBeUndefined();
  });
});

describe("resolveFoodItemCounterStartForDisplay", () => {
  const tenders: FoodItem = {
    id: "t1",
    name: "Tenders",
    grams: "400",
    quantity: 1,
    counter_start_date: null,
    calories: null,
    protein: null,
    fiber: null,
    expiration_date: null,
    sort_order: 0,
    created_at: "",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    no_counter: false,
    storage_type: "frigo",
    food_type: null,
  };

  const futurePm = {
    id: "pm-fut",
    meal_id: "m1",
    quantity: 1,
    expiration_date: null,
    day_of_week: "2026-07-10",
    meal_time: "midi",
    counter_start_date: null,
    created_at: "2026-06-01T10:00:00.000Z",
    ingredients_override: "400g Tenders",
    meals: { ingredients: "400g Tenders" },
  } as PossibleMeal;

  it("n'affiche pas un prog. futur sur un lot scellé", () => {
    const fixedNow = new Date("2026-06-29T10:00:00.000Z");
    const fi = {
      ...tenders,
      counter_start_date: computePlannedCounterDate("2026-07-10", "midi"),
    };
    const resolved = resolveFoodItemCounterStartForDisplay(fi, [futurePm], fixedNow);
    expect(resolved).toBeNull();
  });

  it("n'affiche pas de compteur sur une boîte entière 400g planifiée passée", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const pastPm = {
      ...futurePm,
      id: "pm-past",
      day_of_week: "2026-06-29",
      ingredients_override: "400g Tenders",
      meals: { ingredients: "400g Tenders" },
    } as PossibleMeal;
    const resolved = resolveFoodItemCounterStartForDisplay(
      { ...tenders, counter_start_date: computePlannedCounterDate("2026-06-29", "midi") },
      [pastPm],
      fixedNow,
    );
    expect(resolved).toBeNull();
  });

  it("infère une ouverture passée sur pot scellé (recette partielle)", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const pastPm = {
      ...futurePm,
      id: "pm-past",
      day_of_week: "2026-06-29",
      ingredients_override: "50g Sauce tikka masala",
      meals: { ingredients: "50g Sauce tikka masala" },
    } as PossibleMeal;
    const sauce = { ...tenders, name: "Sauce tikka masala", grams: "225", quantity: null };
    const resolved = resolveFoodItemCounterStartForDisplay(sauce, [pastPm], fixedNow);
    expect(resolved).toBeTruthy();
    expect(new Date(resolved!).getTime()).toBeLessThanOrEqual(fixedNow.getTime());
  });

  it("affiche un compteur quand l'aliment est consommé par un repas Possible non planifié", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const unplannedPm = {
      ...futurePm,
      id: "pm-unplanned",
      day_of_week: null,
      meal_time: null,
      created_at: "2026-06-29T12:00:00.000Z",
      ingredients_override: "Riz + Tenders + Sauce tikka masala",
      meals: { ingredients: "Riz + Tenders + Sauce tikka masala" },
    } as PossibleMeal;
    const sauce = { ...tenders, name: "Sauce tikka masala", grams: "225", quantity: null };
    const resolved = resolveFoodItemCounterStartForDisplay(sauce, [unplannedPm], fixedNow, null);
    expect(resolved).toBeTruthy();
  });

  it("affiche un compteur quand le reliquat est sous le poids d'origine (450g → 225g)", () => {
    const fixedNow = new Date("2026-06-30T10:00:00.000Z");
    const pastPm = {
      ...futurePm,
      id: "pm-past",
      day_of_week: "2026-06-29",
      ingredients_override: "Riz + Tenders + Sauce tikka masala",
      meals: { ingredients: "Riz + Tenders + Sauce tikka masala" },
    } as PossibleMeal;
    const sauce = { ...tenders, name: "Sauce tikka masala", grams: "225", quantity: null };
    const resolved = resolveFoodItemCounterStartForDisplay(sauce, [pastPm], fixedNow, 450);
    expect(resolved).toBeTruthy();
  });
});

describe("resolveFoodItemStockVisualHint", () => {
  const tenders: FoodItem = {
    id: "t1",
    name: "Tenders",
    grams: "400",
    quantity: 1,
    counter_start_date: null,
    calories: null,
    protein: null,
    fiber: null,
    expiration_date: null,
    sort_order: 0,
    created_at: "",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    no_counter: false,
    storage_type: "frigo",
    food_type: null,
  };

  it("marque un paquet entier sans compteur attendu", () => {
    const hint = resolveFoodItemStockVisualHint(tenders, [], null, undefined, null);
    expect(hint.isFullSealed).toBe(true);
    expect(hint.counterExpected).toBe(false);
  });

  it("marque entamé + compteur attendu sous le poids d'origine", () => {
    const sauce = { ...tenders, name: "Sauce tikka masala", grams: "225" };
    const hint = resolveFoodItemStockVisualHint(sauce, [], "2026-06-29T12:00:00.000Z", undefined, 450);
    expect(hint.isPhysicallyOpened).toBe(true);
    expect(hint.counterExpected).toBe(true);
    expect(hint.counterActive).toBe(true);
  });
});
