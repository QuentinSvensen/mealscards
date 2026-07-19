import { describe, it, expect } from "vitest";
import {
  buildWeekDates,
  buildTwoWeekDates,
  getDateForDayKey,
  resolveDefaultThresholdDayIso,
  isIsoInNextPlanningWeek,
  resolvePlanningGoalForIso,
  DAY_KEY_TO_INDEX,
} from "./planningWeekUtils";

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

describe("buildTwoWeekDates", () => {
  it("retourne 14 jours : semaine courante puis suivante", () => {
    const monday = new Date("2026-04-06T12:00:00");
    const w = buildTwoWeekDates(monday);
    expect(w).toHaveLength(14);
    expect(w[0].iso).toBe("2026-04-06");
    expect(w[6].iso).toBe("2026-04-12");
    expect(w[7].iso).toBe("2026-04-13");
    expect(w[13].iso).toBe("2026-04-19");
  });
});

describe("resolveDefaultThresholdDayIso", () => {
  it("préfère aujourd’hui s’il est dans la fenêtre", () => {
    const window = buildTwoWeekDates(new Date("2026-04-08T12:00:00"));
    expect(resolveDefaultThresholdDayIso(window, "2026-04-09")).toBe("2026-04-09");
  });

  it("reprend le premier jour si aujourd’hui est hors fenêtre", () => {
    const window = buildTwoWeekDates(new Date("2026-04-06T12:00:00"));
    expect(resolveDefaultThresholdDayIso(window, "2026-03-01")).toBe("2026-04-06");
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

describe("isIsoInNextPlanningWeek", () => {
  it("détecte un lundi de semaine suivante", () => {
    // Dimanche 19/07/2026 → semaine suivante commence le lundi 20/07
    const ref = new Date("2026-07-19T12:00:00");
    expect(isIsoInNextPlanningWeek("2026-07-20", ref)).toBe(true);
    expect(isIsoInNextPlanningWeek("2026-07-19", ref)).toBe(false);
    expect(isIsoInNextPlanningWeek("2026-07-13", ref)).toBe(false);
  });
});

describe("resolvePlanningGoalForIso", () => {
  it("prend l’objectif next pour une ISO de semaine suivante", () => {
    const ref = new Date("2026-07-19T12:00:00");
    expect(resolvePlanningGoalForIso("2026-07-20", 2000, 2200, ref)).toBe(2200);
    expect(resolvePlanningGoalForIso("2026-07-13", 2000, 2200, ref)).toBe(2000);
    expect(resolvePlanningGoalForIso(undefined, 2000, 2200, ref)).toBe(2000);
  });
});
