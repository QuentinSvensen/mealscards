import { describe, expect, it } from "vitest";
import {
  googleAgendaEventStyle,
  googleAgendaPastEventStyle,
  mixCssColorTowardCanvas,
  GCAL_DARK_BY_EVENT_COLOR_ID,
  GCAL_DARK_BY_CALENDAR_COLOR_ID,
  GCAL_API_CALENDAR_COLORS,
  GCAL_CANONICAL_DARK_RED,
  GCAL_CANONICAL_DEEP_RED,
  GCAL_CANONICAL_DARK_MUSTARD,
  calendarLightToDarkStyle,
} from "./googleAgendaColors";

describe("googleAgendaEventStyle", () => {
  it("utilise la palette événement si colorSource = event (non rouge)", () => {
    const style = googleAgendaEventStyle("#dbadff", null, "3", "3", "event");
    expect(style).toEqual(GCAL_DARK_BY_EVENT_COLOR_ID["3"]);
  });

  it("rouge défaut et label tomato = même rouge standard (inchangé)", () => {
    const fromCalendar = googleAgendaEventStyle("#f83a22", null, null, "3", "calendar");
    const fromLabel = googleAgendaEventStyle("#f83a22", null, null, "3", "label");
    expect(fromCalendar).toEqual(GCAL_CANONICAL_DARK_RED);
    expect(fromLabel).toEqual(GCAL_CANONICAL_DARK_RED);
  });

  it("rouge foncé Cocoa ≠ rouge standard tomato", () => {
    const deep = googleAgendaEventStyle(
      GCAL_API_CALENDAR_COLORS["1"].background,
      null,
      null,
      "3",
      "label",
    );
    expect(deep).toEqual(GCAL_CANONICAL_DEEP_RED);
    expect(deep.bg).not.toBe(GCAL_CANONICAL_DARK_RED.bg);
  });

  it("label violet conserve sa teinte malgré agenda rouge", () => {
    const purpleHex = GCAL_API_CALENDAR_COLORS["23"].background;
    const style = googleAgendaEventStyle(purpleHex, null, null, "3", "label");
    expect(style).toEqual(GCAL_DARK_BY_CALENDAR_COLOR_ID["23"]);
  });

  it("mix : tomato = standard, Cocoa / Material sombre = deep", () => {
    expect(calendarLightToDarkStyle("#f83a22")).toEqual(GCAL_CANONICAL_DARK_RED);
    expect(calendarLightToDarkStyle("#ac725e")).toEqual(GCAL_CANONICAL_DEEP_RED);
    expect(calendarLightToDarkStyle("#c62828")).toEqual(GCAL_CANONICAL_DEEP_RED);
    expect(calendarLightToDarkStyle("#7b1e1e")).toEqual(GCAL_CANONICAL_DEEP_RED);
  });

  it("rouge foncé est nettement plus sombre que le rouge standard", () => {
    const bright = GCAL_CANONICAL_DARK_RED.bg.match(/(\d+)/g)!.map(Number);
    const deep = GCAL_CANONICAL_DEEP_RED.bg.match(/(\d+)/g)!.map(Number);
    expect(deep[0]).toBeLessThan(bright[0] - 60);
  });

  it("jaune / moutarde agenda = teinte Google (pas rouge, pas jaune flashy)", () => {
    const banana = googleAgendaEventStyle("#fbe983", null, null, "11", "calendar");
    const mustard = googleAgendaEventStyle("#fad165", null, null, "12", "calendar");
    const eventBanana = googleAgendaEventStyle("#fbd75b", null, "5", "3", "event");
    const fromLightMix = calendarLightToDarkStyle("#fbd75b");
    expect(banana).toEqual(GCAL_CANONICAL_DARK_MUSTARD);
    expect(mustard).toEqual(GCAL_CANONICAL_DARK_MUSTARD);
    expect(eventBanana).toEqual(GCAL_CANONICAL_DARK_MUSTARD);
    expect(fromLightMix).toEqual(GCAL_CANONICAL_DARK_MUSTARD);
    expect(banana.bg).not.toBe(GCAL_CANONICAL_DEEP_RED.bg);
    // Proche du sample Google Escalade (~133,97,30), pas ~235,180,70
    const rgb = banana.bg.match(/(\d+)/g)!.map(Number);
    expect(rgb[0]).toBeLessThan(180);
    expect(rgb[1]).toBeGreaterThan(70);
  });

  it("événement tangerine (colorId 6) reste orange, pas rouge", () => {
    const style = googleAgendaEventStyle("#ffb878", null, "6", "3", "event");
    expect(style).toEqual(GCAL_DARK_BY_EVENT_COLOR_ID["6"]);
    expect(style.bg).not.toBe(GCAL_CANONICAL_DARK_RED.bg);
    expect(style.bg).not.toBe(GCAL_CANONICAL_DARK_MUSTARD.bg);
  });

  it("événement passé : fond plus sombre (mix canvas), pas juste transparent", () => {
    const live = GCAL_CANONICAL_DARK_RED;
    const past = googleAgendaPastEventStyle(live);
    const liveRgb = live.bg.match(/(\d+)/g)!.map(Number);
    const pastRgb = past.bg.match(/(\d+)/g)!.map(Number);
    expect(pastRgb[0]).toBeLessThan(liveRgb[0]);
    expect(past.bg).not.toBe(live.bg);
    // Texte aussi atténué
    expect(past.text).not.toBe(live.text);
  });

  it("assombrit aussi les couleurs HSL des repas (colorFromName)", () => {
    const hsl = "hsl(45, 50%, 30%)";
    const past = mixCssColorTowardCanvas(hsl, 0.7);
    expect(past).toMatch(/^rgb\(/);
    expect(past).not.toBe(hsl);
    const rgb = past.match(/(\d+)/g)!.map(Number);
    // Plus proche du canvas sombre que du jaune d’origine
    expect(rgb[0]).toBeLessThan(90);
  });
});
