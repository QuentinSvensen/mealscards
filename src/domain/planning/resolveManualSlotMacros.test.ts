import { describe, expect, it } from "vitest";
import {
  clearManualSlotMacroPreferences,
  resolveManualSlotMacros,
  resolveNextWeekManualSlotMacros,
  syncNextWeekManualSlotMacro,
  writeManualSlotMacroPreference,
} from "./resolveManualSlotMacros";
import { applyNextWeekPromotionOnTop } from "./applyNextWeekPromotion";

describe("resolveManualSlotMacros", () => {
  it("préfère la préférence ISO au snapshot", () => {
    const out = resolveManualSlotMacros(
      {
        calories: { "2026-07-26-midi": 900 },
        proteins: { "2026-07-26-midi": 20 },
        fibers: { "2026-07-26-midi": 4 },
      },
      {
        "manual-2026-07-26-midi": { cal: 1500, prot: 35, fiber: 0 },
      },
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 900, prot: 20, fiber: 4 });
  });

  it("ignore les clés jour live (évite fuite inter-semaines)", () => {
    const out = resolveManualSlotMacros(
      {
        calories: { "dimanche-midi": 1500 },
        proteins: { "dimanche-midi": 35 },
        fibers: {},
      },
      {},
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 0, prot: 0, fiber: 0 });
  });

  it("n’utilise pas le snapshot weekday (réservé au merge reset)", () => {
    const out = resolveManualSlotMacros(
      { calories: {}, proteins: {}, fibers: {} },
      {
        "manual-dimanche-midi": { cal: 1500, prot: 35, fiber: 0 },
      },
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 0, prot: 0, fiber: 0 });
  });

  it("retombe sur le snapshot ISO du jour affiché", () => {
    const out = resolveManualSlotMacros(
      { calories: {}, proteins: {}, fibers: {} },
      {
        "manual-2026-07-26-midi": { cal: 1500, prot: 35, fiber: 0 },
      },
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 1500, prot: 35, fiber: 0 });
  });

  it("respecte un 0 explicite en pref (clear manuel, pas de fallback snapshot)", () => {
    const out = resolveManualSlotMacros(
      {
        calories: { "2026-07-26-midi": 0 },
        proteins: { "2026-07-26-midi": 0 },
        fibers: { "2026-07-26-midi": 0 },
      },
      {
        "manual-2026-07-26-midi": { cal: 1500, prot: 35, fiber: 8 },
      },
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 0, prot: 0, fiber: 0 });
  });
});

describe("writeManualSlotMacroPreference", () => {
  it("écrit 0 au clear et retire la clé jour pour bloquer le fallback snapshot", () => {
    const out = writeManualSlotMacroPreference(
      { "dimanche-midi": 1500, "2026-07-26-midi": 1500 },
      "2026-07-26",
      "dimanche",
      "midi",
      0,
    );
    expect(out).toEqual({ "2026-07-26-midi": 0 });
  });

  it("écrit une valeur positive sur la clé ISO", () => {
    const out = writeManualSlotMacroPreference({}, "2026-07-26", "dimanche", "midi", 900);
    expect(out).toEqual({ "2026-07-26-midi": 900 });
  });
});

describe("resolveNextWeekManualSlotMacros", () => {
  it("affiche snapshot 💾 sans lire les clés jour next_week (brouillon blur)", () => {
    const out = resolveNextWeekManualSlotMacros(
      {
        calories: { "samedi-midi": 1500 },
        proteins: { "samedi-midi": 35 },
        fibers: {},
      },
      {},
      "2026-08-08",
      "samedi",
      "midi",
    );
    expect(out).toEqual({ cal: 0, prot: 0, fiber: 0 });
  });

  it("affiche snapshot 💾 et saisie ISO directe en semaine pro", () => {
    const out = resolveNextWeekManualSlotMacros(
      {
        calories: { "2026-08-08-midi": 800 },
        proteins: {},
        fibers: {},
      },
      { "manual-samedi-midi": { cal: 1500, prot: 35, fiber: 0 } },
      "2026-08-08",
      "samedi",
      "midi",
    );
    expect(out).toEqual({ cal: 800, prot: 35, fiber: 0 });
  });

  it("respecte un clear ISO 0 même si un snapshot weekday existe", () => {
    const out = resolveNextWeekManualSlotMacros(
      {
        calories: { "2026-08-09-midi": 0 },
        proteins: { "2026-08-09-midi": 0 },
        fibers: { "2026-08-09-midi": 0 },
      },
      { "manual-dimanche-midi": { cal: 1500, prot: 35, fiber: 0 } },
      "2026-08-09",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 0, prot: 0, fiber: 0 });
  });
});

describe("syncNextWeekManualSlotMacro", () => {
  it("écrit la valeur sur la clé jour du brouillon Suiv.", () => {
    const out = syncNextWeekManualSlotMacro({}, "2026-08-01", "samedi", "midi", 1500);
    expect(out).toEqual({ "samedi-midi": 1500 });
  });

  it("supprime les clés jour et ISO quand on efface (0) en semaine courante", () => {
    const out = syncNextWeekManualSlotMacro(
      { "samedi-midi": 1500, "2026-08-01-midi": 1500, "dimanche-midi": 900 },
      "2026-08-01",
      "samedi",
      "midi",
      0,
    );
    expect(out).toEqual({ "dimanche-midi": 900 });
  });
});

describe("clearManualSlotMacroPreferences", () => {
  it("remet kcal/prot/fib live à 0 pour bloquer le fallback 💾", () => {
    const out = clearManualSlotMacroPreferences(
      { "2026-08-01-midi": 1500 },
      { "2026-08-01-midi": 35 },
      { "2026-08-01-midi": 8 },
      "2026-08-01",
      "samedi",
      "midi",
    );
    expect(out.calories).toEqual({ "2026-08-01-midi": 0 });
    expect(out.proteins).toEqual({ "2026-08-01-midi": 0 });
    expect(out.fibers).toEqual({ "2026-08-01-midi": 0 });
  });
});

describe("applyNextWeekPromotionOnTop — clear explicite", () => {
  it("conserve un 0 saisi en semaine pro (ne laisse pas le snapshot 💾 revenir)", () => {
    const targetWeek = [
      { key: "lundi", iso: "2026-08-03", display: "" },
      { key: "mardi", iso: "2026-08-04", display: "" },
      { key: "mercredi", iso: "2026-08-05", display: "" },
      { key: "jeudi", iso: "2026-08-06", display: "" },
      { key: "vendredi", iso: "2026-08-07", display: "" },
      { key: "samedi", iso: "2026-08-08", display: "" },
      { key: "dimanche", iso: "2026-08-09", display: "" },
    ] as any;

    const out = applyNextWeekPromotionOnTop(
      {
        planning_manual_calories: { "2026-08-09-midi": 1500 },
        planning_manual_proteins: { "2026-08-09-midi": 35 },
        planning_manual_fibers: {},
        planning_extra_calories: {},
        planning_extra_proteins: {},
        planning_extra_fibers: {},
        planning_extra_selections: {},
        planning_breakfast_manual_calories: {},
        planning_breakfast_manual_proteins: {},
        planning_breakfast: {},
        planning_drink_checks: {},
      },
      {
        next_week_manual_calories: { "2026-08-09-midi": 0 },
        next_week_manual_proteins: { "2026-08-09-midi": 0 },
        next_week_manual_fibers: { "2026-08-09-midi": 0 },
      },
      {},
      targetWeek,
    );

    expect(out.planning_manual_calories["2026-08-09-midi"]).toBe(0);
    expect(out.planning_manual_proteins["2026-08-09-midi"]).toBe(0);
    expect(out.planning_manual_fibers["2026-08-09-midi"]).toBe(0);
    // Un 0 explicite doit aussi gagner sur une clé jour positive résiduelle
    const out2 = applyNextWeekPromotionOnTop(
      {
        planning_manual_calories: { "2026-08-09-midi": 1500 },
        planning_manual_proteins: {},
        planning_manual_fibers: {},
        planning_extra_calories: {},
        planning_extra_proteins: {},
        planning_extra_fibers: {},
        planning_extra_selections: {},
        planning_breakfast_manual_calories: {},
        planning_breakfast_manual_proteins: {},
        planning_breakfast: {},
        planning_drink_checks: {},
      },
      {
        next_week_manual_calories: {
          "dimanche-midi": 1500,
          "2026-08-09-midi": 0,
        },
      },
      {},
      targetWeek,
    );
    expect(out2.planning_manual_calories["2026-08-09-midi"]).toBe(0);
  });
});
