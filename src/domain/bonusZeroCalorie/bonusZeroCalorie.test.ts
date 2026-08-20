import { describe, expect, it } from "vitest";
import {
  BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
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

  it("conserve les sous-catégories déjà persistées", () => {
    const groups = normalizeBonusZeroCalorieGroups(
      [
        {
          id: "g1",
          name: "Boissons",
          lines: [{ id: "a", qty: "", count: "", name: "Eau", cal: "", pro: "", fiber: "" }],
        },
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Boissons");
  });
});
