import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptionalIngredientsMoveDialog } from "@/hooks/useOptionalIngredientsMoveDialog";

describe("useOptionalIngredientsMoveDialog", () => {
  it("résout la promesse précédente à null si ask est rappelé (garde re-entrante)", async () => {
    const { result } = renderHook(() => useOptionalIngredientsMoveDialog());
    const groups = [
      {
        alternatives: [
          {
            items: [
              {
                key: "beurre|20g",
                label: "20g Beurre",
                name: "Beurre",
                qty: "20g",
                count: "",
                isOptional: false,
              },
            ],
            isBundle: false,
          },
        ],
      },
    ];

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;

    act(() => {
      p1 = result.current.askOptionalIngredientInclusions("Meal A", groups, "20g Beurre");
      p2 = result.current.askOptionalIngredientInclusions("Meal B", groups, "20g Beurre");
    });

    await expect(p1).resolves.toBeNull();

    act(() => {
      result.current.finishOptionalMoveDialog(null);
    });

    await expect(p2).resolves.toBeNull();
  });
});
