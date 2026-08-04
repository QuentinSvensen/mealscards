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
 * Lit une pref manuelle live : clé ISO uniquement (ignore `jeudi-midi`),
 * pour éviter qu’une saisie d’une autre semaine fuite sur le même weekday.
 * Un 0 explicite est conservé (bloque le fallback snapshot).
 */
function readLiveIsoManualMacro(
  record: Record<string, number>,
  iso: string,
  slot: string,
): number | undefined {
  const isoKey = `${iso}-${slot}`;
  if (!Object.prototype.hasOwnProperty.call(record, isoKey)) return undefined;
  const n = record[isoKey];
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/**
 * Résout kcal / prot / fib d’un créneau manuel (semaine courante) :
 * 1) préférence live clé ISO seulement ;
 * 2) sinon snapshot 💾 clé ISO du jour affiché (pas le weekday générique).
 * Les snapshots `manual-jeudi-midi` ne s’appliquent qu’au reset via mergeSnapshots.
 */
export function resolveManualSlotMacros(
  prefs: ManualSlotMacroMaps,
  snapshots: Record<string, PlanningSnapshotEntry>,
  iso: string,
  _dayKey: string,
  slot: string,
): ManualSlotMacros {
  const snap = snapshots[`manual-${iso}-${slot}`];
  return {
    cal: readLiveIsoManualMacro(prefs.calories, iso, slot) ?? snap?.cal ?? 0,
    prot: readLiveIsoManualMacro(prefs.proteins, iso, slot) ?? snap?.prot ?? 0,
    fiber: readLiveIsoManualMacro(prefs.fibers, iso, slot) ?? snap?.fiber ?? 0,
  };
}

/**
 * Résout les macros manuelles pour l’aperçu « semaine pro » :
 * saisie directe (clé ISO next_week) ou snapshot 💾 (ISO puis weekday pour prévisualiser le 💾).
 * Pas les clés jour brouillon `jeudi-midi` dans next_week (issues d’un blur non voulu).
 */
export function resolveNextWeekManualSlotMacros(
  nextPrefs: ManualSlotMacroMaps,
  snapshots: Record<string, PlanningSnapshotEntry>,
  iso: string,
  dayKey: string,
  slot: string,
): ManualSlotMacros {
  const isoKey = `${iso}-${slot}`;
  const snap =
    snapshots[`manual-${iso}-${slot}`] || snapshots[`manual-${dayKey}-${slot}`];
  return {
    cal: Object.prototype.hasOwnProperty.call(nextPrefs.calories, isoKey)
      ? nextPrefs.calories[isoKey] ?? 0
      : snap?.cal ?? 0,
    prot: Object.prototype.hasOwnProperty.call(nextPrefs.proteins, isoKey)
      ? nextPrefs.proteins[isoKey] ?? 0
      : snap?.prot ?? 0,
    fiber: Object.prototype.hasOwnProperty.call(nextPrefs.fibers, isoKey)
      ? nextPrefs.fibers[isoKey] ?? 0
      : snap?.fiber ?? 0,
  };
}

/**
 * Enregistre une macro manuelle de créneau (kcal / prot / fib).
 * Écrit 0 en cas de clear au lieu de supprimer la clé, pour que
 * resolveManualSlotMacros ne retombe pas sur le snapshot 💾 pendant l’édition.
 */
export function writeManualSlotMacroPreference(
  record: Record<string, number>,
  iso: string,
  dayKey: string,
  slot: string,
  val: number,
): Record<string, number> {
  const updated = { ...record };
  const isoKey = `${iso}-${slot}`;
  const daySlotKey = `${dayKey}-${slot}`;
  // Normalise sur la clé ISO ; retire l’ancienne clé jour pour éviter un double source.
  delete updated[daySlotKey];
  updated[isoKey] = Math.max(0, Math.trunc(Number(val)) || 0);
  return updated;
}

/**
 * Synchronise le brouillon « semaine suivante » avec une saisie de la semaine courante.
 * Valeur > 0 → écrit sur la clé jour (ex. samedi-midi) ; 0 → supprime les clés jour et ISO
 * pour éviter qu’une valeur fantôme soit re-promue au prochain reset.
 */
export function syncNextWeekManualSlotMacro(
  nextRecord: Record<string, number>,
  iso: string,
  dayKey: string,
  slot: string,
  val: number,
): Record<string, number> {
  const updated = { ...nextRecord };
  const isoKey = `${iso}-${slot}`;
  const daySlotKey = `${dayKey}-${slot}`;
  const n = Math.max(0, Math.trunc(Number(val)) || 0);
  delete updated[isoKey];
  if (n > 0) {
    updated[daySlotKey] = n;
  } else {
    delete updated[daySlotKey];
  }
  return updated;
}

/**
 * Remet à zéro les macros live d’un créneau (kcal/prot/fib) pour bloquer le fallback 💾.
 * Sert au double-clic « clear snapshot » : plus de 💾 = plus de valeur affichée.
 */
export function clearManualSlotMacroPreferences(
  calories: Record<string, number>,
  proteins: Record<string, number>,
  fibers: Record<string, number>,
  iso: string,
  dayKey: string,
  slot: string,
): ManualSlotMacroMaps {
  return {
    calories: writeManualSlotMacroPreference(calories, iso, dayKey, slot, 0),
    proteins: writeManualSlotMacroPreference(proteins, iso, dayKey, slot, 0),
    fibers: writeManualSlotMacroPreference(fibers, iso, dayKey, slot, 0),
  };
}
