/**
 * Alignement des repas Planning sur les événements Google « Manger » / « Gouter » :
 * créneau (matin/midi/soir → Manger, goûter → Gouter) selon l’heure ou le titre,
 * durée = durée de l’événement, début d’affichage avancé au rappel s’il existe.
 */

import {
  defaultMinutesForMealTime,
  mealTimeFromMinutesOnly,
  type AgendaMealTime,
} from "./agendaTimeUtils";

/** Rappel Google (override ou défaut d’agenda). */
export type GoogleReminderEntry = {
  method?: string;
  minutes?: number;
};

/** Bloc reminders renvoyé par l’API Calendar sur un événement. */
export type GoogleEventReminders = {
  useDefault?: boolean;
  overrides?: GoogleReminderEntry[];
};

/** Placement d’un événement « Manger » sur la grille agenda. */
export type MangerEventPlacement = {
  id: string;
  summary: string;
  /** Début réel de l’événement Google (matching créneau + géométrie host). */
  startMin: number;
  durationMin: number;
  /**
   * Minutes avant le début où part la notification (popup/email).
   * Le repas s’affiche dès cette heure jusqu’à la fin de l’event.
   */
  reminderMinutesBefore?: number | null;
  /** Colonne overlap Google (pour caler le repas dessus). */
  col?: number;
  colCount?: number;
  clusterId?: number;
};

/** Résultat d’alignement repas → événement Manger. */
export type MealMangerAlignment = {
  /** Début d’affichage (éventuellement avancé au rappel). */
  startMin: number;
  durationMin: number;
  eventId: string;
  col: number;
  colCount: number;
  clusterId: number;
};

/**
 * Extrait le délai de notification (minutes avant le début) depuis les rappels Google.
 * Prend le plus grand délai (notif la plus tôt) parmi popup puis email.
 */
export function resolveReminderMinutesBefore(
  reminders: GoogleEventReminders | null | undefined,
  calendarDefaultReminders: GoogleReminderEntry[] | null | undefined = null,
): number | null {
  const pickMaxMinutes = (entries: GoogleReminderEntry[] | undefined): number | null => {
    if (!entries?.length) return null;
    const popup = entries.filter((e) => (e.method || "").toLowerCase() === "popup");
    const pool = popup.length > 0 ? popup : entries;
    let max: number | null = null;
    for (const e of pool) {
      const m = Number(e.minutes);
      if (!Number.isFinite(m) || m < 0) continue;
      max = max == null ? m : Math.max(max, m);
    }
    return max;
  };

  if (reminders?.overrides && reminders.overrides.length > 0) {
    return pickMaxMinutes(reminders.overrides);
  }
  // useDefault true (ou absent avec overrides vides) → défauts de l’agenda
  if (reminders?.useDefault !== false) {
    return pickMaxMinutes(calendarDefaultReminders ?? undefined);
  }
  return null;
}

/**
 * Calcule le placement d’affichage d’un repas : démarre à l’heure de notif
 * (start − rappel) et conserve la fin de l’événement Google.
 */
export function displayPlacementWithReminder(
  eventStartMin: number,
  eventDurationMin: number,
  reminderMinutesBefore: number | null | undefined,
): { startMin: number; durationMin: number } {
  const reminder = Math.max(0, Math.floor(Number(reminderMinutesBefore) || 0));
  if (reminder <= 0) {
    return {
      startMin: eventStartMin,
      durationMin: Math.max(5, eventDurationMin),
    };
  }
  const endMin = eventStartMin + Math.max(0, eventDurationMin);
  const startMin = Math.max(0, eventStartMin - reminder);
  return {
    startMin,
    durationMin: Math.max(5, endMin - startMin),
  };
}

/**
 * Normalise un titre d’événement agenda (casse, espaces, accents) pour matching.
 */
export function normalizeAgendaHostTitle(summary: string): string {
  return summary
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Indique si le titre d’un événement Google est un créneau « Manger »
 * (égalité insensible à la casse / espaces).
 */
export function isMangerEvent(summary: string | null | undefined): boolean {
  if (!summary) return false;
  return normalizeAgendaHostTitle(summary) === "manger";
}

/**
 * Indique si le titre est un créneau « Gouter » / « Goûter »
 * (égalité insensible à la casse, espaces et accents).
 */
export function isGouterEvent(summary: string | null | undefined): boolean {
  if (!summary) return false;
  return normalizeAgendaHostTitle(summary) === "gouter";
}

/**
 * Construit l’alignement d’affichage depuis un événement hôte.
 * @param applyReminder — si true (Manger), avance au rappel ; si false (Gouter), colle aux bornes de l’event.
 */
function alignmentFromHostEvent(
  match: MangerEventPlacement,
  applyReminder: boolean = true,
): MealMangerAlignment {
  const display = applyReminder
    ? displayPlacementWithReminder(
        match.startMin,
        match.durationMin,
        match.reminderMinutesBefore,
      )
    : {
        startMin: match.startMin,
        durationMin: Math.max(5, match.durationMin),
      };
  return {
    startMin: display.startMin,
    durationMin: display.durationMin,
    eventId: match.id,
    col: match.col ?? 0,
    colCount: match.colCount ?? 1,
    clusterId: match.clusterId ?? 0,
  };
}

/**
 * Choisit l’événement « Manger » le plus adapté à un créneau repas
 * (même créneau dérivé de l’heure ; le plus proche de l’heure défaut).
 */
export function findMangerPlacementForMeal(
  dayEvents: MangerEventPlacement[],
  mealTime: string | null | undefined,
  usedEventIds?: Set<string>,
): MangerEventPlacement | null {
  if (!mealTime || mealTime === "gouter") return null;
  const target = mealTime as Exclude<AgendaMealTime, "gouter">;
  const preferred = defaultMinutesForMealTime(target);

  const candidates = dayEvents.filter((ev) => {
    if (!isMangerEvent(ev.summary)) return false;
    if (usedEventIds?.has(ev.id)) return false;
    if (ev.durationMin <= 0) return false;
    return mealTimeFromMinutesOnly(ev.startMin) === target;
  });

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      Math.abs(a.startMin - preferred) - Math.abs(b.startMin - preferred) ||
      a.startMin - b.startMin,
  );
  return candidates[0] ?? null;
}

/**
 * Choisit l’événement « Gouter » le plus proche de 16h (heure défaut goûter).
 */
export function findGouterPlacement(
  dayEvents: MangerEventPlacement[],
  usedEventIds?: Set<string>,
): MangerEventPlacement | null {
  const preferred = defaultMinutesForMealTime("gouter");
  const candidates = dayEvents.filter((ev) => {
    if (!isGouterEvent(ev.summary)) return false;
    if (usedEventIds?.has(ev.id)) return false;
    if (ev.durationMin <= 0) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(a.startMin - preferred) - Math.abs(b.startMin - preferred) ||
      a.startMin - b.startMin,
  );
  return candidates[0] ?? null;
}

/**
 * Assigne chaque repas du jour à au plus un événement « Manger » unique
 * (créneau matin/midi/soir selon l’heure de l’événement).
 */
export function assignMealsToMangerEvents(
  meals: Array<{ id: string; meal_time: string | null | undefined }>,
  dayEvents: MangerEventPlacement[],
): Map<string, MealMangerAlignment> {
  const out = new Map<string, MealMangerAlignment>();
  const used = new Set<string>();

  // Priorité : repas dont le créneau a le moins de Manger disponibles d’abord
  // (évite qu’un midi « vole » le seul Manger d’un autre créneau — N/A ici car
  // le matching est déjà filtré par créneau). Ordre stable par id.
  const sorted = [...meals].sort((a, b) => a.id.localeCompare(b.id));

  for (const meal of sorted) {
    const match = findMangerPlacementForMeal(dayEvents, meal.meal_time, used);
    if (!match) continue;
    used.add(match.id);
    out.set(meal.id, alignmentFromHostEvent(match));
  }

  return out;
}

/**
 * Assigne les repas goûter du jour à un événement Google « Gouter »
 * (toutes les cartes goûter partagent le même host : carte agenda groupée).
 */
export function assignMealsToGouterEvents(
  meals: Array<{ id: string; meal_time: string | null | undefined }>,
  dayEvents: MangerEventPlacement[],
): Map<string, MealMangerAlignment> {
  const out = new Map<string, MealMangerAlignment>();
  const gouterMeals = meals
    .filter((m) => m.meal_time === "gouter")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (gouterMeals.length === 0) return out;

  const match = findGouterPlacement(dayEvents);
  if (!match) return out;

  const align = alignmentFromHostEvent(match, false);
  for (const meal of gouterMeals) {
    out.set(meal.id, align);
  }
  return out;
}
