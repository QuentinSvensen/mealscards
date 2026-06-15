import type { PlanningSnapshotEntry, MergedPlanningLiveState, PlanningPrefMap } from "./types";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import { remapPlanningKeyToTargetWeek } from "./remapPlanningKeys";
import { isSnapshotSourceEligibleForTargetWeek } from "./weekdaySnapshotUtils";
import {
  asNumberRecord,
  asStringArrayRecord,
  asStringRecord,
} from "./jsonCoerce";

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}/;
const SNAPSHOT_PRIORITY_BAND = 10_000_000_000_000;

/**
 * Calcule le rang d'un snapshot pour départager plusieurs sauvegardes d'un même jour/créneau.
 * Une sauvegarde de la date cible gagne, puis la sauvegarde ISO la plus récente, puis le fallback par nom de jour.
 */
function getSnapshotPriority(sourceKey: string, targetKey: string, snap: PlanningSnapshotEntry): number {
  const targetIso = targetKey.match(ISO_DAY_RE)?.[0] ?? "";
  const sourceIso = sourceKey.match(ISO_DAY_RE)?.[0] ?? "";
  const savedAt = typeof snap.savedAt === "number" && Number.isFinite(snap.savedAt) ? snap.savedAt : 0;
  if (targetIso && sourceIso === targetIso) return 3 * SNAPSHOT_PRIORITY_BAND + savedAt;
  if (sourceIso) {
    const sourceTime = new Date(`${sourceIso}T00:00:00`).getTime();
    return 2 * SNAPSHOT_PRIORITY_BAND + (Number.isFinite(sourceTime) ? sourceTime : 0) + savedAt / 1_000_000;
  }
  return SNAPSHOT_PRIORITY_BAND + savedAt;
}

/**
 * Indique si le snapshot candidat doit remplacer celui déjà choisi pour la clé cible.
 */
function shouldApplySnapshot(
  ranks: Record<string, number>,
  targetKey: string,
  sourceKey: string,
  snap: PlanningSnapshotEntry,
): boolean {
  const rank = getSnapshotPriority(sourceKey, targetKey, snap);
  if ((ranks[targetKey] ?? -Infinity) >= rank) return false;
  ranks[targetKey] = rank;
  return true;
}

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
  const rMF: Record<string, number> = {};
  const rEC: Record<string, number> = {};
  const rEP: Record<string, number> = {};
  const rEF: Record<string, number> = {};
  const rES: Record<string, string[]> = {};
  const rBC: Record<string, number> = {};
  const rBP: Record<string, number> = {};
  const keptBreakfast: Record<string, string> = {};
  const manualRanks: Record<string, number> = {};
  const extraRanks: Record<string, number> = {};
  const breakfastRanks: Record<string, number> = {};
  const targetWeekIsos = targetWeek?.length ? new Set(targetWeek.map((day) => day.iso)) : undefined;

  for (const [key, snap] of Object.entries(snapshots)) {
    const s = snap;
    if (key.startsWith("manual-")) {
      const sourceKey = key.replace("manual-", "");
      if (!isSnapshotSourceEligibleForTargetWeek(sourceKey, targetWeekIsos)) continue;
      const k = remapPlanningKeyToTargetWeek(sourceKey, targetWeek);
      if (!shouldApplySnapshot(manualRanks, k, sourceKey, s)) continue;
      delete rMC[k];
      delete rMP[k];
      delete rMF[k];
      if (s.cal != null) rMC[k] = s.cal;
      if (s.prot != null) rMP[k] = s.prot;
      if (s.fiber != null) rMF[k] = s.fiber;
    } else if (key.startsWith("extra-")) {
      const sourceKey = key.replace("extra-", "");
      if (!isSnapshotSourceEligibleForTargetWeek(sourceKey, targetWeekIsos)) continue;
      const k = remapPlanningKeyToTargetWeek(sourceKey, targetWeek);
      if (!shouldApplySnapshot(extraRanks, k, sourceKey, s)) continue;
      delete rEC[k];
      delete rEP[k];
      delete rEF[k];
      delete rES[k];
      if (s.cal != null) rEC[k] = s.cal;
      if (s.prot != null) rEP[k] = s.prot;
      if (s.fiber != null) rEF[k] = s.fiber;
      if (s.itemIds) rES[k] = s.itemIds;
    } else if (key.startsWith("breakfast-")) {
      const sourceKey = key.replace("breakfast-", "");
      if (!isSnapshotSourceEligibleForTargetWeek(sourceKey, targetWeekIsos)) continue;
      const k = remapPlanningKeyToTargetWeek(sourceKey, targetWeek);
      if (!shouldApplySnapshot(breakfastRanks, k, sourceKey, s)) continue;
      delete rBC[k];
      delete rBP[k];
      delete keptBreakfast[k];
      if (s.cal != null) rBC[k] = s.cal;
      if (s.prot != null) rBP[k] = s.prot;
      if (s.mealId) keptBreakfast[k] = s.mealId;
    }
  }

  return {
    planning_manual_calories: rMC,
    planning_manual_proteins: rMP,
    planning_manual_fibers: rMF,
    planning_extra_calories: rEC,
    planning_extra_proteins: rEP,
    planning_extra_fibers: rEF,
    planning_extra_selections: rES,
    planning_breakfast_manual_calories: rBC,
    planning_breakfast_manual_proteins: rBP,
    planning_breakfast: keptBreakfast,
    planning_drink_checks: {},
  };
}
