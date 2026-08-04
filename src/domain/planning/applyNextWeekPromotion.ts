import type { MergedPlanningLiveState, PlanningPrefMap, PlanningSnapshotEntry } from "./types";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import {
  asBoolRecord,
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";
import { remapPlanningKeyToTargetWeek, remapPlanningRecordToTargetWeek } from "./remapPlanningKeys";

/**
 * Après fusion snapshots 💾 → planning, applique par-dessus tout ce qui a été
 * saisi dans l’aperçu « semaine suivante » (brouillon `next_week_*`).
 * Les clés présentes dans `next_week_*` gagnent sur les valeurs issues des snapshots.
 */
export function applyNextWeekPromotionOnTop(
  merged: MergedPlanningLiveState,
  prefMap: PlanningPrefMap,
  _snapshots?: Record<string, PlanningSnapshotEntry>,
  targetWeek?: PlanningWeekDayInfo[],
): MergedPlanningLiveState {
  const out: MergedPlanningLiveState = {
    planning_manual_calories: { ...merged.planning_manual_calories },
    planning_manual_proteins: { ...merged.planning_manual_proteins },
    planning_manual_fibers: { ...merged.planning_manual_fibers },
    planning_extra_calories: { ...merged.planning_extra_calories },
    planning_extra_proteins: { ...merged.planning_extra_proteins },
    planning_extra_fibers: { ...merged.planning_extra_fibers },
    planning_extra_selections: { ...merged.planning_extra_selections },
    planning_breakfast_manual_calories: { ...merged.planning_breakfast_manual_calories },
    planning_breakfast_manual_proteins: { ...merged.planning_breakfast_manual_proteins },
    planning_breakfast: { ...merged.planning_breakfast },
    planning_drink_checks: { ...merged.planning_drink_checks },
  };

  /**
   * Overlay numériques : valeurs > 0 écrasent ; 0 explicites sont écrits (bloquent un
   * fallback 💾 après clear en semaine pro). Les zéros sont appliqués en 2ᵉ passe
   * pour gagner sur une clé jour positive remappée vers le même ISO.
   */
  const overlayManualNumbers = (next: Record<string, number>, target: Record<string, number>) => {
    const explicitZeros: string[] = [];
    for (const [k, v] of Object.entries(next)) {
      const targetKey = remapPlanningKeyToTargetWeek(k, targetWeek);
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (v > 0) target[targetKey] = v;
      else explicitZeros.push(targetKey);
    }
    for (const targetKey of explicitZeros) {
      target[targetKey] = 0;
    }
  };

  /** Overlay extras / petit-déj : 0 = suppression de la clé (pas de total fantôme). */
  const overlayClearableNumbers = (next: Record<string, number>, target: Record<string, number>) => {
    for (const [k, v] of Object.entries(next)) {
      const targetKey = remapPlanningKeyToTargetWeek(k, targetWeek);
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (v > 0) target[targetKey] = v;
      else delete target[targetKey];
    }
  };

  overlayManualNumbers(asNumberRecord(prefMap["next_week_manual_calories"]), out.planning_manual_calories);
  overlayManualNumbers(asNumberRecord(prefMap["next_week_manual_proteins"]), out.planning_manual_proteins);
  overlayManualNumbers(asNumberRecord(prefMap["next_week_manual_fibers"]), out.planning_manual_fibers);
  overlayClearableNumbers(asNumberRecord(prefMap["next_week_extra_calories"]), out.planning_extra_calories);
  overlayClearableNumbers(asNumberRecord(prefMap["next_week_extra_proteins"]), out.planning_extra_proteins);
  overlayClearableNumbers(asNumberRecord(prefMap["next_week_extra_fibers"]), out.planning_extra_fibers);

  const nES = remapPlanningRecordToTargetWeek(
    asStringArrayRecord(prefMap["next_week_extra_selections"]),
    targetWeek,
  );
  for (const [k, v] of Object.entries(nES)) {
    out.planning_extra_selections[k] = Array.isArray(v) ? [...v] : [];
  }

  const nBf = remapPlanningRecordToTargetWeek(asStringRecord(prefMap["next_week_breakfast"]), targetWeek);
  for (const [k, v] of Object.entries(nBf)) {
    if (v && String(v).trim()) out.planning_breakfast[k] = v;
    else delete out.planning_breakfast[k];
  }

  overlayClearableNumbers(
    asNumberRecord(prefMap["next_week_breakfast_manual_calories"]),
    out.planning_breakfast_manual_calories,
  );
  overlayClearableNumbers(
    asNumberRecord(prefMap["next_week_breakfast_manual_proteins"]),
    out.planning_breakfast_manual_proteins,
  );

  const nDr = asBoolRecord(prefMap["next_week_drink_checks"]);
  for (const [k, v] of Object.entries(nDr)) {
    const targetKey = remapPlanningKeyToTargetWeek(k, targetWeek);
    if (v) out.planning_drink_checks[targetKey] = true;
    else delete out.planning_drink_checks[targetKey];
  }

  return out;
}
