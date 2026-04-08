import type { PlanningSnapshotEntry, MergedPlanningLiveState, PlanningPrefMap } from "./types";
import {
  asBoolRecord,
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

/**
 * Part des préférences « live » chargées depuis la DB, puis applique les snapshots 💾 par-dessus
 * (même logique que le reset auto / manuel).
 */
export function mergeSnapshotsIntoLivePrefMap(
  prefMap: PlanningPrefMap,
  snapshots: Record<string, PlanningSnapshotEntry>
): MergedPlanningLiveState {
  const rMC = { ...asNumberRecord(prefMap["planning_manual_calories"]) };
  const rMP = { ...asNumberRecord(prefMap["planning_manual_proteins"]) };
  const rEC = { ...asNumberRecord(prefMap["planning_extra_calories"]) };
  const rEP = { ...asNumberRecord(prefMap["planning_extra_proteins"]) };
  const rES = { ...asStringArrayRecord(prefMap["planning_extra_selections"]) };
  const rBC = { ...asNumberRecord(prefMap["planning_breakfast_manual_calories"]) };
  const rBP = { ...asNumberRecord(prefMap["planning_breakfast_manual_proteins"]) };
  const keptBreakfast = { ...asStringRecord(prefMap["planning_breakfast"]) };

  for (const [key, snap] of Object.entries(snapshots)) {
    const s = snap;
    if (key.startsWith("manual-")) {
      const k = key.replace("manual-", "");
      if (s.cal != null) rMC[k] = s.cal;
      if (s.prot != null) rMP[k] = s.prot;
    } else if (key.startsWith("extra-")) {
      const k = key.replace("extra-", "");
      if (s.cal != null) rEC[k] = s.cal;
      if (s.prot != null) rEP[k] = s.prot;
      if (s.itemIds) rES[k] = s.itemIds;
    } else if (key.startsWith("breakfast-")) {
      const k = key.replace("breakfast-", "");
      if (s.cal != null) rBC[k] = s.cal;
      if (s.prot != null) rBP[k] = s.prot;
      if (s.mealId) keptBreakfast[k] = s.mealId;
    }
  }

  return {
    planning_manual_calories: rMC,
    planning_manual_proteins: rMP,
    planning_extra_calories: rEC,
    planning_extra_proteins: rEP,
    planning_extra_selections: rES,
    planning_breakfast_manual_calories: rBC,
    planning_breakfast_manual_proteins: rBP,
    planning_breakfast: keptBreakfast,
    planning_drink_checks: { ...asBoolRecord(prefMap["planning_drink_checks"]) },
  };
}
