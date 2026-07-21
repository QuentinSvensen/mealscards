import { describe, expect, it } from "vitest";
import { formatNutritionScoreTooltip } from "@/components/NutritionScoreBadge";

describe("formatNutritionScoreTooltip", () => {
  it("affiche la phrase complète avec le score plafonné quand le réel ≤ 100", () => {
    expect(formatNutritionScoreTooltip(83, 83)).toBe("Note nutritionnelle : 83/100");
    expect(formatNutritionScoreTooltip(100, 100)).toBe("Note nutritionnelle : 100/100");
    expect(formatNutritionScoreTooltip(94, null)).toBe("Note nutritionnelle : 94/100");
  });

  it("garde la phrase complète avec la vraie note quand elle dépasse 100", () => {
    expect(formatNutritionScoreTooltip(100, 231)).toBe("Note nutritionnelle : 231/100");
    expect(formatNutritionScoreTooltip(100, 110)).toBe("Note nutritionnelle : 110/100");
  });
});
