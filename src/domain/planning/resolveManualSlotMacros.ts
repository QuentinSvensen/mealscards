import { pickPlanningSlotValue } from "@/lib/planningExtraMacros";
import type { PlanningSnapshotEntry } from "./types";

/** Prefs manuelles kcal / prot / fib indexées par créneau. */
export type ManualSlotMacroMaps = {
  calories: Record<string, number>;
  proteins: Record<string, number>;
  fibers: Record<string, number>;
};

/** Macros manuelles résolues pour un créneau (midi, soir, goûter…). */
export type ManualSlotMacros = {
  cal: number;
  prot: number;
  fiber: number;
};

/**
 * Résout kcal / prot / fib d’un créneau manuel :
 * 1) préférences live (clé ISO puis clé jour, via pickPlanningSlotValue) ;
 * 2) sinon fallback sur le snapshot 💾 (même règle que PlanningNextWeekView).
 * Sert à afficher les inputs après reset quand le save existe encore mais les prefs sont vides.
 */
export function resolveManualSlotMacros(
  prefs: ManualSlotMacroMaps,
  snapshots: Record<string, PlanningSnapshotEntry>,
  iso: string,
  dayKey: string,
  slot: string,
): ManualSlotMacros {
  const snap =
    snapshots[`manual-${iso}-${slot}`] || snapshots[`manual-${dayKey}-${slot}`];
  return {
    cal: pickPlanningSlotValue(prefs.calories, iso, dayKey, slot) ?? snap?.cal ?? 0,
    prot: pickPlanningSlotValue(prefs.proteins, iso, dayKey, slot) ?? snap?.prot ?? 0,
    fiber: pickPlanningSlotValue(prefs.fibers, iso, dayKey, slot) ?? snap?.fiber ?? 0,
  };
}
