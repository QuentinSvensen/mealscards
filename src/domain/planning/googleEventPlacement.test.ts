import { describe, expect, it } from "vitest";
import {
  addDaysToIsoDate,
  eachIsoDayUntilExclusive,
  expandGoogleEventPlacements,
  layoutAllDaySpans,
} from "./googleEventPlacement";

describe("eachIsoDayUntilExclusive", () => {
  it("all-day Google 8→11 août = 8, 9, 10", () => {
    expect(eachIsoDayUntilExclusive("2026-08-08", "2026-08-11")).toEqual([
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
  });

  it("sans fin valide → 1 jour", () => {
    expect(eachIsoDayUntilExclusive("2026-08-08", "")).toEqual(["2026-08-08"]);
  });
});

describe("expandGoogleEventPlacements", () => {
  const week = new Set([
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-09",
  ]);

  it("Vacance Annecy all-day multi-jours → chaque jour de la semaine chevauché", () => {
    const out = expandGoogleEventPlacements(
      "2026-08-08",
      "2026-08-12",
      true,
      week,
    );
    expect(out.map((p) => p.dayIso)).toEqual(["2026-08-08", "2026-08-09"]);
    expect(out.every((p) => p.isAllDay)).toBe(true);
  });

  it("all-day hors semaine → vide", () => {
    expect(
      expandGoogleEventPlacements("2026-07-01", "2026-07-05", true, week),
    ).toEqual([]);
  });

  it("horaire une journée → un placement", () => {
    const out = expandGoogleEventPlacements(
      "2026-08-08T14:00:00",
      "2026-08-08T18:00:00",
      false,
      week,
    );
    expect(out).toHaveLength(1);
    expect(out[0].dayIso).toBe("2026-08-08");
    expect(out[0].startMin).toBe(14 * 60);
    expect(out[0].durationMin).toBe(4 * 60);
  });

  it("horaire qui traverse minuit → 2 jours", () => {
    const out = expandGoogleEventPlacements(
      "2026-08-08T22:00:00",
      "2026-08-09T02:00:00",
      false,
      week,
    );
    expect(out.map((p) => p.dayIso)).toEqual(["2026-08-08", "2026-08-09"]);
    expect(out[0].startMin).toBe(22 * 60);
    expect(out[0].durationMin).toBe(2 * 60);
    expect(out[1].startMin).toBe(0);
    expect(out[1].durationMin).toBe(2 * 60);
  });

  it("addDaysToIsoDate", () => {
    expect(addDaysToIsoDate("2026-08-08", 1)).toBe("2026-08-09");
    expect(addDaysToIsoDate("2026-08-31", 1)).toBe("2026-09-01");
  });
});

describe("layoutAllDaySpans", () => {
  const week = [
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
  ];

  it("Vacance Annecy = une barre continue sur toute la semaine", () => {
    const { spans, rowCount } = layoutAllDaySpans(
      [
        {
          id: "vac",
          summary: "Vacance Annecy",
          start: "2026-08-08",
          end: "2026-08-16",
          allDay: true,
        },
      ],
      week,
    );
    expect(rowCount).toBe(1);
    expect(spans).toHaveLength(1);
    expect(spans[0].startCol).toBe(0);
    expect(spans[0].endCol).toBe(6);
    expect(spans[0].continuesBefore).toBe(true);
    expect(spans[0].continuesAfter).toBe(false);
  });

  it("empile deux all-day qui se chevauchent sur des rangées", () => {
    const { spans, rowCount } = layoutAllDaySpans(
      [
        {
          id: "a",
          summary: "A",
          start: "2026-08-09",
          end: "2026-08-12",
          allDay: true,
        },
        {
          id: "b",
          summary: "B",
          start: "2026-08-10",
          end: "2026-08-11",
          allDay: true,
        },
      ],
      week,
    );
    expect(rowCount).toBe(2);
    expect(spans.find((s) => s.eventId === "a")!.row).toBe(0);
    expect(spans.find((s) => s.eventId === "b")!.row).toBe(1);
  });

  it("côte à côte sans chevauchement → même rangée", () => {
    const { spans, rowCount } = layoutAllDaySpans(
      [
        {
          id: "a",
          summary: "A",
          start: "2026-08-09",
          end: "2026-08-10",
          allDay: true,
        },
        {
          id: "b",
          summary: "B",
          start: "2026-08-11",
          end: "2026-08-12",
          allDay: true,
        },
      ],
      week,
    );
    expect(rowCount).toBe(1);
    expect(spans.every((s) => s.row === 0)).toBe(true);
  });
});
