import { describe, expect, it } from "vitest";
import {
  assignMealsToMangerEvents,
  displayPlacementWithReminder,
  findMangerPlacementForMeal,
  isMangerEvent,
  resolveReminderMinutesBefore,
} from "./mangerEventAlignment";

describe("mangerEventAlignment", () => {
  it("détecte le titre Manger sans tenir compte de la casse", () => {
    expect(isMangerEvent("Manger")).toBe(true);
    expect(isMangerEvent("  manger ")).toBe(true);
    expect(isMangerEvent("MANGER")).toBe(true);
    expect(isMangerEvent("Manger chez mamie")).toBe(false);
    expect(isMangerEvent("Sport")).toBe(false);
  });

  it("associe un Manger à midi selon l’heure de début", () => {
    const match = findMangerPlacementForMeal(
      [
        { id: "a", summary: "Manger", startMin: 12 * 60 + 10, durationMin: 35 },
        { id: "b", summary: "Manger", startMin: 8 * 60, durationMin: 50 },
      ],
      "midi",
    );
    expect(match?.id).toBe("a");
    expect(match?.durationMin).toBe(35);
  });

  it("associe un Manger du matin et ignore le goûter", () => {
    expect(
      findMangerPlacementForMeal(
        [{ id: "a", summary: "Manger", startMin: 8 * 60 + 15, durationMin: 40 }],
        "matin",
      )?.durationMin,
    ).toBe(40);
    expect(
      findMangerPlacementForMeal(
        [{ id: "a", summary: "Manger", startMin: 8 * 60, durationMin: 40 }],
        "gouter",
      ),
    ).toBeNull();
  });

  it("n’assigne qu’un Manger par repas (unicité)", () => {
    const map = assignMealsToMangerEvents(
      [
        { id: "pm1", meal_time: "midi" },
        { id: "pm2", meal_time: "midi" },
      ],
      [{ id: "ev1", summary: "Manger", startMin: 12 * 60, durationMin: 50 }],
    );
    expect(map.size).toBe(1);
    expect([...map.values()][0].durationMin).toBe(50);
  });

  it("aligne soir sur un Manger ≥ 16h", () => {
    const match = findMangerPlacementForMeal(
      [{ id: "s", summary: "Manger", startMin: 19 * 60 + 5, durationMin: 45 }],
      "soir",
    );
    expect(match?.startMin).toBe(19 * 60 + 5);
    expect(match?.durationMin).toBe(45);
  });

  it("résout le rappel popup override (10 min avant)", () => {
    expect(
      resolveReminderMinutesBefore({
        useDefault: false,
        overrides: [{ method: "popup", minutes: 10 }],
      }),
    ).toBe(10);
  });

  it("utilise les rappels par défaut de l’agenda si useDefault", () => {
    expect(
      resolveReminderMinutesBefore(
        { useDefault: true },
        [{ method: "popup", minutes: 15 }],
      ),
    ).toBe(15);
  });

  it("n’applique aucun rappel si overrides vides et useDefault false", () => {
    expect(
      resolveReminderMinutesBefore(
        { useDefault: false, overrides: [] },
        [{ method: "popup", minutes: 10 }],
      ),
    ).toBeNull();
  });

  it("avance l’affichage à l’heure de notif en gardant la fin", () => {
    // Event 13h45–14h35 (50 min), notif 10 min avant → 13h35–14h35
    const start = 13 * 60 + 45;
    const placed = displayPlacementWithReminder(start, 50, 10);
    expect(placed.startMin).toBe(13 * 60 + 35);
    expect(placed.durationMin).toBe(60);
  });

  it("assigne le repas avec début avancé selon le rappel", () => {
    const map = assignMealsToMangerEvents(
      [{ id: "pm1", meal_time: "midi" }],
      [
        {
          id: "ev1",
          summary: "Manger",
          startMin: 13 * 60 + 45,
          durationMin: 50,
          reminderMinutesBefore: 10,
        },
      ],
    );
    const align = map.get("pm1");
    expect(align?.startMin).toBe(13 * 60 + 35);
    expect(align?.durationMin).toBe(60);
  });
});
