/**
 * Opérations pures sur les assignations d'extras par créneau (matin/midi/goûter/soir).
 * Sans effet de bord : les callers persistent via setPreference.
 */

/** Créneaux où un extra peut être posé dans une journée. */
export const EXTRA_DAY_SLOTS = ["matin", "midi", "gouter", "soir"] as const;

export type ExtraDaySlot = (typeof EXTRA_DAY_SLOTS)[number];

/** Indique si une chaîne correspond à un créneau d'extra valide. */
export function isExtraDaySlot(value: string | null | undefined): value is ExtraDaySlot {
  return !!value && (EXTRA_DAY_SLOTS as readonly string[]).includes(value);
}

/**
 * Retire une seule occurrence d'un extra dans la sélection d'une journée
 * (clé ISO prioritaire, sinon clé jour).
 */
export function removeOneExtraOccurrenceForDay(
  selection: Record<string, string[]>,
  dayIso: string,
  dayKey: string,
  extraId: string,
): Record<string, string[]> {
  const next = { ...selection };
  const isoList = [...(next[dayIso] || [])];
  const keyList = [...(next[dayKey] || [])];
  const isoIdx = isoList.lastIndexOf(extraId);
  if (isoIdx >= 0) {
    isoList.splice(isoIdx, 1);
    next[dayIso] = isoList;
    return next;
  }
  const keyIdx = keyList.lastIndexOf(extraId);
  if (keyIdx >= 0) {
    keyList.splice(keyIdx, 1);
    next[dayKey] = keyList;
  }
  return next;
}

/** Retire un extra de tous les créneaux d'une journée (copie immuable). */
export function unassignExtraFromAllDaySlotsMap(
  assignments: Record<string, string[]>,
  extraId: string,
  iso: string,
  key: string,
): Record<string, string[]> {
  const updated = { ...assignments };
  for (const slot of EXTRA_DAY_SLOTS) {
    const kIso = `${iso}-${slot}`;
    const kKey = `${key}-${slot}`;
    if (updated[kIso]?.includes(extraId)) {
      updated[kIso] = updated[kIso].filter((x) => x !== extraId);
    }
    if (updated[kKey]?.includes(extraId)) {
      updated[kKey] = updated[kKey].filter((x) => x !== extraId);
    }
  }
  return updated;
}

/** Retire un extra d'un seul créneau (clés ISO et jour). */
export function removeExtraFromDaySlotMap(
  assignments: Record<string, string[]>,
  extraId: string,
  iso: string,
  key: string,
  slot: ExtraDaySlot,
): Record<string, string[]> {
  const kIso = `${iso}-${slot}`;
  const kKey = `${key}-${slot}`;
  const updated = { ...assignments };
  if (updated[kIso]?.includes(extraId)) {
    updated[kIso] = updated[kIso].filter((x) => x !== extraId);
  }
  if (updated[kKey]?.includes(extraId)) {
    updated[kKey] = updated[kKey].filter((x) => x !== extraId);
  }
  return updated;
}

/**
 * Assigne un extra à un créneau : le retire des autres créneaux du jour
 * et le pose `occurrenceCount` fois sur la cible.
 */
export function assignExtraToDaySlotMap(
  assignments: Record<string, string[]>,
  extraId: string,
  iso: string,
  key: string,
  slot: ExtraDaySlot,
  occurrenceCount: number,
): Record<string, string[]> {
  const count = Math.max(1, occurrenceCount);
  let next = { ...assignments };
  for (const s of EXTRA_DAY_SLOTS) {
    if (s === slot) continue;
    next = removeExtraFromDaySlotMap(next, extraId, iso, key, s);
  }
  const targetKey = iso ? `${iso}-${slot}` : `${key}-${slot}`;
  const targetCur = next[targetKey] || [];
  const withoutCurrentExtra = targetCur.filter((id) => id !== extraId);
  next[targetKey] = [...withoutCurrentExtra, ...Array(count).fill(extraId)];
  return next;
}

/**
 * Déplace un extra d'un jour/créneau vers un autre jour/créneau
 * (sélection + assignations en un seul résultat).
 */
export function moveExtraBetweenDaysToSlotMaps(
  selections: Record<string, string[]>,
  assignments: Record<string, string[]>,
  extraId: string,
  sourceIso: string,
  sourceKey: string,
  targetIso: string,
  targetKey: string,
  targetSlot: ExtraDaySlot,
): { selections: Record<string, string[]>; assignments: Record<string, string[]> } {
  const nextSelections = removeOneExtraOccurrenceForDay(selections, sourceIso, sourceKey, extraId);
  const targetCurrent = nextSelections[targetIso] || nextSelections[targetKey] || [];
  if (!targetCurrent.includes(extraId)) {
    nextSelections[targetIso] = [...targetCurrent, extraId];
  }

  let nextAssignments = unassignExtraFromAllDaySlotsMap(assignments, extraId, sourceIso, sourceKey);
  nextAssignments = assignExtraToDaySlotMap(
    nextAssignments,
    extraId,
    targetIso,
    targetKey,
    targetSlot,
    1,
  );

  return { selections: nextSelections, assignments: nextAssignments };
}
