import { format, startOfWeek, addDays, addWeeks } from "date-fns";
import { fr } from "date-fns/locale";

/** Clés de jour utilisées dans le planning (lundi → dimanche). */
export const PLANNING_DAY_KEYS = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

export type PlanningDayKey = (typeof PLANNING_DAY_KEYS)[number];

export interface PlanningWeekDayInfo {
  key: PlanningDayKey;
  iso: string;
  display: string;
}

export const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0,
  mardi: 1,
  mercredi: 2,
  jeudi: 3,
  vendredi: 4,
  samedi: 5,
  dimanche: 6,
};

/** Libellés FR capitalisés pour l’UI planning. */
export const DAY_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

/** Mapping Date#getDay() (0=dimanche) → clé planning française. */
export const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

/** Date calendaire pour une clé jour (lundi…dimanche) par rapport à `refDate` (début de « aujourd’hui »). */
export function getDateForDayKey(dayKey: string, refDate: Date = new Date()): Date {
  const todayDow = refDate.getDay();
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1;
  const targetIdx = DAY_KEY_TO_INDEX[dayKey] ?? 0;
  const diff = targetIdx - todayIdx;
  const d = new Date(refDate);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Lundi–dimanche pour un décalage de semaine (0 = semaine courante). */
export function buildWeekDates(weekOffset: number, ref: Date = new Date()): PlanningWeekDayInfo[] {
  const now = addWeeks(ref, weekOffset);
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  return PLANNING_DAY_KEYS.map((key, i) => {
    const date = addDays(monday, i);
    return {
      key,
      iso: format(date, "yyyy-MM-dd"),
      display: format(date, "EEEE d/MM", { locale: fr }).toUpperCase(),
    };
  });
}

/**
 * Construit les 14 jours utiles pour le sélecteur de seuil « Au choix » :
 * semaine courante (7) + semaine suivante (7).
 */
export function buildTwoWeekDates(ref: Date = new Date()): PlanningWeekDayInfo[] {
  return [...buildWeekDates(0, ref), ...buildWeekDates(1, ref)];
}

/**
 * Choisit le jour de seuil par défaut dans une fenêtre de dates :
 * aujourd’hui s’il y figure, sinon le premier jour de la fenêtre.
 */
export function resolveDefaultThresholdDayIso(
  windowDays: PlanningWeekDayInfo[],
  todayIso: string,
): string {
  if (windowDays.some((d) => d.iso === todayIso)) return todayIso;
  return windowDays[0]?.iso ?? todayIso;
}

/**
 * Indique si une date ISO appartient à la semaine suivante du planning (weekOffset === 1).
 * Sert à choisir les objectifs / prefs `next_week_*` plutôt que ceux de la semaine courante.
 */
export function isIsoInNextPlanningWeek(iso: string, ref: Date = new Date()): boolean {
  return buildWeekDates(1, ref).some((d) => d.iso === iso);
}

/**
 * Indique si une date ISO appartient à la semaine calendaire courante (lundi → dimanche).
 * Sert à filtrer les cartes Possible quand la case « hors semaine » est décochée.
 */
export function isIsoInCurrentPlanningWeek(iso: string, ref: Date = new Date()): boolean {
  return buildWeekDates(0, ref).some((d) => d.iso === iso);
}

/**
 * Résout un objectif planning (calories, protéines, etc.) selon la date ISO :
 * semaine suivante → valeur « next », sinon valeur de la semaine courante.
 */
export function resolvePlanningGoalForIso<T>(
  iso: string | undefined,
  currentGoal: T,
  nextGoal: T,
  ref: Date = new Date(),
): T {
  if (!iso) return currentGoal;
  return isIsoInNextPlanningWeek(iso, ref) ? nextGoal : currentGoal;
}
