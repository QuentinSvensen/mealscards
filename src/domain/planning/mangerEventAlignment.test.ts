import { describe, expect, it } from "vitest";
import {
  assignMealsToGouterEvents,
  assignMealsToMangerEvents,
  displayPlacementWithReminder,
  findGouterPlacement,
  findMangerPlacementForMeal,
  isGouterEvent,
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

  it("détecte Gouter / Goûter sans accents ni casse", () => {
    expect(isGouterEvent("Gouter")).toBe(true);
    expect(isGouterEvent("Goûter")).toBe(true);
    expect(isGouterEvent("  GOUTER ")).toBe(true);
    expect(isGouterEvent("Gouter chez mamie")).toBe(false);
    expect(isGouterEvent("Manger")).toBe(false);
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

  it("place le goûter sur l’événement Gouter le plus proche de 16h", () => {
    const match = findGouterPlacement([
      { id: "early", summary: "Gouter", startMin: 14 * 60, durationMin: 30 },
      { id: "right", summary: "Goûter", startMin: 16 * 60, durationMin: 30 },
    ]);
    expect(match?.id).toBe("right");
    expect(match?.durationMin).toBe(30);
  });

  it("assigne toutes les cartes goûter sur le même Gouter", () => {
    const map = assignMealsToGouterEvents(
      [
        { id: "g1", meal_time: "gouter" },
        { id: "g2", meal_time: "gouter" },
        { id: "midi", meal_time: "midi" },
      ],
      [{ id: "ev", summary: "Gouter", startMin: 16 * 60, durationMin: 30 }],
    );
    expect(map.size).toBe(2);
    expect(map.has("midi")).toBe(false);
    expect(map.get("g1")?.eventId).toBe("ev");
    expect(map.get("g2")?.eventId).toBe("ev");
    expect(map.get("g1")?.durationMin).toBe(30);
  });

  it("avance le goûter à l’heure de notif si l’event a un rappel", () => {
    const map = assignMealsToGouterEvents(
      [{ id: "g1", meal_time: "gouter" }],
      [
        {
          id: "ev",
          summary: "Gouter",
          startMin: 16 * 60,
          durationMin: 30,
          reminderMinutesBefore: 30,
        },
      ],
    );
    // 16h–16h30 + notif 30 min avant → 15h30–16h30
    expect(map.get("g1")?.startMin).toBe(15 * 60 + 30);
    expect(map.get("g1")?.durationMin).toBe(60);
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
