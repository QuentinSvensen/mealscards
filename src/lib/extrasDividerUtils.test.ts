import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY,
  moveExtrasDividerDown,
  moveExtrasDividerUp,
  placeNewExtraAboveDivider,
  recoverExtrasDividerAfterId,
  resolveExtrasDividerAfterId,
  splitSortedExtrasByDivider,
  writeLocalExtrasDividerBackup,
} from "./extrasDividerUtils";

describe("extrasDividerUtils", () => {
  const items = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("utilise le dernier extra par défaut (catalogue Planning complet)", () => {
    expect(resolveExtrasDividerAfterId(items, null, { useLocalBackup: false })).toBe("c");
    expect(splitSortedExtrasByDivider(items, null)).toEqual({
      above: items,
      below: [],
    });
  });

  it("déplace le trait vers le bas puis le haut", () => {
    expect(moveExtrasDividerDown(items, "a")).toBe("b");
    expect(moveExtrasDividerUp(items, "b")).toBe("a");
  });

  it("place un nouvel extra juste au-dessus du trait", () => {
    const result = placeNewExtraAboveDivider(items, { id: "n", name: "N" }, "a");
    expect(result.nextDividerAfterId).toBe("n");
    expect(result.ordered.map((x) => x.id)).toEqual(["a", "n", "b", "c"]);
  });

  it("restaure depuis le miroir local si la préférence Supabase est absente", () => {
    writeLocalExtrasDividerBackup("b", 2);
    expect(resolveExtrasDividerAfterId(items, null)).toBe("b");
    expect(splitSortedExtrasByDivider(items, null)).toEqual({
      above: [items[0], items[1]],
      below: [items[2]],
    });
  });

  it("préfère le miroir local plus riche si le trait Supabase est trop haut", () => {
    writeLocalExtrasDividerBackup("c", 3);
    expect(resolveExtrasDividerAfterId(items, "a")).toBe("c");
    expect(recoverExtrasDividerAfterId(items, "a")).toBe("c");
  });

  it("ne remonte pas le trait si le miroir local est plus haut (mouvement volontaire)", () => {
    writeLocalExtrasDividerBackup("a", 1);
    expect(resolveExtrasDividerAfterId(items, "c")).toBe("c");
    expect(recoverExtrasDividerAfterId(items, "c")).toBeNull();
  });

  it("ignore un miroir local trop ancien", () => {
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY,
      JSON.stringify({ afterId: "c", aboveCount: 3, updatedAt: old }),
    );
    expect(resolveExtrasDividerAfterId(items, "a")).toBe("a");
    expect(recoverExtrasDividerAfterId(items, "a")).toBeNull();
  });

  it("écrit un snapshot local valide", () => {
    writeLocalExtrasDividerBackup("b", 2);
    const raw = localStorage.getItem(FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.afterId).toBe("b");
    expect(parsed.aboveCount).toBe(2);
    expect(typeof parsed.updatedAt).toBe("number");
  });
});
