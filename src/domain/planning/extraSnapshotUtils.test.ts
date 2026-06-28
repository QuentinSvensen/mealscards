import { describe, expect, it } from "vitest";
import { clearExtraSnapshotsForWeekday, clearNextWeekExtraStateForDay } from "./extraSnapshotUtils";

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

describe("clearExtraSnapshotsForWeekday", () => {
  it("supprime le snapshot ISO courant, la clé jour et les anciennes dates du même jour de semaine", () => {
    const snapshots = {
      "extra-2026-05-26": { cal: 100, prot: 5, itemIds: ["a"] },
      "extra-mardi": { cal: 50, itemIds: ["b"] },
      "extra-2026-05-19": { cal: 200, itemIds: ["old"] },
      "extra-2026-05-27": { cal: 80, itemIds: ["mercredi"] },
      "breakfast-2026-05-26": { cal: 300 },
    };
    const out = clearExtraSnapshotsForWeekday(snapshots, "2026-05-26", "mardi", JS_DAY_TO_KEY);
    expect(out["extra-2026-05-26"]).toBeUndefined();
    expect(out["extra-mardi"]).toBeUndefined();
    expect(out["extra-2026-05-19"]).toBeUndefined();
    expect(out["extra-2026-05-27"]).toEqual({ cal: 80, itemIds: ["mercredi"] });
    expect(out["breakfast-2026-05-26"]).toEqual({ cal: 300 });
  });
});

describe("clearNextWeekExtraStateForDay", () => {
  it("force une sélection vide et des macros à 0 pour ne pas retomber sur un snapshot", () => {
    const out = clearNextWeekExtraStateForDay(
      { lundi: ["food-a"], "2026-06-02": ["food-b"] },
      { lundi: 120 },
      { lundi: 12 },
      { lundi: 8 },
      "2026-06-02",
      "lundi",
    );
    expect(out.selections.lundi).toEqual([]);
    expect(out.selections["2026-06-02"]).toEqual([]);
    expect(out.calories.lundi).toBe(0);
    expect(out.calories["2026-06-02"]).toBe(0);
    expect(out.proteins.lundi).toBe(0);
    expect(out.fibers.lundi).toBe(0);
  });
});
