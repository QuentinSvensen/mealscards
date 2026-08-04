import { describe, expect, it } from "vitest";
import {
  addNinjaCreamiMealId,
  createEmptyNinjaCreamiCatalogLine,
  filterNinjaCreamiTestedMeals,
  filterOutNinjaCreamiMeals,
  formatNinjaCreamiTotalsForMeal,
  moveLineBetweenNinjaCreamiBaseGroups,
  normalizeNinjaCreamiBaseGroups,
  normalizeNinjaCreamiCatalogLines,
  removeNinjaCreamiMealId,
  reorderNinjaCreamiBaseGroups,
  serializeSelectedNinjaCreamiIngredients,
  sumSelectedNinjaCreamiMacros,
  upsertMacroLibraryFromNinjaLineName,
  type NinjaCreamiCatalogLine,
} from "./ninjaCreami";

/** Construit une ligne catalogue de test. */
function line(
  partial: Partial<NinjaCreamiCatalogLine> & { id: string; name: string },
): NinjaCreamiCatalogLine {
  return {
    ...createEmptyNinjaCreamiCatalogLine(),
    ...partial,
  };
}

describe("filterOutNinjaCreamiMeals", () => {
  it("retire les recettes testées du catalogue Tous", () => {
    const meals = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(filterOutNinjaCreamiMeals(meals, ["b"])).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("ne filtre rien si la pref est vide", () => {
    const meals = [{ id: "a" }];
    expect(filterOutNinjaCreamiMeals(meals, [])).toEqual(meals);
  });
});

describe("filterNinjaCreamiTestedMeals", () => {
  it("conserve l’ordre de la pref", () => {
    const meals = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(filterNinjaCreamiTestedMeals(meals, ["c", "a"])).toEqual([{ id: "c" }, { id: "a" }]);
  });
});

describe("sumSelectedNinjaCreamiMacros", () => {
  it("somme uniquement les lignes sélectionnées avec nom", () => {
    const lines = [
      line({ id: "1", name: "Base", cal: "100", pro: "10", fiber: "2" }),
      line({ id: "2", name: "Extra", cal: "50,5", pro: "1,5", fiber: "0" }),
      line({ id: "3", name: "", cal: "999", pro: "99", fiber: "9" }),
    ];
    expect(sumSelectedNinjaCreamiMacros(lines, ["1", "2", "3"])).toEqual({
      calories: 150.5,
      protein: 11.5,
      fiber: 2,
    });
  });

  it("scale les macros /100g selon les grammes saisis", () => {
    const lines = [
      line({ id: "1", name: "Lait", qty: "225", cal: "34", pro: "3,3", fiber: "0" }),
    ];
    expect(sumSelectedNinjaCreamiMacros(lines, ["1"])).toEqual({
      calories: 76.5,
      protein: 7.4,
      fiber: 0,
    });
  });
});

describe("serializeSelectedNinjaCreamiIngredients", () => {
  it("sérialise Base + Extras sélectionnés", () => {
    const base = [line({ id: "b1", name: "Fromage blanc", qty: "200", cal: "100", pro: "8", fiber: "0" })];
    const extras = [line({ id: "e1", name: "Spéculoos", qty: "15", cal: "70", pro: "1", fiber: "0.5" })];
    const raw = serializeSelectedNinjaCreamiIngredients(base, extras, ["b1", "e1"]);
    expect(raw).toBeTruthy();
    expect(raw!).toContain("Fromage blanc");
    expect(raw!).toContain("Spéculoos");
  });

  it("retourne null si rien n’est sélectionné", () => {
    const base = [line({ id: "b1", name: "X", qty: "10" })];
    expect(serializeSelectedNinjaCreamiIngredients(base, [], [])).toBeNull();
  });
});

describe("normalizeNinjaCreamiCatalogLines", () => {
  it("ajoute une ligne vide finale", () => {
    const out = normalizeNinjaCreamiCatalogLines([
      { id: "1", name: "Lait", qty: "100", count: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].name).toBe("Lait");
    expect(out[1].name).toBe("");
  });
});

describe("add/remove ninja meal ids", () => {
  it("évite les doublons et retire correctement", () => {
    expect(addNinjaCreamiMealId(["a"], "a")).toEqual(["a"]);
    expect(addNinjaCreamiMealId(["a"], "b")).toEqual(["a", "b"]);
    expect(removeNinjaCreamiMealId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("upsertMacroLibraryFromNinjaLineName", () => {
  it("ajoute un nouveau titre au référentiel", () => {
    const next = upsertMacroLibraryFromNinjaLineName([], "Protéine whey", "100", "20", "0");
    expect(next).toHaveLength(1);
    expect(next[0].displayName).toBe("Protéine whey");
    expect(next[0].calories).toBe("100");
  });

  it("complète les macros à 0 déjà présentes dans le référentiel", () => {
    const existing = upsertMacroLibraryFromNinjaLineName([], "Whey pure", "0", "0", "0");
    // Entrée créée avec des 0 → refusée ; on simule une entrée déjà à 0.
    const library = [
      {
        key: "whey pure",
        displayName: "Whey pure",
        calories: "0",
        protein: "0",
        fiber: "0",
      },
    ];
    const next = upsertMacroLibraryFromNinjaLineName(library, "Whey pure", "391", "93", "0");
    expect(next[0].calories).toBe("391");
    expect(next[0].protein).toBe("93");
    expect(next[0].fiber).toBe("0");
    expect(existing).toEqual([]);
  });

  it("n’écrase pas une macro déjà renseignée", () => {
    const library = [
      {
        key: "whey pure",
        displayName: "Whey pure",
        calories: "400",
        protein: "90",
        fiber: "1",
      },
    ];
    const next = upsertMacroLibraryFromNinjaLineName(library, "Whey pure", "391", "93", "0");
    expect(next[0].calories).toBe("400");
    expect(next[0].protein).toBe("90");
    expect(next[0].fiber).toBe("1");
  });

  it("écrase les macros en mode overwrite (commit Ninja)", () => {
    const seeded = upsertMacroLibraryFromNinjaLineName([], "Lait écrémé Matin Léger", "46", "3", "0");
    expect(seeded).toHaveLength(1);
    const next = upsertMacroLibraryFromNinjaLineName(
      seeded,
      "Lait écrémé Matin Léger",
      "34",
      "3,3",
      "0",
      { overwrite: true },
    );
    expect(next).toHaveLength(1);
    expect(next[0].calories).toBe("34");
    expect(next[0].protein).toBe("3,3");
    expect(next[0].fiber).toBe("0");
  });
});

describe("normalizeNinjaCreamiBaseGroups", () => {
  it("migre la liste plate vers une sous-catégorie Général", () => {
    const groups = normalizeNinjaCreamiBaseGroups(null, [
      { id: "1", name: "Lait", qty: "100", count: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Général");
    expect(groups[0].lines[0].name).toBe("Lait");
  });

  it("conserve les sous-catégories existantes", () => {
    const groups = normalizeNinjaCreamiBaseGroups([
      { id: "g1", name: "Liquides", lines: [{ id: "1", name: "Eau", qty: "", count: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false }] },
    ]);
    expect(groups[0].name).toBe("Liquides");
    expect(groups[0].lines[0].name).toBe("Eau");
  });

  it("récupère la liste plate si les sous-catégories sont vides", () => {
    const groups = normalizeNinjaCreamiBaseGroups(
      [{ id: "g1", name: "Général", lines: [{ id: "x", name: "", qty: "", count: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false }] }],
      [{ id: "1", name: "Whey", qty: "30", count: "", cal: "391", pro: "93", fiber: "0", isOr: false, isAnd: false, isOptional: false }],
    );
    expect(groups[0].lines.some((l) => l.name === "Whey")).toBe(true);
  });

  it("récupère depuis le backup local si prefs et legacy sont vides", () => {
    const backup = [
      {
        id: "g1",
        name: "Général",
        lines: [
          {
            id: "1",
            name: "Lait",
            qty: "100",
            count: "",
            cal: "34",
            pro: "3",
            fiber: "0",
            isOr: false,
            isAnd: false,
            isOptional: false,
          },
        ],
      },
    ];
    const groups = normalizeNinjaCreamiBaseGroups(
      [{ id: "empty", name: "Général", lines: [] }],
      [],
      backup,
    );
    expect(groups[0].lines.some((l) => l.name === "Lait")).toBe(true);
  });
});

describe("moveLineBetweenNinjaCreamiBaseGroups", () => {
  it("déplace une ligne d’une sous-cat à une autre", () => {
    const groups = [
      {
        id: "a",
        name: "A",
        lines: [
          line({ id: "l1", name: "Lait" }),
          line({ id: "l2", name: "Eau" }),
          createEmptyNinjaCreamiCatalogLine(),
        ],
      },
      {
        id: "b",
        name: "B",
        lines: [createEmptyNinjaCreamiCatalogLine()],
      },
    ];
    const next = moveLineBetweenNinjaCreamiBaseGroups(groups, "a", "l1", "b", 0);
    expect(next.find((g) => g.id === "a")!.lines.some((l) => l.id === "l1")).toBe(false);
    expect(next.find((g) => g.id === "b")!.lines[0].id).toBe("l1");
  });
});

describe("reorderNinjaCreamiBaseGroups", () => {
  it("place une sous-catégorie au-dessus d’une autre", () => {
    const groups = [
      { id: "a", name: "A", lines: [createEmptyNinjaCreamiCatalogLine()] },
      { id: "b", name: "B", lines: [createEmptyNinjaCreamiCatalogLine()] },
      { id: "c", name: "C", lines: [createEmptyNinjaCreamiCatalogLine()] },
    ];
    const next = reorderNinjaCreamiBaseGroups(groups, 2, 0);
    expect(next.map((g) => g.id)).toEqual(["c", "a", "b"]);
  });
});

describe("formatNinjaCreamiTotalsForMeal", () => {
  it("formate pour insert meal", () => {
    expect(formatNinjaCreamiTotalsForMeal({ calories: 150.5, protein: 11, fiber: 0 })).toEqual({
      calories: "150,5",
      protein: "11",
      fiber: "0",
    });
  });
});
