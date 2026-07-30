/**
 * Utilitaires d’horaires pour la vue Google Agenda du Planning :
 * defaults, snap 15 min, résolution sticky des créneaux (goûter / midi / soir).
 */

import type { ExtraDaySlot } from "@/domain/planning/extraSlotOps";

/** Clés de préférences pour les minutes d’agenda. */
export const PLANNING_AGENDA_TIMES_KEY = "planning_agenda_times";
export const PLANNING_EXTRA_AGENDA_TIMES_KEY = "planning_extra_agenda_times";

/** Début de la grille agenda (heures) — minuit ; scroll initial vers 7h. */
export const AGENDA_HOUR_START = 0;
/** Fin exclusive de la grille agenda (heures). */
export const AGENDA_HOUR_END = 24;
/** Heure en haut du viewport au chargement (scroll vers le haut pour voir avant). */
export const AGENDA_INITIAL_SCROLL_HOUR = 7;
/** Plage visible par défaut : 7h → 24h / 23h59 (17 h). */
export const AGENDA_DEFAULT_VISIBLE_HOURS = AGENDA_HOUR_END - AGENDA_INITIAL_SCROLL_HOUR;
/** Durée visuelle par défaut d’une carte repas/extra (minutes). */
export const AGENDA_EVENT_DURATION_MIN = 60;
/** Pas d’accrochage au drag (minutes). */
export const AGENDA_SNAP_MINUTES = 15;
/** Sous ce seuil (px), colonne jour → mode agenda compact style mobile. */
export const COMPACT_DAY_COLUMN_MAX_PX = 100;

/**
 * Indique si la largeur de colonne jour active le layout Agenda mobile compact.
 */
export function isCompactAgendaColumn(dayColumnWidthPx: number): boolean {
  return dayColumnWidthPx < COMPACT_DAY_COLUMN_MAX_PX;
}

const MIDI_START_MIN = 10 * 60;
const SOIR_START_MIN = 16 * 60;

export type AgendaMealTime = "matin" | "midi" | "gouter" | "soir";

/** Indique si une chaîne est un créneau agenda/planning connu. */
export function isAgendaMealTime(value: string | null | undefined): value is AgendaMealTime {
  return value === "matin" || value === "midi" || value === "gouter" || value === "soir";
}

/** Minutes par défaut d’affichage selon le créneau Planning. */
export function defaultMinutesForMealTime(mealTime: string | null | undefined): number {
  switch (mealTime) {
    case "matin":
      return 8 * 60;
    case "midi":
      return 12 * 60;
    case "gouter":
      return 16 * 60;
    case "soir":
      return 19 * 60;
    default:
      return 12 * 60;
  }
}

/**
 * Accroche les minutes au pas donné (défaut 15), bornées dans la journée [0, 1439].
 */
export function snapMinutes(minutes: number, step: number = AGENDA_SNAP_MINUTES): number {
  if (!Number.isFinite(minutes)) return 0;
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const snapped = Math.round(clamped / step) * step;
  return Math.max(0, Math.min(24 * 60 - step, snapped));
}

/**
 * Dérive un créneau purement depuis l’heure (sans sticky goûter) :
 * &lt;10h matin, [10h, 16h) midi, ≥16h soir.
 */
export function mealTimeFromMinutesOnly(minutes: number): Exclude<AgendaMealTime, "gouter"> {
  const m = snapMinutes(minutes);
  if (m < MIDI_START_MIN) return "matin";
  if (m < SOIR_START_MIN) return "midi";
  return "soir";
}

/**
 * Résout le créneau Planning après un déplacement agenda :
 * goûter sticky ; midi sticky dans [10h, 16h) ; soir sticky dans [16h, 24h).
 */
export function resolveMealTimeAfterAgendaMove(
  previousMealTime: string | null | undefined,
  minutes: number,
): AgendaMealTime {
  const m = snapMinutes(minutes);

  if (previousMealTime === "gouter") {
    return "gouter";
  }

  if (previousMealTime === "midi") {
    if (m >= MIDI_START_MIN && m < SOIR_START_MIN) return "midi";
    return mealTimeFromMinutesOnly(m);
  }

  if (previousMealTime === "soir") {
    if (m >= SOIR_START_MIN) return "soir";
    return mealTimeFromMinutesOnly(m);
  }

  if (previousMealTime === "matin") {
    if (m < MIDI_START_MIN) return "matin";
    return mealTimeFromMinutesOnly(m);
  }

  return mealTimeFromMinutesOnly(m);
}

/** Alias typé pour les extras (mêmes créneaux). */
export function resolveExtraSlotAfterAgendaMove(
  previousSlot: string | null | undefined,
  minutes: number,
): ExtraDaySlot {
  return resolveMealTimeAfterAgendaMove(previousSlot, minutes);
}

/**
 * Minutes d’affichage d’un repas : préférence agenda si présente, sinon défaut du créneau.
 */
export function resolveAgendaMinutesForMeal(
  pmId: string,
  mealTime: string | null | undefined,
  agendaTimes: Record<string, number>,
): number {
  const stored = agendaTimes[pmId];
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return snapMinutes(stored);
  }
  return defaultMinutesForMealTime(mealTime);
}

/**
 * Clé stable d’une occurrence d’extra dans l’agenda
 * (`dayIso:extraId:occurrenceIndex`).
 */
export function buildExtraAgendaOccurrenceKey(
  dayIso: string,
  extraId: string,
  occurrenceIndex: number,
): string {
  return `${dayIso}:${extraId}:${occurrenceIndex}`;
}

/**
 * Minutes d’affichage d’un extra : préférence si présente, sinon défaut du créneau.
 */
export function resolveAgendaMinutesForExtra(
  occurrenceKey: string,
  slot: string | null | undefined,
  agendaTimes: Record<string, number>,
): number {
  const stored = agendaTimes[occurrenceKey];
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return snapMinutes(stored);
  }
  return defaultMinutesForMealTime(slot);
}

/**
 * Convertit un offset Y dans la grille agenda en minutes depuis minuit
 * (borné à la plage visible, puis snappé).
 */
export function offsetYToAgendaMinutes(
  offsetY: number,
  gridHeightPx: number,
  hourStart: number = AGENDA_HOUR_START,
  hourEnd: number = AGENDA_HOUR_END,
): number {
  const totalMinutes = (hourEnd - hourStart) * 60;
  if (gridHeightPx <= 0) return snapMinutes(hourStart * 60);
  const ratio = Math.max(0, Math.min(1, offsetY / gridHeightPx));
  const raw = hourStart * 60 + ratio * totalMinutes;
  const minBound = hourStart * 60;
  const maxBound = hourEnd * 60 - AGENDA_SNAP_MINUTES;
  return snapMinutes(Math.max(minBound, Math.min(maxBound, raw)));
}

/** Formate des minutes depuis minuit en `HHhMM` (sans accrochage — horaires exacts Google). */
export function formatAgendaClock(minutes: number): string {
  if (!Number.isFinite(minutes)) return "00h00";
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(clamped / 60) % 24;
  const min = clamped % 60;
  return `${String(h).padStart(2, "0")}h${String(min).padStart(2, "0")}`;
}
