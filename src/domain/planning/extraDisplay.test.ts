import { describe, expect, it } from "vitest";
import {
  buildDessertExtraId,
  formatPlacedExtraLabel,
  groupAssignedExtraIds,
  multiplyDisplayGrams,
  normalizeExtraDisplayName,
  parseCustomExtraId,
  pickDayExtraSelections,
  resolveDessertCatalogId,
} from "./extraDisplay";

describe("extraDisplay", () => {
  it("décode et encode un extra personnalisé", () => {
    expect(parseCustomExtraId("custom::Yaourt::120::8")).toEqual({
      name: "Yaourt",
      cal: 120,
      prot: 8,
    });
    expect(parseCustomExtraId("food-dessert::abc")).toBeNull();
    expect(buildDessertExtraId("Yaourt", 120.4, 7.6)).toBe("custom::Yaourt::120::8");
  });

  it("normalise les noms d'extras pour la comparaison", () => {
    expect(normalizeExtraDisplayName("  Yaourt Nature ")).toBe("yaourt nature");
  });

  it("résout un id custom vers le catalogue dessert par nom", () => {
    const catalog = [{ id: "d1", name: "Yaourt" }];
    const byId = new Map([["d1", { name: "Yaourt" }]]);
    expect(resolveDessertCatalogId("custom::Yaourt::100::5", catalog, byId)).toBe("d1");
    expect(resolveDessertCatalogId("d1", catalog, byId)).toBe("d1");
    expect(resolveDessertCatalogId("unknown", catalog, byId)).toBeNull();
  });

  it("regroupe les extras assignés en conservant l'ordre", () => {
    expect(groupAssignedExtraIds(["a", "b", "a", "c"])).toEqual([
      { id: "a", count: 2 },
      { id: "b", count: 1 },
      { id: "c", count: 1 },
    ]);
  });

  it("formate les libellés et multiplie les grammes affichables", () => {
    expect(formatPlacedExtraLabel("Pomme", "120", 2)).toBe("120g #2 Pomme");
    expect(multiplyDisplayGrams("50g", 3)).toBe("150g");
    expect(multiplyDisplayGrams("1,5", 2)).toBe("3");
  });

  it("lit les sélections extras avec priorité ISO puis clé jour", () => {
    expect(
      pickDayExtraSelections(
        { "2026-05-28": ["a"], lundi: ["b"] },
        "2026-05-28",
        "lundi",
        ["fallback"],
      ),
    ).toEqual(["a"]);
    expect(
      pickDayExtraSelections({ lundi: ["b"] }, "2026-05-28", "lundi", ["fallback"]),
    ).toEqual(["b"]);
    expect(
      pickDayExtraSelections({}, "2026-05-28", "lundi", ["fallback"]),
    ).toEqual(["fallback"]);
  });
});
