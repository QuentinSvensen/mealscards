import { describe, expect, it } from "vitest";
import {
  canAcceptPlanningSlotDrag,
  dataTransferHasType,
  getPlanningPmIdFromDrop,
  isPlanningCardDrag,
} from "./planningDnD";

/** Construit un DataTransfer minimal pour les tests de types / getData. */
function mockDataTransfer(types: string[], data: Record<string, string> = {}): DataTransfer {
  return {
    types,
    getData: (type: string) => data[type] ?? "",
    setData: () => {},
    clearData: () => {},
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    setDragImage: () => {},
  } as DataTransfer;
}

describe("planningDnD", () => {
  it("détecte pmId même si types est en minuscules (pmid)", () => {
    const dt = mockDataTransfer(["pmid", "mealid", "source"]);
    expect(dataTransferHasType(dt, "pmId")).toBe(true);
    expect(isPlanningCardDrag(dt)).toBe(true);
    expect(canAcceptPlanningSlotDrag(dt)).toBe(true);
  });

  it("accepte via draggedPlanningPmId même sans types utiles", () => {
    const dt = mockDataTransfer([]);
    expect(canAcceptPlanningSlotDrag(dt, null, "abc")).toBe(true);
  });

  it("lit le pmId depuis dataTransfer ou la ref de secours", () => {
    const dt = mockDataTransfer(["pmid"], { pmId: "card-1" });
    expect(getPlanningPmIdFromDrop({ dataTransfer: dt })).toBe("card-1");
    expect(
      getPlanningPmIdFromDrop(
        { dataTransfer: mockDataTransfer([]) },
        { pmId: "card-2", slotKey: "d-midi" },
      ),
    ).toBe("card-2");
  });
});
