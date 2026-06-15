import type { PlanningSnapshotEntry } from "./types";

/** Mappe l'indice JS getDay() vers la clé jour du planning (lundi…dimanche). */
export type JsDayToPlanningKey = Record<number, string>;

const ISO_DAY_RE = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Indique si un snapshot ISO historique doit encore être réinjecté au reset.
 * Seules les dates de la semaine affichée ou les clés jour (lundi, mardi-midi…) sont conservées.
 */
export function isSnapshotSourceEligibleForTargetWeek(
  sourceKey: string,
  targetWeekIsos: Set<string> | undefined,
): boolean {
  if (!targetWeekIsos?.size) return true;
  const isoPrefix = sourceKey.match(ISO_DAY_RE)?.[1];
  if (!isoPrefix) return true;
  return targetWeekIsos.has(isoPrefix);
}

/**
 * Supprime les snapshots d'un préfixe donné pour un jour/créneau, y compris les anciennes dates ISO du même jour de semaine.
 */
export function clearWeekdayScopedSnapshots(
  snapshots: Record<string, PlanningSnapshotEntry>,
  prefix: "manual" | "extra" | "breakfast",
  iso: string,
  dayKey: string,
  jsDayToKey: JsDayToPlanningKey,
  slot?: string,
): Record<string, PlanningSnapshotEntry> {
  const updated = { ...snapshots };
  const directKeys = slot
    ? [`${prefix}-${iso}-${slot}`, `${prefix}-${dayKey}-${slot}`]
    : [`${prefix}-${iso}`, `${prefix}-${dayKey}`];

  for (const directKey of directKeys) {
    delete updated[directKey];
  }

  for (const snapKey of Object.keys(updated)) {
    if (!snapKey.startsWith(`${prefix}-`)) continue;
    const suffix = snapKey.slice(prefix.length + 1);

    if (!slot) {
      if (suffix === dayKey) {
        delete updated[snapKey];
        continue;
      }
      if (!ISO_DAY_RE.test(suffix)) continue;
      const snapIso = suffix.match(ISO_DAY_RE)?.[1];
      if (!snapIso) continue;
      const dow = jsDayToKey[new Date(`${snapIso}T12:00:00`).getDay()];
      if (dow === dayKey) delete updated[snapKey];
      continue;
    }

    const isoWithSlot = suffix.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (!isoWithSlot) continue;
    const [, snapIso, snapSlot] = isoWithSlot;
    if (snapSlot !== slot) continue;
    const dow = jsDayToKey[new Date(`${snapIso}T12:00:00`).getDay()];
    if (dow === dayKey) delete updated[snapKey];
  }

  return updated;
}

/**
 * Retire des snapshots persistés les entrées ISO d'anciennes semaines qui ne doivent plus être réinjectées.
 */
export function pruneStaleIsoSnapshotsForTargetWeek(
  snapshots: Record<string, PlanningSnapshotEntry>,
  targetWeek: { iso: string }[],
): Record<string, PlanningSnapshotEntry> {
  const targetWeekIsos = new Set(targetWeek.map((day) => day.iso));
  const out: Record<string, PlanningSnapshotEntry> = {};

  for (const [key, snap] of Object.entries(snapshots)) {
    const prefix = (["manual-", "extra-", "breakfast-"] as const).find((candidate) => key.startsWith(candidate));
    if (!prefix) {
      out[key] = snap;
      continue;
    }
    const sourceKey = key.slice(prefix.length);
    if (isSnapshotSourceEligibleForTargetWeek(sourceKey, targetWeekIsos)) {
      out[key] = snap;
    }
  }

  return out;
}
