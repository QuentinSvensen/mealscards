import type { PlanningPrefMap, PlanningSnapshotEntry } from "./types";
import type { PlanningWeekDayLike } from "@/lib/planningWeekUtils";
import { mergeSnapshotsIntoLivePrefMap } from "./mergePlanningSnapshots";
import {
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

/**
 * Fusionne les prefs live et les snapshots 💾 de la semaine archivée
 * pour construire un backup complet (extras, créneaux manuels, petit-déj).
 */
export function enrichPrefMapForArchive(
  prefMap: PlanningPrefMap,
  snapshots: Record<string, PlanningSnapshotEntry>,
  archivedWeekDates: PlanningWeekDayLike[],
): PlanningPrefMap {
  const fromSnapshots = mergeSnapshotsIntoLivePrefMap(prefMap, snapshots, archivedWeekDates);
  return {
    ...prefMap,
    planning_manual_calories: {
      ...asNumberRecord(prefMap["planning_manual_calories"]),
      ...asNumberRecord(fromSnapshots.planning_manual_calories),
    },
    planning_manual_proteins: {
      ...asNumberRecord(prefMap["planning_manual_proteins"]),
      ...asNumberRecord(fromSnapshots.planning_manual_proteins),
    },
    planning_manual_fibers: {
      ...asNumberRecord(prefMap["planning_manual_fibers"]),
      ...asNumberRecord(fromSnapshots.planning_manual_fibers),
    },
    planning_extra_calories: {
      ...asNumberRecord(prefMap["planning_extra_calories"]),
      ...asNumberRecord(fromSnapshots.planning_extra_calories),
    },
    planning_extra_proteins: {
      ...asNumberRecord(prefMap["planning_extra_proteins"]),
      ...asNumberRecord(fromSnapshots.planning_extra_proteins),
    },
    planning_extra_fibers: {
      ...asNumberRecord(prefMap["planning_extra_fibers"]),
      ...asNumberRecord(fromSnapshots.planning_extra_fibers),
    },
    planning_extra_selections: {
      ...asStringArrayRecord(prefMap["planning_extra_selections"]),
      ...asStringArrayRecord(fromSnapshots.planning_extra_selections),
    },
    planning_breakfast_manual_calories: {
      ...asNumberRecord(prefMap["planning_breakfast_manual_calories"]),
      ...asNumberRecord(fromSnapshots.planning_breakfast_manual_calories),
    },
    planning_breakfast_manual_proteins: {
      ...asNumberRecord(prefMap["planning_breakfast_manual_proteins"]),
      ...asNumberRecord(fromSnapshots.planning_breakfast_manual_proteins),
    },
    planning_breakfast: {
      ...asStringRecord(prefMap["planning_breakfast"]),
      ...asStringRecord(fromSnapshots.planning_breakfast),
    },
  };
}
