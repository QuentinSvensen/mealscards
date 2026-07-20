import { describe, it, expect } from "vitest";
import {
  computeIngredientCalories, computeIngredientProtein,
  smartFoodContains, cleanIngredientText,
  parseIngredientsToLines, serializeIngredients,
  extractIngredientMacros, applyIngredientMacros,
  normalizeForMatch, normalizeKey,
  formatPlannedCounterOpenFr,
  getCounterDaysBadgeTooltip,
  listUniqueOptionalIngredients,
  listOptionalIngredientGroups,
  listRecipeIngredientGroups,
  defaultIncludedIngredientKeys,
  buildIngredientsOverrideFromSelection,
  applyOptionalInclusionsToIngredients,
  optionalIngredientKey,
  appendIncludedOptionalsToOverride,
  appendIncludedOptionalsToOverrideScaled,
} from "@/lib/ingredientUtils";
import { buildFoodItemIndex } from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";

// ─── NORMALISATION RECHERCHE ────────────────────────────────────────────────

describe("normalizeForMatch", () => {
  it("matche sans accent ni casse (pate ↔ pâte)", () => {
    expect(normalizeForMatch("pate")).toBe(normalizeForMatch("pâte"));
    expect(normalizeForMatch("Pâte à tartiner").includes(normalizeForMatch("pate"))).toBe(true);
    expect(normalizeForMatch("Pâtes").includes(normalizeForMatch("PATE"))).toBe(true);
  });
});

// ─── CALORIE COMPUTATION ────────────────────────────────────────────────────

describe("computeIngredientCalories", () => {
  it("computes calories from gram-based ingredient", () => {
    // 200g poulet {165} → 165 * 200/100 = 330
    expect(computeIngredientCalories("200g Poulet{165}")).toBe(330);
  });

  it("computes calories from count-based ingredient", () => {
    // 2 Oeufs{78} → 78 * 2 = 156
    expect(computeIngredientCalories("2 Oeufs{78}")).toBe(156);
  });

  it("sums multiple ingredients", () => {
    // 200g Poulet{165}, 100g Riz{130} → 330 + 130 = 460
    expect(computeIngredientCalories("200g Poulet{165}, 100g Riz{130}")).toBe(460);
  });

  it("returns null when no cal data", () => {
    expect(computeIngredientCalories("200g Poulet, 100g Riz")).toBeNull();
  });

  it("returns null for empty/null input", () => {
    expect(computeIngredientCalories(null)).toBeNull();
    expect(computeIngredientCalories("")).toBeNull();
  });

  it("skips optional ingredients", () => {
    // Only non-optional should count
    expect(computeIngredientCalories("200g Poulet{165}, ?50g Parmesan{431}")).toBe(330);
  });

  it("handles OR groups — picks first by default", () => {
    expect(computeIngredientCalories("100g Pain{265} | 100g Baguette{289}")).toBe(265);
  });

  it("handles OR groups with isAvailable callback", () => {
    const isAvailable = (name: string) => normalizeForMatch(name).includes("baguette");
    expect(computeIngredientCalories("100g Pain{265} | 100g Baguette{289}", isAvailable)).toBe(289);
  });

  it("handles ingredient with cal but no qty (raw cal value)", () => {
    expect(computeIngredientCalories("Sauce{50}")).toBe(50);
  });
});

// ─── PROTEIN COMPUTATION ────────────────────────────────────────────────────

describe("computeIngredientProtein", () => {
  it("computes protein from gram-based ingredient", () => {
    // 200g Poulet [31] → 31 * 200/100 = 62
    expect(computeIngredientProtein("200g Poulet [31]")).toBe(62);
  });

  it("computes protein from count-based", () => {
    // 3 Oeufs [6] → 6 * 3 = 18
    expect(computeIngredientProtein("3 Oeufs [6]")).toBe(18);
  });

  it("returns null when no protein data", () => {
    expect(computeIngredientProtein("200g Poulet")).toBeNull();
  });

  it("complète les prot depuis les fiches aliments quand [pro] est absent sur la ligne", () => {
    const fi: FoodItem = {
      id: "t1",
      name: "Poulet",
      grams: null,
      calories: null,
      protein: "31",
      expiration_date: null,
      counter_start_date: null,
      sort_order: 0,
      created_at: "",
      is_meal: false,
      is_infinite: false,
      is_dry: false,
      is_indivisible: false,
      no_counter: true,
      storage_type: "frigo",
      quantity: null,
      food_type: null,
    };
    const foodItems = [fi];
    const index = buildFoodItemIndex(foodItems);
    expect(computeIngredientProtein("200g Poulet", undefined, 1, foodItems, index)).toBe(62);
  });
});

// ─── SMART FOOD CONTAINS ────────────────────────────────────────────────────

describe("smartFoodContains", () => {
  it("matches same food", () => {
    expect(smartFoodContains("poulet", "poulet")).toBe(true);
  });

  it("accepts adjective additions", () => {
    expect(smartFoodContains("pâte intégrale", "pâte")).toBe(true);
    expect(smartFoodContains("poulet fumé", "poulet")).toBe(true);
  });

  it("rejects compound food names with prepositions", () => {
    expect(smartFoodContains("pain de mie", "pain")).toBe(false);
  });

  it("rejects accent-different words", () => {
    expect(smartFoodContains("pâté", "pâte")).toBe(false);
  });

  it("handles trailing 'e' tolerance", () => {
    expect(smartFoodContains("hachée", "haché")).toBe(true);
  });

  it("returns false for empty strings", () => {
    expect(smartFoodContains("", "poulet")).toBe(false);
    expect(smartFoodContains("poulet", "")).toBe(false);
  });
});

// ─── CLEAN INGREDIENT TEXT ──────────────────────────────────────────────────

describe("cleanIngredientText", () => {
  it("strips cal and pro markers", () => {
    expect(cleanIngredientText("200g Poulet{165} [31]")).toBe("200g Poulet");
  });

  it("handles null/undefined", () => {
    expect(cleanIngredientText(null)).toBe("");
    expect(cleanIngredientText(undefined)).toBe("");
  });

  it("strips multiple markers", () => {
    expect(cleanIngredientText("100g Riz{130}, 2 Oeufs{78} [6]")).toBe("100g Riz, 2 Oeufs");
  });

  it("strips fiber markers", () => {
    expect(cleanIngredientText("100g Avoine{370} [13] <10>")).toBe("100g Avoine");
  });
});

// ─── MACRO EXTRACTION/APPLICATION ───────────────────────────────────────────

describe("extractIngredientMacros", () => {
  it("extracts cal, pro and fiber from ingredients", () => {
    const macros = extractIngredientMacros("200g Poulet{165} [31] <0>, 100g Riz{130} <1,4>");
    expect(macros.get(normalizeKey("Poulet"))).toEqual({ cal: "165", pro: "31", fiber: "0" });
    expect(macros.get(normalizeKey("Riz"))).toEqual({ cal: "130", pro: "", fiber: "1.4" });
  });

  it("returns empty map for null input", () => {
    expect(extractIngredientMacros(null).size).toBe(0);
  });
});

describe("applyIngredientMacros", () => {
  it("applies macros to matching ingredients", () => {
    const macros = new Map([
      [normalizeKey("Poulet"), { cal: "165", pro: "31", fiber: "0" }],
    ]);
    const result = applyIngredientMacros("200g Poulet, 100g Riz", macros);
    expect(result).toContain("{165}");
    expect(result).toContain("[31]");
  });

  it("returns null when nothing changes", () => {
    const macros = new Map([
      [normalizeKey("Beurre"), { cal: "717", pro: "" }],
    ]);
    expect(applyIngredientMacros("200g Poulet", macros)).toBeNull();
  });
});

// ─── SERIALIZE ROUNDTRIP ────────────────────────────────────────────────────

describe("parseIngredientsToLines / serializeIngredients roundtrip", () => {
  it("roundtrips simple ingredients", () => {
    const raw = "200g Poulet, 100g Riz";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("200g Poulet, 100g Riz");
  });

  it("roundtrips OR alternatives", () => {
    const raw = "100g Pain | 100g Baguette, 2 Oeufs";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("100g Pain | 100g Baguette, 2 Oeufs");
  });

  it("preserves optional markers", () => {
    const raw = "200g Poulet, ?50g Parmesan";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("200g Poulet, ?50g Parmesan");
  });

  it("preserves cal/pro markers", () => {
    const raw = "200g Poulet{165} [31]";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toContain("{165}");
    expect(serialized).toContain("[31]");
  });
});

// ─── Infobulle compteur (ouverture future) ───────────────────────────────────

describe("formatPlannedCounterOpenFr", () => {
  it("affiche jour, date et heure style « Jeudi 15 12h » (Paris, pile sur l’heure)", () => {
    expect(formatPlannedCounterOpenFr("2026-01-15T11:00:00.000Z")).toBe("Jeudi 15 12h");
  });

  it("affiche les minutes quand non nulles", () => {
    expect(formatPlannedCounterOpenFr("2026-01-15T11:30:00.000Z")).toBe("Jeudi 15 12h30");
  });
});

describe("getCounterDaysBadgeTooltip (ouverture future)", () => {
  it("inclut la date/heure d’ouverture prévue dans le message", () => {
    const now = new Date("2026-01-14T12:00:00.000Z");
    const startFuture = "2026-01-15T11:00:00.000Z";
    const tip = getCounterDaysBadgeTooltip(startFuture, "vendredi", "midi", 1, now);
    expect(tip).toContain("Jeudi 15 12h");
    expect(tip).toContain("1 jour(s)");
    expect(tip).toContain("compteur pas encore démarré");
  });
});

// ─── Optionnels → Possible ───────────────────────────────────────────────────

describe("listUniqueOptionalIngredients / applyOptionalInclusions", () => {
  const recipe = "200g Poulet{165}, ?80g Poitrine, 100g Riz{130}, ?Fromage";

  it("liste les optionnels uniques avec label", () => {
    const list = listUniqueOptionalIngredients(recipe);
    expect(list.map((o) => o.key)).toEqual(["poitrine|80g", "fromage"]);
    expect(list[0].label).toMatch(/Poitrine/i);
  });

  it("retire le ? uniquement pour les clés cochées (override Possible)", () => {
    const override = applyOptionalInclusionsToIngredients(recipe, new Set(["poitrine|80g"]));
    expect(override).toContain("80g Poitrine");
    expect(override).not.toMatch(/\?80g Poitrine|\?Poitrine/i);
    expect(override).toMatch(/\?Fromage/);
    // La sérialisation peut reformater, mais Poulet reste non optionnel
    expect(override).toMatch(/Poulet/);
  });

  it("ajoute les optionnels inclus à un override déjà consommé", () => {
    const consumed = "200g Poulet{165}, 100g Riz{130}";
    const merged = appendIncludedOptionalsToOverride(consumed, recipe, new Set(["poitrine|80g"]));
    expect(merged).toContain("Poulet");
    expect(merged).toMatch(/80g Poitrine/);
    expect(merged).not.toMatch(/\?/);
  });

  it("distingue deux optionnels homonymes (ex. 12g et 22g Chocolat)", () => {
    const cookie =
      "20g Beurre, ?12g Chocolat + ?11g Beurre de cacahuète, ?5g Pâte, ?22g Chocolat";
    const groups = listOptionalIngredientGroups(cookie);
    expect(groups).toHaveLength(3);
    expect(groups[0].isBundle).toBe(true);
    expect(groups[0].items.map((i) => i.label)).toEqual([
      "12g Chocolat",
      "11g Beurre de cacahuète",
    ]);
    expect(groups[2].items[0].label).toBe("22g Chocolat");
    expect(listUniqueOptionalIngredients(cookie)).toHaveLength(4);
  });

  it("n'inclut que l'optionnel coché quand deux Chocolat existent", () => {
    const cookie = "?12g Chocolat, ?22g Chocolat";
    const lines = parseIngredientsToLines(cookie);
    const key12 = optionalIngredientKey(lines[0]);
    const override = applyOptionalInclusionsToIngredients(cookie, new Set([key12]));
    expect(override).toMatch(/12g Chocolat/);
    expect(override).not.toMatch(/\?12g Chocolat/);
    expect(override).toMatch(/\?22g Chocolat/);
  });

  it("liste toute la recette et pré-coche les non optionnels", () => {
    const cookie = "20g Beurre, ?12g Chocolat, 100g Farine";
    const groups = listRecipeIngredientGroups(cookie);
    expect(groups.flatMap((g) => g.items).map((i) => i.label)).toEqual([
      "20g Beurre",
      "12g Chocolat",
      "100g Farine",
    ]);
    const defaults = defaultIncludedIngredientKeys(groups);
    expect([...defaults].sort()).toEqual(["beurre|20g", "farine|100g"].sort());
  });

  it("construit un override depuis la sélection cochée", () => {
    const cookie = "20g Beurre, ?12g Chocolat, ?22g Chocolat";
    const groups = listRecipeIngredientGroups(cookie);
    const keys = defaultIncludedIngredientKeys(groups);
    keys.add(groups.flatMap((g) => g.items).find((i) => i.label === "12g Chocolat")!.key);
    const override = buildIngredientsOverrideFromSelection(cookie, keys);
    expect(override).toMatch(/20g Beurre/);
    expect(override).toMatch(/12g Chocolat/);
    expect(override).not.toMatch(/\?/);
    expect(override).not.toMatch(/22g Chocolat/);
  });

  it("applique les quantités éditées dans l'override de sélection", () => {
    const recipe = "90g Pâtes, 200g Lardons";
    const groups = listRecipeIngredientGroups(recipe);
    const keys = defaultIncludedIngredientKeys(groups);
    const patesKey = groups.flatMap((g) => g.items).find((i) => i.name === "Pâtes")!.key;
    const override = buildIngredientsOverrideFromSelection(recipe, keys, {
      [patesKey]: { qty: "120g", count: "" },
    });
    expect(override).toMatch(/120g Pâtes/);
    expect(override).toMatch(/200g Lardons/);
    expect(override).not.toMatch(/90g Pâtes/);
  });

  it("ajoute les optionnels inclus scalés à un override consommé", () => {
    const recipe = "200g Poulet{165}, ?80g Poitrine, 100g Riz{130}";
    const consumed = "400g Poulet{165}, 200g Riz{130}";
    const key = optionalIngredientKey(parseIngredientsToLines(recipe)[1]);
    const merged = appendIncludedOptionalsToOverrideScaled(
      consumed,
      recipe,
      new Set([key]),
      (opt) => opt.replace(/80g/g, "160g"),
    );
    expect(merged).toContain("400g Poulet");
    expect(merged).toMatch(/160g Poitrine/);
    expect(merged).not.toMatch(/\?/);
  });
});
