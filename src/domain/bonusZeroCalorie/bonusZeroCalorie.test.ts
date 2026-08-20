import { describe, expect, it } from "vitest";
import {
  BONUS_LOW_CALORIE_SEED_NAMES,
  BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
  BONUS_ZERO_CALORIE_ENSURE_NAMES,
  ensureNamedIngredientsInBonusGroups,
  normalizeBonusLowCalorieGroups,
  normalizeBonusZeroCalorieGroups,
} from "@/domain/bonusZeroCalorie/bonusZeroCalorie";

describe("normalizeBonusZeroCalorieGroups", () => {
  it("migre une liste plate legacy vers une sous-catégorie Général", () => {
    const groups = normalizeBonusZeroCalorieGroups(null, [
      { id: "a", qty: "", count: "1", name: "Soda", cal: "", pro: "", fiber: "" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID);
    expect(groups[0].name).toBe("Général");
    expect(groups[0].lines.some((l) => l.name === "Soda")).toBe(true);
  });

  it("ajoute Glaçon s’il manque dans Tous · 0 calorie", () => {
    const groups = ensureNamedIngredientsInBonusGroups(
      [
        {
          id: "g1",
          name: "Général",
          lines: [{ id: "a", qty: "", count: "", name: "Eau", cal: "", pro: "", fiber: "" }],
        },
      ],
      BONUS_ZERO_CALORIE_ENSURE_NAMES,
    );
    expect(groups[0].lines.map((l) => l.name).filter(Boolean)).toEqual(["Eau", "Glaçon"]);
  });
});
