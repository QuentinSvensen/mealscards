import type { MergedPlanningLiveState, PlanningPrefMap } from "./types";
import {
  asBoolRecord,
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

/**
 * Après fusion snapshots 💾 → planning, applique par-dessus tout ce qui a été
 * saisi dans l’aperçu « semaine suivante » (brouillon `next_week_*`).
 * Les clés présentes dans `next_week_*` gagnent sur les valeurs issues des snapshots.
 */
export function applyNextWeekPromotionOnTop(
  merged: MergedPlanningLiveState,
  prefMap: PlanningPrefMap,
): MergedPlanningLiveState {
  const out: MergedPlanningLiveState = {
    planning_manual_calories: { ...merged.planning_manual_calories },
    planning_manual_proteins: { ...merged.planning_manual_proteins },
    planning_extra_calories: { ...merged.planning_extra_calories },
    planning_extra_proteins: { ...merged.planning_extra_proteins },
    planning_extra_selections: { ...merged.planning_extra_selections },
    planning_breakfast_manual_calories: { ...merged.planning_breakfast_manual_calories },
    planning_breakfast_manual_proteins: { ...merged.planning_breakfast_manual_proteins },
    planning_breakfast: { ...merged.planning_breakfast },
    planning_drink_checks: { ...merged.planning_drink_checks },
  };

  const overlayNumbers = (next: Record<string, number>, target: Record<string, number>) => {
    for (const [k, v] of Object.entries(next)) {
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (v > 0) target[k] = v;
      else delete target[k];
    }
  };

  overlayNumbers(asNumberRecord(prefMap["next_week_manual_calories"]), out.planning_manual_calories);
  overlayNumbers(asNumberRecord(prefMap["next_week_manual_proteins"]), out.planning_manual_proteins);
  overlayNumbers(asNumberRecord(prefMap["next_week_extra_calories"]), out.planning_extra_calories);
  overlayNumbers(asNumberRecord(prefMap["next_week_extra_proteins"]), out.planning_extra_proteins);

  const nES = asStringArrayRecord(prefMap["next_week_extra_selections"]);
  for (const [k, v] of Object.entries(nES)) {
    out.planning_extra_selections[k] = Array.isArray(v) ? [...v] : [];
  }

  const nBf = asStringRecord(prefMap["next_week_breakfast"]);
  for (const [k, v] of Object.entries(nBf)) {
    if (v && String(v).trim()) out.planning_breakfast[k] = v;
    else delete out.planning_breakfast[k];
  }

  overlayNumbers(asNumberRecord(prefMap["next_week_breakfast_manual_calories"]), out.planning_breakfast_manual_calories);
  overlayNumbers(asNumberRecord(prefMap["next_week_breakfast_manual_proteins"]), out.planning_breakfast_manual_proteins);

  const nDr = asBoolRecord(prefMap["next_week_drink_checks"]);
  for (const [k, v] of Object.entries(nDr)) {
    if (v) out.planning_drink_checks[k] = true;
    else delete out.planning_drink_checks[k];
  }

  return out;
}
