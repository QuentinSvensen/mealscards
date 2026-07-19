import type { PlanningSnapshotEntry } from "./types";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";

/** Prefs numeriques / listes de la semaine suivante sur lesquelles appliquer les snapshots directs. */
export interface NextWeekDayPrefsOverlay {
  breakfastSelections: Record<string, string>;
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  manualCalories: Record<string, number>;
  manualProteins: Record<string, number>;
  manualFibers: Record<string, number>;
  extraCalories: Record<string, number>;
  extraProteins: Record<string, number>;
  extraFibers: Record<string, number>;
  extraSelections: Record<string, string[]>;
}

/**
 * Indique si une map de prefs contient déjà une entrée pour l’ISO ou la clé jour
 * (même sémantique que PlanningNextWeekView : clé présente → pas de fallback snapshot).
 */
function hasDayOrIsoKey(record: Record<string, unknown>, iso: string, dayKey: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, iso) ||
    Object.prototype.hasOwnProperty.call(record, dayKey)
  );
}

/**
 * Indique si une map de créneaux contient déjà une entrée ISO-slot ou jour-slot.
 */
function hasSlotKey(
  record: Record<string, unknown>,
  iso: string,
  dayKey: string,
  slot: string,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, `${iso}-${slot}`) ||
    Object.prototype.hasOwnProperty.call(record, `${dayKey}-${slot}`)
  );
}

/**
 * Applique les snapshots 💾 directement liés au jour (clés `…-ISO` ou `…-lundi`)
 * en fallback sous les prefs `next_week_*`.
 * Même règle que PlanningNextWeekView / resolveExtraSnapshotForDay :
 * pas de reprise d’anciennes dates ISO d’un même jour de semaine.
 * Sert au seuil « Au choix » pour aligner la conso sur le badge Planning semaine pro.
 */
export function overlayDirectSnapshotsOntoNextWeekPrefs(
  prefs: NextWeekDayPrefsOverlay,
  snapshots: Record<string, PlanningSnapshotEntry>,
  nextWeekDates: PlanningWeekDayInfo[],
): NextWeekDayPrefsOverlay {
  const out: NextWeekDayPrefsOverlay = {
    breakfastSelections: { ...prefs.breakfastSelections },
    breakfastManualCalories: { ...prefs.breakfastManualCalories },
    breakfastManualProteins: { ...prefs.breakfastManualProteins },
    manualCalories: { ...prefs.manualCalories },
    manualProteins: { ...prefs.manualProteins },
    manualFibers: { ...prefs.manualFibers },
    extraCalories: { ...prefs.extraCalories },
    extraProteins: { ...prefs.extraProteins },
    extraFibers: { ...prefs.extraFibers },
    extraSelections: { ...prefs.extraSelections },
  };

  const slots = ["matin", "midi", "gouter", "soir"] as const;

  for (const { key, iso } of nextWeekDates) {
    const bfSnap =
      snapshots[`breakfast-${iso}`] || snapshots[`breakfast-${key}`];
    if (bfSnap) {
      if (!hasDayOrIsoKey(out.breakfastSelections, iso, key) && bfSnap.mealId) {
        out.breakfastSelections[iso] = bfSnap.mealId;
      }
      if (!hasDayOrIsoKey(out.breakfastManualCalories, iso, key) && bfSnap.cal != null) {
        out.breakfastManualCalories[iso] = bfSnap.cal;
      }
      if (!hasDayOrIsoKey(out.breakfastManualProteins, iso, key) && bfSnap.prot != null) {
        out.breakfastManualProteins[iso] = bfSnap.prot;
      }
    }

    const extraSnap = snapshots[`extra-${iso}`] || snapshots[`extra-${key}`];
    if (extraSnap) {
      if (!hasDayOrIsoKey(out.extraCalories, iso, key) && extraSnap.cal != null) {
        out.extraCalories[iso] = extraSnap.cal;
      }
      if (!hasDayOrIsoKey(out.extraProteins, iso, key) && extraSnap.prot != null) {
        out.extraProteins[iso] = extraSnap.prot;
      }
      if (!hasDayOrIsoKey(out.extraFibers, iso, key) && extraSnap.fiber != null) {
        out.extraFibers[iso] = extraSnap.fiber;
      }
      if (!hasDayOrIsoKey(out.extraSelections, iso, key) && extraSnap.itemIds) {
        out.extraSelections[iso] = [...extraSnap.itemIds];
      }
    }

    for (const slot of slots) {
      const manualSnap =
        snapshots[`manual-${iso}-${slot}`] || snapshots[`manual-${key}-${slot}`];
      if (!manualSnap) continue;
      if (!hasSlotKey(out.manualCalories, iso, key, slot) && manualSnap.cal != null) {
        out.manualCalories[`${iso}-${slot}`] = manualSnap.cal;
      }
      if (!hasSlotKey(out.manualProteins, iso, key, slot) && manualSnap.prot != null) {
        out.manualProteins[`${iso}-${slot}`] = manualSnap.prot;
      }
      if (!hasSlotKey(out.manualFibers, iso, key, slot) && manualSnap.fiber != null) {
        out.manualFibers[`${iso}-${slot}`] = manualSnap.fiber;
      }
    }
  }

  return out;
}
