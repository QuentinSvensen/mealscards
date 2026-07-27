import type { PlanningWeekDayLike } from "@/lib/planningWeekUtils";
import { pickPlanningSlotValue } from "@/lib/planningExtraMacros";
import type { PlanningSnapshotEntry, PossibleMealsFullBackup } from "./types";
import { isSnapshotSourceEligibleForTargetWeek } from "./weekdaySnapshotUtils";

const SNAPSHOT_PREFIXES = ["manual-", "extra-", "breakfast-"] as const;
const MANUAL_SLOTS = ["matin", "midi", "soir", "gouter"] as const;

/** Indique si une map contient déjà une entrée pour l’ISO ou la clé jour. */
function hasDayOrIsoKey(
  record: Record<string, unknown>,
  iso: string,
  dayKey: string,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, iso) ||
    Object.prototype.hasOwnProperty.call(record, dayKey)
  );
}

/** Clone les records journaliers d’un backup pour modification sans muter l’original. */
function cloneBackupDayRecords(backup: PossibleMealsFullBackup): PossibleMealsFullBackup {
  return {
    ...backup,
    manualCalories: { ...backup.manualCalories },
    manualProteins: { ...backup.manualProteins },
    manualFibers: { ...backup.manualFibers },
    extraCalories: { ...backup.extraCalories },
    extraProteins: { ...backup.extraProteins },
    extraFibers: { ...backup.extraFibers },
    extraSelections: { ...backup.extraSelections },
    breakfastManualCalories: { ...backup.breakfastManualCalories },
    breakfastManualProteins: { ...backup.breakfastManualProteins },
    breakfastSelections: { ...backup.breakfastSelections },
    savedSnapshots: { ...(backup.savedSnapshots ?? {}) },
  };
}

/**
 * Intègre les snapshots 💾 (extras, créneaux manuels, petit-déj) dans le backup
 * avant le prune post-reset qui supprime les clés ISO de la semaine archivée.
 */
export function embedPlanningSnapshotsInBackup(
  backup: PossibleMealsFullBackup,
  snapshots: Record<string, PlanningSnapshotEntry>,
  archivedWeekDates: PlanningWeekDayLike[],
): PossibleMealsFullBackup {
  const out = cloneBackupDayRecords(backup);

  for (const { iso, key } of archivedWeekDates) {
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
      if (
        extraSnap.itemIds &&
        extraSnap.itemIds.length > 0 &&
        !hasDayOrIsoKey(out.extraSelections as Record<string, unknown>, iso, key)
      ) {
        out.extraSelections[iso] = [...extraSnap.itemIds];
      }
    }

    const bfSnap = snapshots[`breakfast-${iso}`] || snapshots[`breakfast-${key}`];
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

    for (const slot of MANUAL_SLOTS) {
      const snap = snapshots[`manual-${iso}-${slot}`] || snapshots[`manual-${key}-${slot}`];
      if (!snap) continue;
      if (pickPlanningSlotValue(out.manualCalories, iso, key, slot) == null && snap.cal != null) {
        out.manualCalories[`${iso}-${slot}`] = snap.cal;
      }
      if (pickPlanningSlotValue(out.manualProteins, iso, key, slot) == null && snap.prot != null) {
        out.manualProteins[`${iso}-${slot}`] = snap.prot;
      }
      if (pickPlanningSlotValue(out.manualFibers, iso, key, slot) == null && snap.fiber != null) {
        out.manualFibers[`${iso}-${slot}`] = snap.fiber;
      }
    }
  }

  const weekIsos = new Set(archivedWeekDates.map((d) => d.iso));
  const embeddedSnapshots: Record<string, PlanningSnapshotEntry> = { ...out.savedSnapshots };
  for (const [snapKey, snap] of Object.entries(snapshots)) {
    const prefix = SNAPSHOT_PREFIXES.find((p) => snapKey.startsWith(p));
    if (!prefix) continue;
    const sourceKey = snapKey.slice(prefix.length);
    if (isSnapshotSourceEligibleForTargetWeek(sourceKey, weekIsos)) {
      embeddedSnapshots[snapKey] = snap;
    }
  }
  out.savedSnapshots = embeddedSnapshots;

  return out;
}

/**
 * Réapplique snapshots embarqués + snapshots live encore présents
 * pour réparer l’affichage de la semaine précédente.
 */
export function applySnapshotsToBackupForDisplay(
  backup: PossibleMealsFullBackup,
  liveSnapshots: Record<string, PlanningSnapshotEntry>,
  displayWeekDates: PlanningWeekDayLike[],
): PossibleMealsFullBackup {
  const mergedSnapshots = { ...liveSnapshots, ...(backup.savedSnapshots ?? {}) };
  return embedPlanningSnapshotsInBackup(backup, mergedSnapshots, displayWeekDates);
}
