import { describe, it, expect } from "vitest";
import {
  moveExtrasDividerDown,
  moveExtrasDividerUp,
  resolveExtrasDividerAfterId,
  splitSortedExtrasByDivider,
} from "./extrasDividerUtils";

describe("extrasDividerUtils", () => {
  const items = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("utilise le premier extra par défaut", () => {
    expect(resolveExtrasDividerAfterId(items, null)).toBe("a");
    expect(splitSortedExtrasByDivider(items, null)).toEqual({
      above: [items[0]],
      below: [items[1], items[2]],
    });
  });

  it("déplace le trait vers le bas puis le haut", () => {
    expect(moveExtrasDividerDown(items, "a")).toBe("b");
    expect(moveExtrasDividerUp(items, "b")).toBe("a");
  });
});
