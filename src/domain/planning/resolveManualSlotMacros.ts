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
 * Sert à préremplir les inputs après un reset (prefs absentes) ; un 0 explicite
 * en pref bloque ce fallback pour laisser un clear manuel vide.
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

/**
 * Résout les macros manuelles pour l’aperçu « semaine pro » :
 * saisie directe (clé ISO next_week) ou snapshot 💾 — pas les clés jour
 * brouillon issues d’une saisie non sauvegardée en semaine courante.
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
    cal: nextPrefs.calories[isoKey] ?? snap?.cal ?? 0,
    prot: nextPrefs.proteins[isoKey] ?? snap?.prot ?? 0,
    fiber: nextPrefs.fibers[isoKey] ?? snap?.fiber ?? 0,
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
