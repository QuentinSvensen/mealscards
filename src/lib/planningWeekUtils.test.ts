import { describe, it, expect } from "vitest";
import { buildWeekDates, getDateForDayKey, DAY_KEY_TO_INDEX } from "./planningWeekUtils";

describe("buildWeekDates", () => {
  it("retourne 7 jours à partir du lundi de la semaine de référence", () => {
    const monday = new Date("2026-04-06T12:00:00");
    const w = buildWeekDates(0, monday);
    expect(w).toHaveLength(7);
    expect(w[0].key).toBe("lundi");
    expect(w[0].iso).toBe("2026-04-06");
    expect(w[6].iso).toBe("2026-04-12");
  });

  it("décale d’une semaine avec offset 1", () => {
    const monday = new Date("2026-04-06T12:00:00");
    const w = buildWeekDates(1, monday);
    expect(w[0].iso).toBe("2026-04-13");
  });
});

describe("getDateForDayKey", () => {
  it("aligne le jour demandé sur la même semaine calendaire que refDate", () => {
    const ref = new Date("2026-04-08T15:00:00"); // mercredi
    const d = getDateForDayKey("lundi", ref);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(6);
  });
});

describe("DAY_KEY_TO_INDEX", () => {
  it("couvre lundi à dimanche", () => {
    expect(DAY_KEY_TO_INDEX["lundi"]).toBe(0);
    expect(DAY_KEY_TO_INDEX["dimanche"]).toBe(6);
  });
});
