import { describe, expect, it } from "vitest";
import { compareExpirationWithCounter } from "./stockFormatting";

describe("compareExpirationWithCounter", () => {
  it("place les sans-date après les datés (tri Péremption Au choix)", () => {
    const items = [
      { name: "Framboise chocolat", date: null as string | null, counter: null as number | null },
      { name: "Bol spéculoos", date: "2026-07-19", counter: null },
      { name: "Cookie maison", date: "2026-08-01", counter: null },
    ];
    items.sort((a, b) => compareExpirationWithCounter(a.date, b.date, a.counter, b.counter));
    expect(items.map((i) => i.name)).toEqual([
      "Bol spéculoos",
      "Cookie maison",
      "Framboise chocolat",
    ]);
  });

  it("priorise le compteur actif devant les dates et les sans-date", () => {
    expect(compareExpirationWithCounter(null, "2026-07-19", 3, null)).toBeLessThan(0);
    expect(compareExpirationWithCounter("2026-07-19", null, null, null)).toBeLessThan(0);
  });

  it("trie les dates croissantes dans le groupe daté", () => {
    expect(compareExpirationWithCounter("2026-07-19", "2026-08-01", null, null)).toBeLessThan(0);
  });
});
