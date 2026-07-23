import { describe, it, expect } from "vitest";
import {
  buildWeekDates,
  buildTwoWeekDates,
  getDateForDayKey,
  resolveDefaultThresholdDayIso,
  isIsoInNextPlanningWeek,
  isIsoInCurrentPlanningWeek,
  isPlanningDayStrictlyBeforeToday,
  resolvePlanningDayToIso,
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

describe("isIsoInCurrentPlanningWeek", () => {
  it("accepte lun→dim de la semaine du 23/07/2026", () => {
    const now = new Date("2026-07-23T12:00:00");
    expect(isIsoInCurrentPlanningWeek("2026-07-20", now)).toBe(true);
    expect(isIsoInCurrentPlanningWeek("2026-07-23", now)).toBe(true);
    expect(isIsoInCurrentPlanningWeek("2026-07-26", now)).toBe(true);
  });

  it("refuse les dates hors semaine courante", () => {
    const now = new Date("2026-07-23T12:00:00");
    expect(isIsoInCurrentPlanningWeek("2026-07-19", now)).toBe(false);
    expect(isIsoInCurrentPlanningWeek("2026-07-27", now)).toBe(false);
    expect(isIsoInCurrentPlanningWeek("2026-08-02", now)).toBe(false);
  });
});

describe("isPlanningDayStrictlyBeforeToday", () => {
  it("masque les jours ISO strictement avant aujourd’hui", () => {
    const now = new Date("2026-07-23T12:00:00");
    expect(isPlanningDayStrictlyBeforeToday("2026-07-22", now)).toBe(true);
    expect(isPlanningDayStrictlyBeforeToday("2026-07-23", now)).toBe(false);
    expect(isPlanningDayStrictlyBeforeToday("2026-07-27", now)).toBe(false);
    expect(isPlanningDayStrictlyBeforeToday("2026-06-29", now)).toBe(true);
  });

  it("résout aussi les clés nommées (lundi de la semaine de ref)", () => {
    const now = new Date("2026-07-23T12:00:00"); // jeudi
    expect(isPlanningDayStrictlyBeforeToday("lundi", now)).toBe(true); // 20/07
    expect(isPlanningDayStrictlyBeforeToday("jeudi", now)).toBe(false);
    expect(isPlanningDayStrictlyBeforeToday("vendredi", now)).toBe(false);
  });
});

describe("resolvePlanningDayToIso", () => {
  it("conserve une ISO et résout une clé nommée", () => {
    const now = new Date("2026-07-23T12:00:00");
    expect(resolvePlanningDayToIso("2026-07-20", now)).toBe("2026-07-20");
    expect(resolvePlanningDayToIso("lundi", now)).toBe("2026-07-20");
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
