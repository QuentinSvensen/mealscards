import type { PlanningSnapshotEntry, MergedPlanningLiveState, PlanningPrefMap } from "./types";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import { remapPlanningKeyToTargetWeek } from "./remapPlanningKeys";
import {
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

/**
 * Part des préférences « live » chargées depuis la DB, puis applique les snapshots 💾 par-dessus
 * (même logique que le reset auto / manuel).
 */
export function mergeSnapshotsIntoLivePrefMap(
  _prefMap: PlanningPrefMap,
  snapshots: Record<string, PlanningSnapshotEntry>,
  targetWeek?: PlanningWeekDayInfo[],
): MergedPlanningLiveState {
  // Reset hebdo : on repart d'un état vierge.
  // Seules les entrées explicitement sauvegardées (snapshots 💾) sont réinjectées.
  const rMC: Record<string, number> = {};
  const rMP: Record<string, number> = {};
  const rEC: Record<string, number> = {};
  const rEP: Record<string, number> = {};
  const rES: Record<string, string[]> = {};
  const rBC: Record<string, number> = {};
  const rBP: Record<string, number> = {};
  const keptBreakfast: Record<string, string> = {};

  for (const [key, snap] of Object.entries(snapshots)) {
    const s = snap;
    if (key.startsWith("manual-")) {
      const k = remapPlanningKeyToTargetWeek(key.replace("manual-", ""), targetWeek);
      if (s.cal != null) rMC[k] = s.cal;
      if (s.prot != null) rMP[k] = s.prot;
    } else if (key.startsWith("extra-")) {
      const k = remapPlanningKeyToTargetWeek(key.replace("extra-", ""), targetWeek);
      if (s.cal != null) rEC[k] = s.cal;
      if (s.prot != null) rEP[k] = s.prot;
      if (s.itemIds) rES[k] = s.itemIds;
    } else if (key.startsWith("breakfast-")) {
      const k = remapPlanningKeyToTargetWeek(key.replace("breakfast-", ""), targetWeek);
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
    planning_drink_checks: {},
  };
}
