import { describe, expect, it } from "vitest";
import {
  findInsertIndexBefore,
  resolveReorderDropIndex,
  resolveReorderToIndex,
} from "./listReorderDnD";

/** Construit un faux élément carte avec top/height pour les tests de position Y. */
function fakeCard(top: number, height: number) {
  return {
    getBoundingClientRect: () => ({ top, height }),
  };
}

describe("listReorderDnD", () => {
  const cards = [fakeCard(0, 40), fakeCard(50, 40), fakeCard(100, 40), fakeCard(150, 40)];

  it("findInsertIndexBefore place avant la carte dont le milieu est sous le curseur", () => {
    expect(findInsertIndexBefore(-10, cards)).toBe(0);
    expect(findInsertIndexBefore(10, cards)).toBe(0);
    expect(findInsertIndexBefore(45, cards)).toBe(1);
    // Carte 2 : top 100, milieu 120 → Y=120 n’est pas « avant », cible = avant carte 3
    expect(findInsertIndexBefore(120, cards)).toBe(3);
    expect(findInsertIndexBefore(119, cards)).toBe(2);
    expect(findInsertIndexBefore(200, cards)).toBe(4);
  });

  it("resolveReorderToIndex ajuste l’index après retrait de la source", () => {
    // Déplacer 0 juste avant l’ex-3 → cible 2 après splice
    expect(resolveReorderToIndex(0, 3)).toBe(2);
    // Déplacer 3 juste avant 1 → cible 1
    expect(resolveReorderToIndex(3, 1)).toBe(1);
    // No-op
    expect(resolveReorderToIndex(1, 1)).toBeNull();
    expect(resolveReorderToIndex(1, 2)).toBeNull();
  });

  it("resolveReorderDropIndex combine Y + ajustement splice", () => {
    // Drag index 0, drop sous la dernière carte → fin de liste
    expect(resolveReorderDropIndex(0, 200, cards)).toBe(3);
    // Drag index 3, drop en haut → index 0
    expect(resolveReorderDropIndex(3, 5, cards)).toBe(0);
    // Drop sur sa propre zone → null
    expect(resolveReorderDropIndex(1, 55, cards)).toBeNull();
  });
});
