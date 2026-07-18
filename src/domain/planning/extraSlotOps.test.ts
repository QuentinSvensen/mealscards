import { describe, expect, it } from "vitest";
import {
  assignExtraToDaySlotMap,
  isExtraDaySlot,
  moveExtraBetweenDaysToSlotMaps,
  removeExtraFromDaySlotMap,
  removeOneExtraOccurrenceForDay,
  unassignExtraFromAllDaySlotsMap,
} from "./extraSlotOps";

describe("extraSlotOps", () => {
  it("reconnaît les créneaux d'extra dans l'ordre matin→midi→goûter→soir", () => {
    expect(isExtraDaySlot("matin")).toBe(true);
    expect(isExtraDaySlot("gouter")).toBe(true);
    expect(isExtraDaySlot("collation")).toBe(false);
  });

  it("retire une occurrence d'extra sur la clé ISO en priorité", () => {
    const next = removeOneExtraOccurrenceForDay(
      { "2026-05-28": ["a", "b", "a"], lundi: ["a"] },
      "2026-05-28",
      "lundi",
      "a",
    );
    expect(next["2026-05-28"]).toEqual(["a", "b"]);
    expect(next.lundi).toEqual(["a"]);
  });

  it("assigne un extra au goûter et le retire des autres créneaux du jour", () => {
    const assigned = assignExtraToDaySlotMap(
      {
        "2026-05-28-midi": ["x"],
        "2026-05-28-soir": ["x"],
      },
      "x",
      "2026-05-28",
      "lundi",
      "gouter",
      2,
    );
    expect(assigned["2026-05-28-midi"]).toEqual([]);
    expect(assigned["2026-05-28-soir"]).toEqual([]);
    expect(assigned["2026-05-28-gouter"]).toEqual(["x", "x"]);
  });

  it("retire un extra d'un créneau sans toucher aux autres", () => {
    const next = removeExtraFromDaySlotMap(
      { "2026-05-28-gouter": ["x", "y"], "2026-05-28-midi": ["x"] },
      "x",
      "2026-05-28",
      "lundi",
      "gouter",
    );
    expect(next["2026-05-28-gouter"]).toEqual(["y"]);
    expect(next["2026-05-28-midi"]).toEqual(["x"]);
  });

  it("désassigne un extra de tous les créneaux du jour", () => {
    const next = unassignExtraFromAllDaySlotsMap(
      {
        "2026-05-28-matin": ["x"],
        "2026-05-28-gouter": ["x"],
        "2026-05-28-soir": ["y"],
      },
      "x",
      "2026-05-28",
      "lundi",
    );
    expect(next["2026-05-28-matin"]).toEqual([]);
    expect(next["2026-05-28-gouter"]).toEqual([]);
    expect(next["2026-05-28-soir"]).toEqual(["y"]);
  });

  it("déplace un extra entre deux jours vers le créneau goûter", () => {
    const { selections, assignments } = moveExtraBetweenDaysToSlotMaps(
      { "2026-05-28": ["x"], "2026-05-29": [] },
      { "2026-05-28-midi": ["x"] },
      "x",
      "2026-05-28",
      "lundi",
      "2026-05-29",
      "mardi",
      "gouter",
    );
    expect(selections["2026-05-28"]).toEqual([]);
    expect(selections["2026-05-29"]).toEqual(["x"]);
    expect(assignments["2026-05-28-midi"]).toEqual([]);
    expect(assignments["2026-05-29-gouter"]).toEqual(["x"]);
  });
});
