import { describe, expect, it } from "vitest";
import {
  defaultMinutesForMealTime,
  mealTimeFromMinutesOnly,
  resolveMealTimeAfterAgendaMove,
  snapMinutes,
  buildExtraAgendaOccurrenceKey,
  offsetYToAgendaMinutes,
  formatAgendaClock,
  isCompactAgendaColumn,
} from "./agendaTimeUtils";

describe("agendaTimeUtils", () => {
  it("snapMinutes accroche au pas de 15", () => {
    expect(snapMinutes(12 * 60 + 7)).toBe(12 * 60);
    expect(snapMinutes(12 * 60 + 8)).toBe(12 * 60 + 15);
  });

  it("defaults créneaux", () => {
    expect(defaultMinutesForMealTime("matin")).toBe(8 * 60);
    expect(defaultMinutesForMealTime("midi")).toBe(12 * 60);
    expect(defaultMinutesForMealTime("gouter")).toBe(16 * 60);
    expect(defaultMinutesForMealTime("soir")).toBe(19 * 60);
  });

  it("goûter reste goûter quelle que soit l’heure", () => {
    expect(resolveMealTimeAfterAgendaMove("gouter", 8 * 60)).toBe("gouter");
    expect(resolveMealTimeAfterAgendaMove("gouter", 20 * 60)).toBe("gouter");
  });

  it("midi sticky entre 10h et 16h", () => {
    expect(resolveMealTimeAfterAgendaMove("midi", 10 * 60)).toBe("midi");
    expect(resolveMealTimeAfterAgendaMove("midi", 15 * 60 + 45)).toBe("midi");
    expect(resolveMealTimeAfterAgendaMove("midi", 18 * 60 + 30)).toBe("soir");
    expect(resolveMealTimeAfterAgendaMove("midi", 9 * 60)).toBe("matin");
  });

  it("soir sticky entre 16h et 23h59", () => {
    expect(resolveMealTimeAfterAgendaMove("soir", 16 * 60)).toBe("soir");
    expect(resolveMealTimeAfterAgendaMove("soir", 23 * 60 + 45)).toBe("soir");
    expect(resolveMealTimeAfterAgendaMove("soir", 12 * 60)).toBe("midi");
    expect(resolveMealTimeAfterAgendaMove("soir", 8 * 60)).toBe("matin");
  });

  it("dérivation pure sans créneau préalable", () => {
    expect(mealTimeFromMinutesOnly(9 * 60)).toBe("matin");
    expect(mealTimeFromMinutesOnly(11 * 60)).toBe("midi");
    expect(mealTimeFromMinutesOnly(17 * 60)).toBe("soir");
    expect(resolveMealTimeAfterAgendaMove(null, 11 * 60)).toBe("midi");
  });

  it("clé occurrence extra", () => {
    expect(buildExtraAgendaOccurrenceKey("2026-07-28", "abc", 1)).toBe("2026-07-28:abc:1");
  });

  it("offsetYToAgendaMinutes", () => {
    // Grille 0h–24h = 24h = 1440 min ; mi-hauteur ≈ 12h
    expect(offsetYToAgendaMinutes(720, 1440)).toBe(12 * 60);
  });

  it("formatAgendaClock conserve les minutes exactes (pas de snap 15)", () => {
    expect(formatAgendaClock(12 * 60 + 40)).toBe("12h40");
    expect(formatAgendaClock(13 * 60 + 30)).toBe("13h30");
    expect(formatAgendaClock(9 * 60 + 5)).toBe("09h05");
  });

  it("isCompactAgendaColumn active le mode mobile sous 100 px", () => {
    expect(isCompactAgendaColumn(99)).toBe(true);
    expect(isCompactAgendaColumn(100)).toBe(false);
    expect(isCompactAgendaColumn(160)).toBe(false);
  });
});
