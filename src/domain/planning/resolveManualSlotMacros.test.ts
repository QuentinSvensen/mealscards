import { describe, expect, it } from "vitest";
import { resolveManualSlotMacros } from "./resolveManualSlotMacros";

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

  it("lit la préférence jour si l’ISO est absente", () => {
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
    expect(out).toEqual({ cal: 1500, prot: 35, fiber: 0 });
  });

  it("retombe sur le snapshot 💾 quand les prefs sont vides (cas post-reset)", () => {
    const out = resolveManualSlotMacros(
      { calories: {}, proteins: {}, fibers: {} },
      {
        "manual-dimanche-midi": { cal: 1500, prot: 35, fiber: 0 },
      },
      "2026-07-26",
      "dimanche",
      "midi",
    );
    expect(out).toEqual({ cal: 1500, prot: 35, fiber: 0 });
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
});
